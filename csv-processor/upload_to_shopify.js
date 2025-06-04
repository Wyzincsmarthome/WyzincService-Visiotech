require('dotenv').config();
const fs = require('fs');
const { createAdminRestApiClient } = require('@shopify/admin-api-client');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '').replace('http://', '') : undefined;
    
    console.log('🔍 Configurando cliente Shopify...');
    console.log('Store Domain:', storeDomain);
    
    return createAdminRestApiClient({
        storeDomain: storeDomain,
        apiVersion: '2024-07',
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    });
}

// Função ULTRA-SIMPLIFICADA para ler CSV Shopify
function parseShopifyCSV(csvContent) {
    try {
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            console.log('❌ CSV vazio');
            return [];
        }
        
        console.log(`📄 ${lines.length} linhas encontradas no CSV`);
        
        // Split simples por vírgula (assumindo CSV bem formatado)
        const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const products = [];
        
        console.log('📋 Headers encontrados:', headers.slice(0, 5).join(', ') + '...');
        
        // Processar TODAS as linhas
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
                const product = {};
                
                headers.forEach((header, index) => {
                    product[header] = values[index] || '';
                });
                
                // Apenas processar linhas com Handle e Title
                if (product.Handle && product.Title) {
                    products.push(product);
                    
                    // Log a cada 100 produtos
                    if (products.length % 100 === 0) {
                        console.log(`📦 Produtos válidos encontrados: ${products.length}`);
                    }
                }
            } catch (lineError) {
                console.log(`⚠️ Erro na linha ${i}: ${lineError.message}`);
            }
        }
        
        console.log(`✅ ${products.length} produtos válidos encontrados no total`);
        return products;
        
    } catch (error) {
        console.error('🚨 Erro ao parsear CSV:', error.message);
        return [];
    }
}

// Função para converter produto
function convertToShopifyProduct(csvProduct) {
    return {
        title: csvProduct.Title || 'Produto sem título',
        body_html: csvProduct['Body (HTML)'] || '',
        vendor: csvProduct.Vendor || '',
        product_type: csvProduct.Type || '',
        tags: csvProduct.Tags || '',
        status: 'active',
        variants: [{
            price: csvProduct['Variant Price'] || '0.00',
            sku: csvProduct['Variant SKU'] || '',
            inventory_management: 'shopify',
            inventory_quantity: parseInt(csvProduct['Variant Inventory Qty']) || 0,
        }]
    };
}

// Função principal ULTRA-SIMPLIFICADA
async function uploadToShopify(csvFilePath) {
    try {
        console.log('🚀 Iniciando upload para Shopify...');
        console.log('📁 Ficheiro CSV:', csvFilePath);
        
        // Verificar se ficheiro existe
        if (!fs.existsSync(csvFilePath)) {
            throw new Error(`Ficheiro não encontrado: ${csvFilePath}`);
        }
        
        // Ler CSV
        const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
        console.log(`📄 Ficheiro lido: ${csvContent.length} caracteres`);
        
        const csvProducts = parseShopifyCSV(csvContent);
        
        if (csvProducts.length === 0) {
            throw new Error('Nenhum produto válido encontrado no CSV');
        }
        
        console.log(`🎯 Iniciando processamento de ${csvProducts.length} produtos...`);
        
        // Criar cliente Shopify
        const client = createShopifyClient();
        
        let createdCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        
        // Processar TODOS os produtos (sem verificação de duplicados)
        for (let i = 0; i < csvProducts.length; i++) {
            const csvProduct = csvProducts[i];
            
            try {
                if ((i + 1) % 10 === 0) {
                    console.log(`\n📦 Processando ${i + 1}/${csvProducts.length}: ${csvProduct.Title}`);
                }
                
                const productData = convertToShopifyProduct(csvProduct);
                
                // Criar produto diretamente (sem verificação)
                const response = await client.post('/products', {
                    data: { product: productData }
                });
                
                if (response.data && response.data.product) {
                    createdCount++;
                    if ((i + 1) % 10 === 0) {
                        console.log(`✅ Produto criado: ${csvProduct.Title} (ID: ${response.data.product.id})`);
                    }
                } else {
                    throw new Error('Resposta inválida da API');
                }
                
                // Delay para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Log de progresso a cada 50 produtos
                if ((i + 1) % 50 === 0) {
                    console.log(`📊 Progresso: ${i + 1}/${csvProducts.length} (${Math.round((i + 1) / csvProducts.length * 100)}%)`);
                    console.log(`   • Criados: ${createdCount} | Erros: ${errorCount} | Ignorados: ${skippedCount}`);
                }
                
            } catch (error) {
                if (error.message.includes('rate limit') || error.message.includes('429')) {
                    console.log(`⏸️ Rate limit atingido, aguardando 10 segundos...`);
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    i--; // Retry este produto
                } else if (error.message.includes('already exists') || 
                          error.message.includes('duplicate') ||
                          error.message.includes('taken') ||
                          error.message.includes('must be unique')) {
                    skippedCount++;
                    console.log(`⚠️ Produto já existe (ignorado): ${csvProduct.Title}`);
                } else {
                    errorCount++;
                    console.error(`❌ Erro no produto ${csvProduct.Title}: ${error.message}`);
                }
            }
        }
        
        console.log('\n🎉 Upload concluído!');
        console.log(`📊 Estatísticas finais:`);
        console.log(`  • Produtos criados: ${createdCount}`);
        console.log(`  • Produtos ignorados (duplicados): ${skippedCount}`);
        console.log(`  • Erros: ${errorCount}`);
        console.log(`  • Total processado: ${createdCount + skippedCount + errorCount}`);
        
        return { 
            created: createdCount, 
            skipped: skippedCount,
            errors: errorCount 
        };
        
    } catch (error) {
        console.error('🚨 Erro no upload:', error.message);
        console.error('Stack trace:', error.stack);
        throw error;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const csvFile = process.argv[2] || 'csv-output/shopify_products.csv';
    
    uploadToShopify(csvFile)
        .then(result => {
            console.log('\n✅ Upload concluído com sucesso!');
            process.exit(0);
        })
        .catch(error => {
            console.error('\n❌ Erro no upload:', error.message);
            process.exit(1);
        });
}

module.exports = { uploadToShopify };
