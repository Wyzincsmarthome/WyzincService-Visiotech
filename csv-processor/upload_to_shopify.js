const axios = require('axios');
require('dotenv').config();

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const API_VERSION = '2024-10';
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };

async function callShopifyApi(query, variables) {
    try {
        const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables }, { headers: HEADERS });
        if (response.data.errors) throw new Error(response.data.errors.map(e => e.message).join(', '));
        const responseData = response.data.data;
        const mutationResultKey = Object.keys(responseData)[0];
        const mutationResult = responseData[mutationResultKey];
        if (mutationResult.userErrors?.length > 0) throw new Error(mutationResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', '));
        return mutationResult;
    } catch (error) {
        if (error.response) console.error('❌ Erro na resposta da API (Axios):', JSON.stringify(error.response.data, null, 2));
        throw error;
    }
}

async function getExistingShopifyProducts() {
    console.log('🔄 A obter produtos existentes da Shopify...');
    const products = new Map();
    let hasNextPage = true;
    let cursor = null;
    const query = `query getProducts($cursor: String) { products(first: 250, after: $cursor) { pageInfo { hasNextPage }, edges { cursor, node { id, handle } } } }`;

    while (hasNextPage) {
        const responseData = await callShopifyApi(query, { cursor });
        const responseProducts = responseData.products;
        for (const productEdge of responseProducts.edges) {
            products.set(productEdge.node.handle, productEdge.node.id);
            cursor = productEdge.cursor;
        }
        hasNextPage = responseProducts.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${products.size} produtos existentes.`);
    return products;
}

async function uploadProductsToShopify(productsInShopifyFormat) {
    console.log('🚀 Iniciando upload para Shopify...');
    const existingProducts = await getExistingShopifyProducts();
    const productsByHandle = new Map();

    for (const row of productsInShopifyFormat) {
        if (!productsByHandle.has(row.Handle)) {
            productsByHandle.set(row.Handle, []);
        }
        productsByHandle.get(row.Handle).push(row);
    }

    for (const [handle, rows] of productsByHandle.entries()) {
        const mainRow = rows[0];
        const images = rows.map(r => ({ src: r['Image Src'] })).filter(img => img.src);
        
        const input = {
            handle: mainRow.Handle,
            title: mainRow.Title,
            bodyHtml: mainRow['Body (HTML)'],
            vendor: mainRow.Vendor,
            productType: mainRow.Type,
            tags: mainRow.Tags,
            status: "ACTIVE",
            images,
            variants: [{
                price: mainRow['Variant Price'],
                sku: mainRow['Variant SKU'],
                inventoryPolicy: "DENY",
                inventoryManagement: "SHOPIFY",
                inventoryQuantities: [{ availableQuantity: parseInt(mainRow['Variant Inventory Qty'], 10) || 0, locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}` }],
                barcode: mainRow['Variant Barcode']
            }]
        };

        try {
            if (existingProducts.has(handle)) {
                console.log(`🔄 Atualizando produto: ${mainRow.Title}`);
                input.id = existingProducts.get(handle);
                await callShopifyApi(`mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id } } }`, { input });
                console.log(`   -> ✅ Produto atualizado com sucesso.`);
            } else {
                console.log(`➕ A criar novo produto: ${mainRow.Title}`);
                await callShopifyApi(`mutation productCreate($input: ProductInput!) { productCreate(input: $input) { product { id } } }`, { input });
                console.log(`   -> ✅ Produto criado com sucesso.`);
            }
        } catch (e) {
            console.error(`🚨 Falha ao sincronizar produto com handle ${handle}: ${e.message}`);
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

module.exports = { uploadProductsToShopify };
