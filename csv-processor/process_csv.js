require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

// --- CONFIGURAÇÃO ---
const CSV_INPUT_PATH = path.join(__dirname, '../csv-input/visiotech_connect.csv');
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const API_VERSION = '2025-07';
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };
const UNIQUE_PRODUCT_IDENTIFIER = 'name';

const CSV_HEADERS = [
    'name', 'image_path', 'stock', 'msrp', 'brand', 'description', 'specifications', 
    'content', 'short_description', 'short_description_html', 'category', 'category_parent', 
    'precio_neto_compra', 'precio_venta_cliente_final', 'PVP', 'ean', 'published', 
    'created', 'modified', 'params', 'related_products', 'extra_images_paths', 'category_id'
];

// --- FUNÇÕES AUXILIARES DE TRANSFORMAÇÃO ---
function parseEan(eanValue) {
    if (!eanValue || typeof eanValue !== 'string') return '';
    if (eanValue.includes('E+')) {
        try { return BigInt(Math.round(parseFloat(eanValue.replace(',', '.')))).toString(); }
        catch (e) { return eanValue; }
    }
    return eanValue.trim();
}
function parseImages(mainImage, extraImagesJson) {
    const allImages = [mainImage];
    if (extraImagesJson) {
        try {
            const extra = JSON.parse(extraImagesJson).details;
            if (Array.isArray(extra)) allImages.push(...extra.filter(img => img && !img.includes('_thumb.')));
        } catch (e) { /* Ignorar */ }
    }
    return allImages.filter(Boolean).map(src => ({ originalSource: src, altText: "Product Image" }));
}
function parseStock(stockValue) {
    const stockLower = (stockValue || '').toLowerCase();
    if (stockLower.includes('high') || stockLower.includes('disponível')) return 100;
    if (stockLower.includes('low') || stockLower.includes('reduzido')) return 5;
    return 0;
}

// --- FUNÇÕES DA API SHOPIFY ---

async function getExistingShopifySkus() {
    console.log('🔄 A obter SKUs existentes da Shopify...');
    const skus = new Map();
    let hasNextPage = true;
    let cursor = null;
    const query = `query getProducts($cursor: String) { products(first: 250, after: $cursor) { pageInfo { hasNextPage }, edges { cursor, node { id, variants(first: 1) { edges { node { id, sku } } } } } } }`;
    while (hasNextPage) {
        const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables: { cursor } }, { headers: HEADERS });
        if (response.data.errors) throw new Error(`Erro GraphQL ao obter SKUs: ${response.data.errors[0].message}`);
        const { products } = response.data.data;
        for (const productEdge of products.edges) {
            const firstVariant = productEdge.node.variants.edges[0]?.node;
            if (firstVariant?.sku) {
                skus.set(firstVariant.sku, { productId: productEdge.node.id, variantId: firstVariant.id });
            }
            cursor = productEdge.cursor;
        }
        hasNextPage = products.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${skus.size} SKUs existentes.`);
    return skus;
}

async function callShopifyApi(query, variables) {
    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables }, { headers: HEADERS });
    if (response.data.errors) {
        throw new Error(response.data.errors.map(e => e.message).join(', '));
    }
    // A chave de dados pode ser 'data' ou pode não existir.
    return response.data.data;
}


async function manageProduct(ids, product, isNewProduct) {
    const action = isNewProduct ? 'criar' : 'atualizar';
    let { productId, variantId } = ids || {};

    try {
        console.log(`\n📦 A ${action} produto: ${product.title}`);

        // --- PASSO 1: Criar o esqueleto do produto (só para produtos novos) ---
        if (isNewProduct) {
            const createMutation = `
                mutation productCreate($input: ProductInput!) {
                    productCreate(input: $input) {
                        product { id, variants(first: 1) { edges { node { id } } } }
                        userErrors { field, message }
                    }
                }`;
            const createInput = { input: { title: product.title, status: 'DRAFT' } };
            console.log(`   -> Passo 1: Criando esqueleto...`);
            const createData = await callShopifyApi(createMutation, createInput);
            if (createData.productCreate.userErrors.length > 0) throw new Error(`API no Passo 1: ${createData.productCreate.userErrors[0].message}`);
            
            productId = createData.productCreate.product.id;
            variantId = createData.productCreate.product.variants.edges[0]?.node?.id;
            if (!productId || !variantId) throw new Error('Falha ao obter IDs do produto/variante.');
            console.log(`   -> ✅ Esqueleto criado. Produto ID: ${productId}`);
        }
        
        // --- PASSO 2: Atualizar a variante com preço, SKU e stock ---
        const variantUpdateMutation = `
            mutation productVariantUpdate($input: ProductVariantInput!) {
                productVariantUpdate(input: $input) {
                    productVariant { id }
                    userErrors { field, message }
                }
            }`;
        const variantInput = {
            input: {
                id: variantId,
                price: product.price,
                sku: product.sku,
                barcode: product.ean,
                inventoryItem: { tracked: true },
                inventoryQuantities: [{ availableQuantity: product.stock, locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}` }]
            }
        };
        console.log(`   -> Passo 2: Atualizando variante ${variantId}...`);
        const variantData = await callShopifyApi(variantUpdateMutation, variantInput);
        if (variantData.productVariantUpdate.userErrors.length > 0) throw new Error(`API no Passo 2: ${variantData.productVariantUpdate.userErrors[0].message}`);
        console.log(`   -> ✅ Variante atualizada.`);

        // --- PASSO 3: Atualizar o produto com os restantes detalhes e publicá-lo ---
        const productUpdateMutation = `
            mutation productUpdate($input: ProductInput!) {
                productUpdate(input: $input) {
                    product { id, title }
                    userErrors { field, message }
                }
            }`;
        const productUpdateInput = {
            input: {
                id: productId,
                descriptionHtml: product.descriptionHtml,
                vendor: product.vendor,
                productType: product.productType,
                tags: product.tags,
                status: 'ACTIVE'
            }
        };
        console.log(`   -> Passo 3: Atualizando detalhes do produto ${productId}...`);
        const productUpdateData = await callShopifyApi(productUpdateMutation, productUpdateInput);
        if (productUpdateData.productUpdate.userErrors.length > 0) throw new Error(`API no Passo 3: ${productUpdateData.productUpdate.userErrors[0].message}`);
        console.log(`   -> ✅ Detalhes do produto atualizados.`);

        // --- PASSO 4 (Opcional): Adicionar imagens ---
        if (product.images.length > 0) {
            const imageMutation = `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id }, userErrors { field, message } } }`;
            const imageInput = { productId: productId, media: product.images };
            console.log(`   -> Passo 4: Adicionando ${product.images.length} imagens...`);
            const imageData = await callShopifyApi(imageMutation, imageInput);
            if (imageData.productCreateMedia.userErrors.length > 0) console.warn(`   -> ⚠️  Aviso, erro ao adicionar imagens: ${imageData.productCreateMedia.userErrors[0].message}`);
            else console.log(`   -> ✅ Imagens adicionadas.`);
        }

        console.log(`   -> 🎉 Produto "${product.title}" ${action} com sucesso.`);

    } catch (error) {
        console.error(`❌ Erro fatal na gestão do produto ${product.title}: ${error.message}`.red);
        throw error;
    }
}

