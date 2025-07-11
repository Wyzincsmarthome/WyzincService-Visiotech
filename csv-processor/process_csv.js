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

// --- DEFINIÇÃO DAS COLUNAS DO CSV ---
const CSV_HEADERS = [
    'name', 'image_path', 'stock', 'msrp', 'brand', 'description', 'specifications', 
    'content', 'short_description', 'short_description_html', 'category', 'category_parent', 
    'precio_neto_compra', 'precio_venta_cliente_final', 'PVP', 'ean', 'published', 
    'created', 'modified', 'params', 'related_products', 'extra_images_paths', 'category_id'
];


// --- FUNÇÕES DA API SHOPIFY ---

async function getExistingShopifySkus() {
    console.log('🔄 A obter SKUs existentes da Shopify...');
    const skus = new Map();
    let hasNextPage = true;
    let cursor = null;
    const query = `query getProducts($cursor: String) { products(first: 250, after: $cursor) { pageInfo { hasNextPage }, edges { cursor, node { id, variants(first: 10) { edges { node { sku } } } } } } }`;

    while (hasNextPage) {
        const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables: { cursor } }, { headers: HEADERS });
        if (response.data.errors) throw new Error(`Erro GraphQL ao obter SKUs: ${response.data.errors[0].message}`);
        const { products } = response.data.data;
        
        for (const productEdge of products.edges) {
            for (const variantEdge of productEdge.node.variants.edges) {
                if (variantEdge.node.sku) {
                    skus.set(variantEdge.node.sku, { productId: productEdge.node.id, variantId: variantEdge.node.id });
                }
            }
            // CORREÇÃO: A linha do cursor foi movida para DENTRO do loop 'for'.
            cursor = productEdge.cursor;
        }
        hasNextPage = products.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${skus.size} SKUs existentes.`);
    return skus;
}

async function createShopifyProduct(product) {
    console.log(`➕ A criar novo produto: ${product.title}`);
    
    const createMutation = `
        mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
                product { id, variants(first: 1) { edges { node { id } } } }
                userErrors { field, message }
            }
        }`;
    const createInput = { input: { title: product.title, status: 'DRAFT' } };
    const createResponse = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: createMutation, variables: createInput }, { headers: HEADERS });

    if (createResponse.data.errors) throw new Error(`Erro GraphQL ao criar (Passo 1): ${createResponse.data.errors[0].message}`);
    if (createResponse.data.data.productCreate.userErrors.length > 0) throw new Error(`Erro API ao criar (Passo 1): ${createResponse.data.data.productCreate.userErrors[0].message}`);
    
    const { id: productId, variants } = createResponse.data.data.productCreate.product;
    const variantId = variants.edges[0]?.node?.id;
    if (!productId || !variantId) throw new Error('Falha ao obter IDs do produto/variante criados.');
    
    console.log(`   -> ✅ Produto base criado com ID: ${productId}`);
    await updateShopifyProduct({ productId, variantId }, product, true);
}

async function updateShopifyProduct(ids, product, isNewProduct = false) {
    const { productId, variantId } = ids;
    const action = isNewProduct ? 'finalizar' : 'atualizar';
    console.log(`🔄 A ${action} produto: ${product.title}`);

    const mutation = `
        mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
                product { id }
                userErrors { field, message }
            }
        }`;

    const input = {
        id: productId,
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        descriptionHtml: product.descriptionHtml,
        tags: product.tags,
        images: product.images,
        status: 'ACTIVE',
        variants: [{
            id: variantId,
            price: product.price,
            sku: product.sku,
            inventoryItem: { tracked: true },
            inventoryQuantities: [{
                availableQuantity: product.stock,
                locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`
            }]
        }]
    };

    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: mutation, variables: { input } }, { headers: HEADERS });
    if (response.data.errors) throw new Error(`Erro GraphQL ao ${action}: ${response.data.errors[0].message}`);
    if (response.data.data.productUpdate.userErrors.length > 0) throw new Error(`Erro API ao ${action}: ${response.data.data.productUpdate.userErrors[0].message}`);

    console.log(`   -> ✅ Produto "${product.title}" ${action} com sucesso.`);
}

// --- FUNÇÃO PRINCIPAL ---
async function main() {
    try {
        console.log("🚀 Iniciando processo de sincronização de produtos do CSV.");

        if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN || !SHOPIFY_LOCATION_ID) {
            throw new Error("As variáveis de ambiente são obrigatórias.");
        }

        const existingSkus = await getExistingShopifySkus();
        const productsToProcess = [];

        fs.createReadStream(CSV_INPUT_PATH)
            .on('error', (err) => { throw err; })
            .pipe(csv({ separator: ';', headers: CSV_HEADERS, skipLines: 1 }))
            .on('data', (row) => {
                try {
                    if (!row.name || row.name.trim() === '') return;

                    const eanString = String(row.ean || '').includes('E+') ? BigInt(row.ean).toString() : String(row.ean || '');
                    const allImages = [row.image_path];
                    if (row.extra_images_paths) {
                        try {
                            const extraImages = JSON.parse(row.extra_images_paths).details;
                            if (Array.isArray(extraImages)) {
                                allImages.push(...extraImages.filter(img => img && !img.includes('_thumb.')));
                            }
                        } catch (e) { /* ignorar */ }
                    }

                    const transformedProduct = {
                        sku: row[UNIQUE_PRODUCT_IDENTIFIER],
                        title: row.name,
                        vendor: row.brand,
                        productType: row.category_parent,
                        descriptionHtml: row.description || row.short_description_html || '',
                        tags: [row.brand, row.category_parent, row.category].filter(Boolean).join(','),
                        price: (row.PVP || row.msrp || '0').replace(',', '.'),
                        stock: row.stock === 'high' ? 100 : (row.stock === 'low' ? 5 : 0),
                        images: allImages.filter(Boolean).map(src => ({ src })),
                        ean: eanString
                    };
                    productsToProcess.push(transformedProduct);
                } catch (transformError) {
                    console.warn(`⚠️ Erro ao transformar a linha com SKU ${row.name}: ${transformError.message}`);
                }
            })
            .on('end', async () => {
                try {
                    console.log(`\n✅ Ficheiro CSV lido. ${productsToProcess.length} produtos para sincronizar.`);
                    let createdCount = 0;
                    let updatedCount = 0;

                    for (const product of productsToProcess) {
                        if (!product.sku) {
                            console.warn(`   -> ⚠️ Pulando produto sem SKU válido.`);
                            continue;
                        }
                        
                        await new Promise(resolve => setTimeout(resolve, 500)); 
                        
                        if (existingSkus.has(product.sku)) {
                            const ids = existingSkus.get(product.sku);
                            await updateShopifyProduct(ids, product);
                            updatedCount++;
                        } else {
                            await createShopifyProduct(product);
                            createdCount++;
                        }
                    }

                    console.log(`\n🎉 Sincronização concluída!`);
                    console.log(`   - ${createdCount} produtos criados.`);
                    console.log(`   - ${updatedCount} produtos atualizados.`);
                } catch (syncError) {
                    console.error(`🚨 Erro durante a sincronização com a Shopify: ${syncError.message}`);
                    process.exit(1);
                }
            });

    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
