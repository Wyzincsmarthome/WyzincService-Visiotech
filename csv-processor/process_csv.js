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

// Função para processar imagens extras como produtos separados
function processExtraImages(shopifyProduct, extraImages) {
    const extraImageProducts = [];
    
    extraImages.forEach((imageUrl, index) => {
        if (index === 0) return; // Primeira imagem já está no produto principal
        
        const imageProduct = { ...shopifyProduct };
        imageProduct['Handle'] = shopifyProduct['Handle']; // Mesmo handle
        imageProduct['Title'] = ''; // Título vazio para imagens extras
        imageProduct['Body (HTML)'] = '';
        imageProduct['Vendor'] = '';
        imageProduct['Type'] = '';
        imageProduct['Tags'] = '';
        imageProduct['Variant SKU'] = '';
        imageProduct['Variant Price'] = '';
        imageProduct['Variant Inventory Qty'] = '';
        imageProduct['Image Src'] = imageUrl;
        imageProduct['Image Position'] = (index + 1).toString();
        imageProduct['Image Alt Text'] = shopifyProduct['Title'];
        
        // Limpar outros campos para imagens extras
        Object.keys(imageProduct).forEach(key => {
            if (key.startsWith('Variant') && key !== 'Variant Image') {
                imageProduct[key] = '';
            }
        });
        
        extraImageProducts.push(imageProduct);
    });
    
    return extraImageProducts;
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
        // TESTE: Limitar a 100 produtos para debug
const testProducts = visiProducts; // Processar todos os produtos
console.log(`🚀 MODO PRODUÇÃO: Processando ${testProducts.length} produtos total`);
        console.log(`📊 ${visiProducts.length} produtos encontrados no CSV`);
        
        // Transformar produtos
        const shopifyProducts = [];
        let processedCount = 0;
        let skippedCount = 0;
        
        visiProducts.forEach((visiProduct, index) => {
            try {
                const transformed = transformProduct(visiProduct);
                
                if (transformed) {
                    shopifyProducts.push(transformed);
                    
                    // Processar imagens extras de forma segura
                    try {
                        const extraImagesField = visiProduct.extra_images_paths || '';
                        if (extraImagesField && extraImagesField.trim() !== '') {
                            // Usar a função do transformer que já está corrigida
                            const extraImages = require('./csv_transformer').processExtraImages ? 
                                require('./csv_transformer').processExtraImages(extraImagesField) : [];
                            
                            if (extraImages.length > 1) {
                                const extraImageProducts = processExtraImages(transformed, extraImages);
                                shopifyProducts.push(...extraImageProducts);
                            }
                        }
                    } catch (imageError) {
                        console.log(`⚠️ Erro nas imagens do produto ${index + 1}: ${imageError.message}`);
                        // Continuar sem as imagens extras
                    }
                    
                    processedCount++;
                    console.log(`✅ Produto ${index + 1}: ${visiProduct.name} (${visiProduct.brand}) → Processado`);
                } else {
                    skippedCount++;
                    console.log(`⏭️ Produto ${index + 1}: ${visiProduct.name} (${visiProduct.brand}) → Marca não aprovada`);
                }
            } catch (productError) {
                skippedCount++;
                console.log(`❌ Erro no produto ${index + 1}: ${productError.message}`);
            }
        });
        
        // Gerar CSV Shopify
        const shopifyCSV = generateShopifyCSV(shopifyProducts);
        
        // Guardar ficheiro
        fs.writeFileSync(outputPath, shopifyCSV, 'utf-8');
        
        console.log('\n🎉 Processamento concluído!');
        console.log(`📊 Estatísticas:`);
        console.log(`   • Produtos processados: ${processedCount}`);
        console.log(`   • Produtos ignorados: ${skippedCount}`);
        console.log(`   • Total linhas Shopify: ${shopifyProducts.length}`);
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