async function main() {
    try {
        console.log("🚀 Iniciando processo...");
        const existingSkus = await getExistingShopifySkus();
        const productsToProcess = [];

        fs.createReadStream(CSV_INPUT_PATH)
            .on('error', (err) => { throw err; })
            .pipe(csv({ separator: ';', headers: CSV_HEADERS, skipLines: 1 }))
            .on('data', (row) => {
                if (!row.name || row.name.trim() === '') return;
                try {
                    const transformedProduct = {
                        sku: row[UNIQUE_PRODUCT_IDENTIFIER],
                        title: row.name,
                        vendor: row.brand,
                        productType: row.category_parent,
                        descriptionHtml: row.description || row.short_description_html || '',
                        tags: [row.brand, row.category_parent, row.category].filter(Boolean).join(','),
                        price: (row.PVP || row.msrp || '0').replace(',', '.'),
                        stock: parseStock(row.stock),
                        images: parseImages(row.image_path, row.extra_images_paths),
                        ean: parseEan(row.ean)
                    };
                    productsToProcess.push(transformedProduct);
                } catch (transformError) {
                    console.warn(`⚠️ Erro ao transformar linha com SKU ${row.name}: ${transformError.message}`);
                }
            })
            .on('end', async () => {
                try {
                    console.log(`\n✅ Ficheiro lido. ${productsToProcess.length} produtos para sincronizar.`);
                    for (const product of productsToProcess) {
                        if (!product.sku) continue;
                        await new Promise(resolve => setTimeout(resolve, 500));
                        try {
                            if (existingSkus.has(product.sku)) {
                                await manageProduct(existingSkus.get(product.sku), product, false);
                            } else {
                                await manageProduct(null, product, true);
                            }
                        } catch (productSyncError) {
                            console.error(`🚨 Falha ao sincronizar SKU ${product.sku}: ${productSyncError.message}`.red);
                        }
                    }
                    console.log(`\n🎉 Sincronização concluída!`);
                } catch (syncError) {
                    console.error(`🚨 Erro geral durante a sincronização: ${syncError.message}`);
                }
            });
    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        process.exit(1);
    }
}

main();
