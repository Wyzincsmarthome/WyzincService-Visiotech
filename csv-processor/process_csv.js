const fs = require('fs');
const path = require('path');
require('dotenv').config();

const { transformVisiCSVToShopify } = require('./csv_transformer');
const { uploadProductsToShopify } = require('./upload_to_shopify');

const INPUT_DIR = path.resolve(__dirname, '../csv-input');
const OUTPUT_DIR = path.resolve(__dirname, '../csv-output');

const INPUT_FILE = 'visiotech.csv';
const OUTPUT_FILE = 'shopify_products.csv';

async function processCSV() {
  try {
    const inputPath = path.join(INPUT_DIR, INPUT_FILE);
    const outputPath = path.join(OUTPUT_DIR, OUTPUT_FILE);

    if (!fs.existsSync(inputPath)) {
      console.error(`❌ Ficheiro de entrada não encontrado: ${inputPath}`);
      process.exit(1);
    }

    console.log(`📥 A processar ficheiro: ${inputPath}`);

    // Ler CSV de fornecedor
    const csvData = fs.readFileSync(inputPath, 'utf-8');

    // Transformar CSV para formato Shopify
    const { processed, errors, shopifyLines } = transformVisiCSVToShopify(csvData, outputPath);

    if (errors > 0) {
      console.warn(`⚠️ Encontrados ${errors} erros durante a transformação.`);
    }

    console.log(`✅ CSV transformado com ${processed} produtos processados.`);
    console.log(`📤 A carregar produtos para a Shopify...`);

    // Ler CSV já transformado para upload
    const shopifyCSV = fs.readFileSync(outputPath, 'utf-8');

    // Enviar produtos para Shopify (função deve implementar upsert por handle ou SKU)
    const uploadResult = await uploadProductsToShopify(shopifyCSV);

    console.log(`🎉 Upload concluído: ${uploadResult.created} produtos criados, ${uploadResult.updated} atualizados.`);

  } catch (error) {
    console.error('🚨 Erro no processo:', error);
    process.exit(1);
  }
}

// Se executado diretamente
if (require.main === module) {
  processCSV();
}

module.exports = processCSV;
