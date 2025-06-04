const fs = require('fs');
const path = require('path');
const { transformProduct } = require('./csv_transformer');

// Função para ler CSV
function parseCSV(csvContent, delimiter = ';') {
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(delimiter);
    const products = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(delimiter);
        const product = {};
        
        headers.forEach((header, index) => {
            product[header.trim()] = values[index] ? values[index].trim() : '';
        });
        
        products.push(product);
    }
    
    return products;
}

// Função para gerar CSV Shopify
function generateShopifyCSV(products) {
    const headers = [
        'Handle', 'Title', 'Body (HTML)', 'Vendor', 'Product Category', 'Type', 'Tags',
        'Published', 'Option1 Name', 'Option1 Value', 'Option2 Name', 'Option2 Value',
        'Option3 Name', 'Option3 Value', 'Variant SKU', 'Variant Grams',
        'Variant Inventory Tracker', 'Variant Inventory Qty', 'Variant Inventory Policy',
        'Variant Fulfillment Service', 'Variant Price', 'Variant Compare At Price',
        'Variant Requires Shipping', 'Variant Taxable', 'Variant Barcode',
        'Image Src', 'Image Position', 'Image Alt Text', 'Gift Card',
        'SEO Title', 'SEO Description', 'Google Shopping / Google Product Category',
        'Google Shopping / Gender', 'Google Shopping / Age Group', 'Google Shopping / MPN',
        'Google Shopping / Condition', 'Google Shopping / Custom Product',
        'Variant Image', 'Variant Weight Unit', 'Variant Tax Code', 'Cost per item',
        'Included / United States', 'Price / United States', 'Compare At Price / United States',
        'Included / International', 'Price / International', 'Compare At Price / International',
        'Status'
    ];

    let csv = headers.join(',') + '\n';

    products.forEach(product => {
        const row = headers.map(header => {
            const value = product[header] || '';
            // Escapar aspas e vírgulas
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        });
        csv += row.join(',') + '\n';
    });

    return csv;
}

// Função principal
async function processVisiCSV(inputPath, outputPath) {
    try {
        console.log('🚀 Iniciando processamento CSV Visiotech...');

        // Ler ficheiro CSV
        const csvContent = fs.readFileSync(inputPath, 'utf-8');
        console.log('📁 Ficheiro CSV carregado');

        // Parsear CSV
        const visiProducts = parseCSV(csvContent, ';');
        console.log(`📊 ${visiProducts.length} produtos encontrados no CSV`);

        // Transformar produtos
        const shopifyProducts = [];
        let processedCount = 0;
        let skippedCount = 0;

        // CORREÇÃO: Usar for loop simples em vez de forEach para melhor controlo de erros
        for (let index = 0; index < visiProducts.length; index++) {
            const visiProduct = visiProducts[index];
            
            try {
                const transformed = transformProduct(visiProduct);
                if (transformed) {
                    shopifyProducts.push(transformed);
                    processedCount++;
                    
                    // Log a cada 100 produtos para não sobrecarregar
                    if (processedCount % 100 === 0) {
                        console.log(`✅ Processados ${processedCount} produtos...`);
                    }
                } else {
                    skippedCount++;
                }
            } catch (productError) {
                skippedCount++;
                console.log(`❌ Erro no produto ${index + 1}: ${productError.message}`);
            }
        }

        // Gerar CSV Shopify
        console.log('📝 Gerando CSV Shopify...');
        const shopifyCSV = generateShopifyCSV(shopifyProducts);

        // Guardar ficheiro
        fs.writeFileSync(outputPath, shopifyCSV, 'utf-8');

        console.log('\n🎉 Processamento concluído!');
        console.log(`📊 Estatísticas:`);
        console.log(`  • Produtos processados: ${processedCount}`);
        console.log(`  • Produtos ignorados: ${skippedCount}`);
        console.log(`  • Total linhas Shopify: ${shopifyProducts.length}`);
        console.log(`📁 Ficheiro gerado: ${outputPath}`);

        // Relatório de marcas processadas
        const brandCounts = {};
        shopifyProducts.forEach(product => {
            if (product.Vendor) {
                brandCounts[product.Vendor] = (brandCounts[product.Vendor] || 0) + 1;
            }
        });

        console.log('\n🏷️ Marcas processadas:');
        Object.entries(brandCounts).forEach(([brand, count]) => {
            console.log(`   • ${brand}: ${count} produtos`);
        });

        return {
            processed: processedCount,
            skipped: skippedCount,
            total: shopifyProducts.length,
            brands: brandCounts
        };

    } catch (error) {
        console.error('🚨 Erro no processamento:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const inputFile = process.argv[2] || 'input/visiotech_connect.csv';
    const outputFile = process.argv[3] || 'output/shopify_products.csv';

    processVisiCSV(inputFile, outputFile)
        .then(result => {
            console.log('\n✅ Processamento concluído com sucesso!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Erro no processamento:', error.message);
            process.exit(1);
        });
}

module.exports = { processVisiCSV };
