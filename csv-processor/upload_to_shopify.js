// upload_to_shopify.js
const { Shopify } = require('@shopify/shopify-api');

const SHOPIFY_STORE = process.env.SHOPIFY_STORE; // ex: "minhaloja.myshopify.com"
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

if (!SHOPIFY_STORE || !SHOPIFY_ACCESS_TOKEN) {
    console.error('🚨 Variáveis de ambiente SHOPIFY_STORE ou SHOPIFY_ACCESS_TOKEN não definidas!');
    process.exit(1);
}

const client = new Shopify.Clients.Rest(SHOPIFY_STORE, SHOPIFY_ACCESS_TOKEN);

async function getProductByHandle(handle) {
    try {
        const response = await client.get({
            path: 'products',
            query: { handle: handle }
        });
        const products = response.body.products || [];
        return products.length > 0 ? products[0] : null;
    } catch (error) {
        console.error(`Erro ao obter produto pelo handle ${handle}:`, error.message);
        return null;
    }
}

async function createOrUpdateProduct(productData) {
    try {
        const handle = productData['Handle'];
        if (!handle) {
            console.error('Produto sem Handle definido.');
            return { updated: 0, created: 0 };
        }

        const existingProduct = await getProductByHandle(handle);

        if (existingProduct) {
            // Atualizar produto - aqui podes adaptar os campos que queres atualizar
            const productId = existingProduct.id;
            await client.put({
                path: `products/${productId}`,
                data: { product: productData },
                type: 'application/json'
            });
            console.log(`Produto atualizado: ${handle}`);
            return { updated: 1, created: 0 };
        } else {
            // Criar novo produto
            await client.post({
                path: 'products',
                data: { product: productData },
                type: 'application/json'
            });
            console.log(`Produto criado: ${handle}`);
            return { updated: 0, created: 1 };
        }
    } catch (error) {
        console.error(`Erro ao criar/atualizar produto ${productData['Handle']}:`, error.message);
        return { updated: 0, created: 0 };
    }
}

async function uploadProductsToShopify(products) {
    let createdCount = 0;
    let updatedCount = 0;

    for (const product of products) {
        const result = await createOrUpdateProduct(product);
        createdCount += result.created;
        updatedCount += result.updated;
    }

    console.log(`\nResumo do upload:`);
    console.log(`• Produtos criados: ${createdCount}`);
    console.log(`• Produtos atualizados: ${updatedCount}`);

    return { created: createdCount, updated: updatedCount };
}

module.exports = {
    uploadProductsToShopify
};
