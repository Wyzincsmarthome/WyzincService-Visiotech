// process_csv.js
const fs = require('fs');
const path = require('path');
const { transformVisiCSVToShopify } = require('./csv_transformer');
const { uploadProductsToShopify } = require('./upload_to_shopify');

async function main() {
    try {
        // Recebe o CSV e output por argumento da linha de comando
        const inputPath = process.argv[2] || 'csv-input/visiotech.csv';
        const outputPath = process.argv[3] || `csv-output/shopify_products_${new Date().toISOString().slice(0,10)}.csv`;

        console.log(`📄 Processando ficheiro: ${inputPath}`);
        console.log(`📁 Ficheiro de saída: ${outputPath}`);

        if (!fs.existsSync(inputPath)) {
            console.error(`❌ Ficheiro de input não encontrado: ${inputPath}`);
            process.exit(1);
        }

        const csvContent = fs.readFileSync(inputPath, 'utf-8');

        // Transforma CSV do fornecedor para formato Shopify
        const { processed, errors, shopifyLines } = transformVisiCSVToShopify(csvContent, outputPath);

        console.log(`✅ CSV transformado: ${processed} produtos processados, ${errors} erros.`);

        // Lê o CSV gerado para carregar no Shopify
        const shopifyCsvContent = fs.readFileSync(outputPath, 'utf-8');
        const lines = shopifyCsvContent.split('\n').filter(line => line.trim() !== '');

        // Ignorar header
        const products = [];
        const headers = lines[0].split(',');

        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
            if (values.length !== headers.length) {
                console.warn(`⚠️ Linha ${i + 1} com número incorreto de colunas.`);
                continue;
            }

            const product = {};
            headers.forEach((h, idx) => {
                let val = values[idx];
                // Remove aspas extras
                if (val.startsWith('"') && val.endsWith('"')) {
                    val = val.slice(1, -1).replace(/""/g, '"');
                }
                product[h] = val;
            });
            products.push(product);
        }

        // Upload para Shopify
        const { created, updated } = await uploadProductsToShopify(products);

        console.log(`🎉 Upload concluído: ${created} criados, ${updated} atualizados.`);

    } catch (error) {
        console.error('🚨 Erro no processamento:', error.message);
        process.exit(1);
    }
}

main();
