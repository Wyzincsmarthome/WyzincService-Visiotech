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
        try {
            return BigInt(eanValue.replace(',', '.')).toString();
        } catch (e) { return eanValue; }
    }
    return eanValue;
}
function parseImages(mainImage, extraImagesJson) {
    const allImages = [mainImage];
    if (extraImagesJson) {
        try {
            const extra = JSON.parse(extraImagesJson).details;
            if (Array.isArray(extra)) allImages.push(...extra.filter(img => img && !img.includes('_thumb.')));
        } catch (e) { /* Ignorar */ }
    }
    return allImages.filter(Boolean).map(src => ({ src }));
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

async function createShopifyProduct(product) {
    console.log(`➕ A criar novo produto em 3 passos: ${product.title}`);
    
    // --- PASSO 1: Criar produto com o título para obter os IDs
    const createMutation = `
        mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
                product { id, variants(first: 1) { edges { node { id } } } }
                userErrors { field, message }
            }
        }`;
    const createInput = { input: { title: product.title } };
    console.log(`   -> Passo 1: Criando esqueleto do produto...`);
    const createResponse = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: createMutation, variables: createInput }, { headers: HEADERS });
    if (createResponse.data.errors || createResponse.data.data.productCreate.userErrors.length > 0) {
        throw new Error(`Erro no Passo 1: ${JSON.stringify(createResponse.data)}`);
    }
    const { id: productId, variants } = createResponse.data.data.productCreate.product;
    const variantId = variants.edges[0]?.node?.id;
    if (!productId || !variantId) throw new Error('Falha ao obter IDs do produto/variante.');
    console.log(`   -> ✅ Esqueleto criado com ID: ${productId} e Variante ID: ${variantId}`);

    // --- PASSO 2: Atualizar a VARIANTE com preço, SKU e stock
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
    console.log(`   -> Passo 2: Atualizando a variante...`);
    const variantResponse = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: variantUpdateMutation, variables: variantInput }, { headers: HEADERS });
    if (variantResponse.data.errors || variantResponse.data.data.productVariantUpdate.userErrors.length > 0) {
        throw new Error(`Erro no Passo 2: ${JSON.stringify(variantResponse.data)}`);
    }
    console.log(`   -> ✅ Variante atualizada com sucesso.`);

    // --- PASSO 3: Atualizar o PRODUTO com os restantes detalhes e publicá-lo
    await updateShopifyProduct({ productId }, product, true);
}

async function updateShopifyProduct(ids, product, isFinalizing = false) {
    const { productId } = ids;
    const action = isFinalizing ? 'finalizar' : 'atualizar';
    console.log(`🔄 A ${action} produto: ${product.title}`);

    const mutation = `
        mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
                product { id, title }
                userErrors { field, message }
            }
        }`;
    const input = {
        id: productId,
        descriptionHtml: product.descriptionHtml,
        vendor: product.vendor,
        productType: product.productType,
        tags: product.tags,
        images: product.images,
        status: 'ACTIVE'
    };
    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: mutation, variables: { input } }, { headers: HEADERS });
    if (response.data.errors || response.data.data.productUpdate.userErrors.length > 0) {
        throw new Error(`Erro ao ${action}: ${JSON.stringify(response.data)}`);
    }
    console.log(`   -> ✅ Produto "${product.title}" ${action} com sucesso.`);
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
                try {
                    if (!row.name || row.name.trim() === '') return;
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
                        if (!product.sku) { console.warn(`   -> ⚠️ Pulando produto sem SKU.`); continue; }
                        await new Promise(resolve => setTimeout(resolve, 500)); 
                        if (existingSkus.has(product.sku)) {
                            await updateShopifyProduct(existingSkus.get(product.sku), product);
                        } else {
                            await createShopifyProduct(product);
                        }
                    }
                    console.log(`\n🎉 Sincronização concluída!`);
                } catch (syncError) {
                    console.error(`🚨 Erro durante a sincronização: ${syncError.message}`);
                    process.exit(1);
                }
            });
    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        process.exit(1);
    }
}

main();
