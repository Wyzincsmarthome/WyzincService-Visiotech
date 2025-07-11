const path = require('path');
const { getTransformedProducts } = require('./csv_transformer');
const { uploadProductsToShopify } = require('./upload_to_shopify');

const CSV_INPUT_PATH = path.join(__dirname, '../csv-input/visiotech_connect.csv');

async function main() {
    try {
        console.log("🚀 Iniciando processo...");
        
        // Passo 1: Ler e transformar o CSV do fornecedor usando a sua lógica
        const transformedProducts = await getTransformedProducts(CSV_INPUT_PATH);
        
        if (!transformedProducts || transformedProducts.length === 0) {
            console.log('✅ Nenhum produto para processar. Fim.');
            return;
        }

        // Passo 2: Enviar os produtos transformados para a Shopify
        await uploadProductsToShopify(transformedProducts);

        console.log('\n🎉 Sincronização concluída!');

    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        process.exit(1);
    }
}

main();
