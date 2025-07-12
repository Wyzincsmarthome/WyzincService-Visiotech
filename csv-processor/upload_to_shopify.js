require('dotenv').config();
const axios = require('axios');

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
    const query = `query getProducts($cursor: String) { products(first: 250, after: $cursor) { pageInfo { hasNextPage }, edges { cursor, node { id, handle, variants(first: 1) { edges { node { id, sku } } } } } } }`;
    while (hasNextPage) {
        const responseData = await callShopifyApi(query, { cursor });
        const responseProducts = responseData.products;
        for (const productEdge of responseProducts.edges) {
            const product = productEdge.node;
            const firstVariant = product.variants.edges[0]?.node;
            if (firstVariant?.sku) {
                products.set(firstVariant.sku, { productId: product.id, variantId: firstVariant.id });
            }
            cursor = productEdge.cursor;
        }
        hasNextPage = responseProducts.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${products.size} produtos existentes.`);
    return products;
}

async function manageProduct(ids, productData, isNewProduct) {
    const action = isNewProduct ? 'criar' : 'atualizar';
    let { productId, variantId } = ids || {};
    console.log(`\n📦 A ${action} produto: ${productData.title}`);
    
    if (isNewProduct) {
        const createResult = await callShopifyApi(`mutation productCreate($input: ProductInput!) { productCreate(input: $input) { product { id, variants(first: 1) { edges { node { id } } } } } }`, { input: { title: productData.title, handle: productData.handle, vendor: productData.vendor } });
        productId = createResult.product.id;
        variantId = createResult.product.variants.edges[0].node.id;
        console.log(`   -> ✅ Esqueleto criado com ID: ${productId}`);
    }

    const updateInput = { id: productId, bodyHtml: productData.bodyHtml, productType: productData.productType, tags: productData.tags, status: "ACTIVE", images: productData.images };
    await callShopifyApi(`mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id } } }`, { input: updateInput });
    console.log(`   -> ✅ Detalhes do produto (descrição, tags...) atualizados.`);

    const variantInput = { id: variantId, price: productData.price, sku: productData.sku, barcode: productData.ean, inventoryQuantities: [{ availableQuantity: productData.stock, locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}` }] };
    await callShopifyApi(`mutation productVariantUpdate($input: ProductVariantInput!) { productVariantUpdate(input: $input) { productVariant { id } } }`, { input: variantInput });
    console.log(`   -> ✅ Variante (preço, stock, SKU) atualizada.`);
    
    console.log(`   -> 🎉 Produto "${productData.title}" ${action} com sucesso.`);
}

async function uploadProductsToShopify(products) {
    console.log('🚀 Iniciando upload para Shopify...');
    const existingProducts = await getExistingShopifyProducts();
    for (const product of products) {
        if (!product.sku) continue;
        await new Promise(resolve => setTimeout(resolve, 1000));
        try {
            if (existingProducts.has(product.sku)) {
                await manageProduct(existingProducts.get(product.sku), product, false);
            } else {
                await manageProduct(null, product, true);
            }
        } catch (productSyncError) {
            console.error(`🚨 Falha ao sincronizar SKU ${product.sku}: ${productSyncError.message}`);
        }
    }
}
module.exports = { uploadProductsToShopify };
