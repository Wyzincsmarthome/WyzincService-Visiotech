require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

// --- CONFIGURAÇÃO ---
// ATUALIZADO: O nome do ficheiro foi alterado conforme o seu pedido.
const CSV_INPUT_PATH = path.join(__dirname, '../csv-input/visiotech_connect.csv');
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const API_VERSION = '2025-07';
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };
const UNIQUE_PRODUCT_IDENTIFIER = 'name';

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
                    skus.set(variantEdge.node.sku, productEdge.node.id);
                }
            }
            cursor = productEdge.cursor;
        }
        hasNextPage = products.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${skus.size} SKUs existentes.`);
    return skus;
}

async function createShopifyProduct(product) {
    console.log(`➕ A criar novo produto: ${product.title}`);
    const mutation = `
        mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
                product { id, title }
                userErrors { field, message }
            }
        }`;
    
    const input = {
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        descriptionHtml: product.descriptionHtml,
        tags: product.tags,
        status: 'ACTIVE',
        images: product.images,
        variants: [{
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
    if (response.data.errors) throw new Error(`Erro GraphQL ao criar: ${response.data.errors[0].message}`);
    if (response.data.data.productCreate.userErrors.length > 0) throw new Error(`Erro API ao criar: ${response.data.data.productCreate.userErrors[0].message}`);
    
    console.log(`   -> ✅ Produto "${product.title}" criado com sucesso.`);
}

async function updateShopifyProduct(productId, product) {
    console.log(`🔄 A atualizar produto existente: ${product.title}`);
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
    };

    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: mutation, variables: { input } }, { headers: HEADERS });
    if (response.data.errors) throw new Error(`Erro GraphQL ao atualizar: ${response.data.errors[0].message}`);
    if (response.data.data.productUpdate.userErrors.length > 0) throw new Error(`Erro API ao atualizar: ${response.data.data.productUpdate.userErrors[0].message}`);

    console.log(`   -> ✅ Produto "${product.title}" atualizado com sucesso.`);
}

// --- FUNÇÃO PRINCIPAL ---

async function main() {
    try {
        console.log("🚀 Iniciando processo de sincronização de produtos do CSV.");

        if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN || !SHOPIFY_LOCATION_ID) {
            throw new Error("As variáveis de ambiente SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN e SHOPIFY_LOCATION_ID são obrigatórias.");
        }

        const existingSkus = await getExistingShopifySkus();
        const productsToProcess = [];

        let firstRowLogged = false;

        fs.createReadStream(CSV_INPUT_PATH)
            .pipe(csv({ separator: '\t', bom: true }))
            .on('data', (row) => {
                if (!firstRowLogged) {
                    console.log('--- INÍCIO DO DEBUG DA PRIMEIRA LINHA ---'.yellow);
                    console.log('Colunas recebidas do CSV:', Object.keys(row));
                    console.
