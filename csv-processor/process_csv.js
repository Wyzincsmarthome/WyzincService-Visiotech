const fs = require('fs');
const path = require('path');
const { transformProduct } = require('./csv_transformer');

// Configurações para ficheiros grandes
const CONFIG = {
    BATCH_SIZE: 50,           // Processar 50 produtos de cada vez
    MAX_PRODUCTS: 500,        // Limite máximo para evitar timeout
    MEMORY_LIMIT: 100 * 1024 * 1024, // 100MB limite de memória
    PROGRESS_INTERVAL: 10     // Mostrar progresso a cada 10 produtos
};

// Função para ler CSV com gestão de memória
function parseCSVSafe(csvContent, delimiter = ';') {
    try {
        console.log('📊 Analisando tamanho do ficheiro CSV...');
        console.log(`📏 Tamanho: ${(csvContent.length / 1024 / 1024).toFixed(2)} MB`);
        
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            console.log('❌ CSV vazio');
            return [];
        }
        
        console.log(`📄 ${lines.length} linhas encontradas no CSV`);
        
        // Verificar se excede limite
        if (lines.length > CONFIG.MAX_PRODUCTS + 1) { // +1 para header
            console.log(`⚠️ Ficheiro muito grande! Limitando a ${CONFIG.MAX_PRODUCTS} produtos para evitar timeout`);
            lines.splice(CONFIG.MAX_PRODUCTS + 1); // Manter header + MAX_PRODUCTS
        }
        
        const headers = lines[0].split(delimiter);
        const products = [];
        
        console.log('📋 Headers encontrados:', headers.slice(0, 5).join(', ') + '...');
        
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = lines[i].split(delimiter);
                const product = {};
                
                headers.forEach((header, index) => {
                    product[header.trim()] = values[index] ? values[index].trim() : '';
                });
                
                products.push(product);
                
                // Mostrar progresso
                if (i % CONFIG.PROGRESS_INTERVAL === 0) {
                    console.log(`📊 Parsing: ${i}/${lines.length - 1} produtos...`);
                }
            } catch (error) {
                console.log(`⚠️ Erro na linha ${i}: ${error.message}`);
            }
        }
        
        console.log(`✅ ${products.length} produtos parseados com sucesso`);
        return products;
        
    } catch (error) {
        console.error('❌ Erro no parsing CSV:', error.message);
        throw error;
    }
}

// Função para processar em lotes
function processBatch(products, startIndex, batchSize) {
    const endIndex = Math.min(startIndex + batchSize, products.length);
    const batch = products.slice(startIndex, endIndex);
    const shopifyProducts = [];
    
    console.log(`🔄 Processando lote ${Math.floor(startIndex / batchSize) + 1}: produtos ${startIndex + 1}-${endIndex}`);
    
    let processedInBatch = 0;
    let skippedInBatch = 0;
    
    batch.forEach((visiProduct, index) => {
        try {
            const transformedProducts = transformProduct(visiProduct);
            
            if (transformedProducts && Array.isArray(transformedProducts)) {
                shopifyProducts.push(...transformedProducts);
                processedInBatch++;
            } else if (transformedProducts) {
                shopifyProducts.push(transformedProducts);
                processedInBatch++;
            } else {
                skippedInBatch++;
            }
            
            // Log detalhado apenas para primeiros produtos
            if (startIndex + index < 20) {
                const status = transformedProducts ? '✅ Processado' : '⏭️ Ignorado';
                console.log(`   ${startIndex + index + 1}: ${visiProduct.name} (${visiProduct.brand}) → ${status}`);
            }
            
        } catch (error) {
            skippedInBatch++;
            if (startIndex + index < 20) {
                console.log(`   ${startIndex + index + 1}: ${visiProduct.name} → ❌ Erro: ${error.message}`);
            }
        }
    });
    
    console.log(`✅ Lote concluído: ${processedInBatch} processados, ${skippedInBatch} ignorados`);
    
    return {
        products: shopifyProducts,
        processed: processedInBatch,
        skipped: skippedInBatch
    };
}

