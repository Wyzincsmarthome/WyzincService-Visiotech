require('dotenv').config();
const axios = require('axios');

const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const API_VERSION = '2024-10';
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };

async function callShopifyApi(query, variables) {
    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables }, { headers: HEADERS });
    if (response.data.errors) throw new Error(response.data.errors.map(e => e.message).join(', '));
    const responseData = response.data.data;
    const mutationResultKey = Object.keys(responseData)[0];
    const mutationResult = responseData[mutationResultKey];
    if (mutationResult.userErrors?.length > 0) throw new Error(mutationResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', '));
    return mutationResult;
}

async function getExistingShopifyProducts() { /* ... código da função como na resposta anterior ... */ }

async function manageProduct(ids, productData, isNewProduct) {
    const action = isNewProduct ? 'criar' : 'atualizar';
    let { productId, variantId } = ids || {};
    console.log(`\n📦 A ${action} produto: ${productData.title}`);
    if (isNewProduct) {
        const createResult = await callShopifyApi(`mutation productCreate($input: ProductInput!) { productCreate(input: $input) { product { id, variants(first: 1) { edges { node { id } } } } } }`, { input: { title: productData.title } });
        productId = createResult.product.id;
        variantId = createResult.product.variants.edges[0].node.id;
        console.log(`   -> ✅ Esqueleto criado. ID do Produto: ${productId}`);
    }
    const updateInput = { id: productId, bodyHtml: productData.bodyHtml, vendor: productData.vendor, productType: productData.productType, tags: productData.tags, status: 'ACTIVE' };
    await callShopifyApi(`mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id } } }`, { input: updateInput });
    console.log(`   -> ✅ Detalhes do produto atualizados.`);
    const variantInput = { id: variantId, price: productData.price, sku: productData.sku, inventoryQuantities: [{ availableQuantity: productData.stock, locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}` }]};
    await callShopifyApi(`mutation productVariantUpdate($input: ProductVariantInput!) { productVariantUpdate(input: $input) { productVariant { id } } }`, {input: variantInput});
    console.log(`   -> ✅ Variante atualizada.`);
    if (isNewProduct && productData.images.length > 0) {
        await callShopifyApi(`mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id } } }`, { productId: productId, media: productData.images });
        console.log(`   -> ✅ Imagens adicionadas.`);
    }
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
            console.error(`🚨 Falha ao sincronizar SKU ${product.sku}: ${productSyncError.message}`.red);
        }
    }
}
module.exports = { uploadProductsToShopify };
