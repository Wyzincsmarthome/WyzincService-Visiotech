const path = require('path');
// Corrigido para usar a nova função exportada
const { transformVisiCSVToShopify } = require('./csv_transformer'); 
const { uploadProductsToShopify } = require('./upload_to_shopify');

const INPUT_CSV_PATH = path.join(__dirname, '../csv-input/visiotech_connect.csv');

async function main() {
    try {
        console.log("🚀 Iniciando processo completo...");
        
        // A sua função original `transformVisiCSVToShopify` é chamada.
        // Ela agora devolve os dados em vez de escrever um ficheiro.
        const { shopifyLines } = await transformVisiCSVToShopify(INPUT_CSV_PATH);
        
        if (!shopifyLines || shopifyLines.length === 0) {
            console.log('✅ Nenhum produto para processar. Fim.');
            return;
        }

        // A lógica de upload agora recebe os dados diretamente.
        await uploadProductsToShopify(shopifyLines);

        console.log('\n🎉 Sincronização concluída!');

    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        process.exit(1);
    }
}

main();