// Função para gerar CSV Shopify com validação robusta
function generateShopifyCSVOptimized(products) {
    console.log('📝 Gerando CSV Shopify...');
    
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
    
    products.forEach((product, index) => {
        try {
            const row = headers.map(header => {
                let value = product[header];
                
                // CORREÇÃO: Validação robusta do valor
                if (value === null || value === undefined) {
                    return '';
                }
                
                // Converter para string se não for
                if (typeof value !== 'string') {
                    value = String(value);
                }
                
                // Escapar aspas e vírgulas
                if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            });
            csv += row.join(',') + '\n';
            
            // Mostrar progresso para CSVs grandes
            if ((index + 1) % 100 === 0) {
                console.log(`📝 CSV: ${index + 1}/${products.length} linhas geradas...`);
            }
        } catch (error) {
            console.error(`❌ Erro na linha ${index + 1}:`, error.message);
            console.error('Produto problemático:', JSON.stringify(product, null, 2));
            // Continuar com linha vazia em caso de erro
            csv += headers.map(() => '').join(',') + '\n';
        }
    });
    
    console.log(`✅ CSV gerado: ${products.length} linhas`);
    return csv;
}

// Função principal otimizada
async function processVisiCSV(inputPath, outputPath) {
    try {
        console.log('🚀 Iniciando processamento CSV Visiotech (Otimizado)...');
        console.log(`⚙️ Configurações: Lotes de ${CONFIG.BATCH_SIZE}, Máximo ${CONFIG.MAX_PRODUCTS} produtos`);
        
        // Verificar se ficheiro existe
        if (!fs.existsSync(inputPath)) {
            throw new Error(`Ficheiro não encontrado: ${inputPath}`);
        }
        
        // Verificar tamanho do ficheiro
        const stats = fs.statSync(inputPath);
        console.log(`📏 Tamanho do ficheiro: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
        
        if (stats.size > CONFIG.MEMORY_LIMIT) {
            console.log(`⚠️ Ficheiro muito grande! Pode causar problemas de memória.`);
        }
        
        // Ler ficheiro CSV
        console.log('📁 Carregando ficheiro CSV...');
        const csvContent = fs.readFileSync(inputPath, 'utf-8');
        console.log('✅ Ficheiro CSV carregado');
        
        // Parsear CSV com segurança
        const visiProducts = parseCSVSafe(csvContent, ';');
        
        if (visiProducts.length === 0) {
            throw new Error('Nenhum produto encontrado no CSV');
        }
        
        // Processar em lotes
        const allShopifyProducts = [];
        let totalProcessed = 0;
        let totalSkipped = 0;
        
        console.log(`\n🔄 Iniciando processamento em lotes de ${CONFIG.BATCH_SIZE}...`);
        
        for (let i = 0; i < visiProducts.length; i += CONFIG.BATCH_SIZE) {
            const batchResult = processBatch(visiProducts, i, CONFIG.BATCH_SIZE);
            
            allShopifyProducts.push(...batchResult.products);
            totalProcessed += batchResult.processed;
            totalSkipped += batchResult.skipped;
            
            // Forçar garbage collection se disponível
            if (global.gc) {
                global.gc();
            }
            
            // Pausa pequena entre lotes para evitar sobrecarga
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        console.log('\n📝 Gerando ficheiro CSV final...');
        
        // Gerar CSV Shopify
        const shopifyCSV = generateShopifyCSVOptimized(allShopifyProducts);
        
        // Guardar ficheiro
        fs.writeFileSync(outputPath, shopifyCSV, 'utf-8');
        
        console.log('\n🎉 Processamento concluído!');
        console.log(`📊 Estatísticas finais:`);
        console.log(`   • Produtos no CSV original: ${visiProducts.length}`);
        console.log(`   • Produtos processados: ${totalProcessed}`);
        console.log(`   • Produtos ignorados: ${totalSkipped}`);
        console.log(`   • Total linhas Shopify: ${allShopifyProducts.length}`);
        console.log(`   • Taxa de aprovação: ${((totalProcessed / visiProducts.length) * 100).toFixed(1)}%`);
        console.log(`📁 Ficheiro gerado: ${outputPath}`);
        console.log(`📏 Tamanho final: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);
        
        return {
            processed: totalProcessed,
            skipped: totalSkipped,
            totalLines: allShopifyProducts.length,
            outputFile: outputPath,
            originalProducts: visiProducts.length
        };
        
    } catch (error) {
        console.error('❌ Erro no processamento:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const inputFile = process.argv[2] || 'csv-input/visiotech_connect.csv';
    const outputFile = process.argv[3] || `csv-output/shopify_products_${new Date().toISOString().slice(0,10).replace(/-/g,'')}_${new Date().toTimeString().slice(0,8).replace(/:/g,'')}.csv`;
    
    console.log(`📋 Argumentos recebidos:`);
    console.log(`   • Input: ${inputFile}`);
    console.log(`   • Output: ${outputFile}`);
    
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

module.exports = { processVisiCSV, CONFIG };

