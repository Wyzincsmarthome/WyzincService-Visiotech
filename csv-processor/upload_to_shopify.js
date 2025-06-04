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
        apiVersion: '2023-04',
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    });
}

// Função CORRIGIDA para ler CSV Shopify (sem limites)
function parseShopifyCSV(csvContent) {
    try {
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            console.log('❌ CSV vazio');
            return [];
        }
        
        console.log(`📄 ${lines.length} linhas encontradas no CSV`);
        
        // Parsing CSV mais robusto para lidar com vírgulas dentro de campos
        const headers = parseCSVLine(lines[0]);
        const products = [];
        
        console.log('📋 Headers encontrados:', headers.slice(0, 5).join(', ') + '...');
        
        // CORREÇÃO: Processar TODAS as linhas (sem limite)
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = parseCSVLine(lines[i]);
                const product = {};
                
                headers.forEach((header, index) => {
                    product[header] = values[index] ? values[index].trim() : '';
                });
                
                // Apenas processar linhas com Handle e Title
                if (product.Handle && product.Title) {
                    products.push(product);
                    
                    // Log a cada 100 produtos para não sobrecarregar
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

// Função para parsear linha CSV (lida com vírgulas dentro de campos)
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                // Aspas duplas escapadas
                current += '"';
                i++; // Skip próximo caractere
            } else {
                // Toggle estado das aspas
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // Vírgula fora de aspas = separador
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    // Adicionar último campo
    result.push(current);
    
    return result;
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

// Função para verificar se produto já existe
async function checkProductExists(client, sku) {
    try {
        if (!sku) return null;
        
        const response = await client.get('/products', {
            data: {
                fields: 'id,title,variants',
                limit: 250
            }
        });
        
        if (response.data && response.data.products) {
            for (const product of response.data.products) {
                if (product.variants) {
                    for (const variant of product.variants) {
                        if (variant.sku === sku) {
                            return product;
                        }
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        console.log(`⚠️ Erro ao verificar produto existente: ${error.message}`);
        return null;
    }
}

// Função principal CORRIGIDA (sem limites)
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
        let updatedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        
        // CORREÇÃO: Processar TODOS os produtos (sem limite)
        for (let i = 0; i < csvProducts.length; i++) {
            const csvProduct = csvProducts[i];
            
            try {
                if ((i + 1) % 10 === 0) {
                    console.log(`\n📦 Processando ${i + 1}/${csvProducts.length}: ${csvProduct.Title}`);
                }
                
                const productData = convertToShopifyProduct(csvProduct);
                const sku = csvProduct['Variant SKU'];
                
                // Verificar se produto já existe
                const existingProduct = await checkProductExists(client, sku);
                
                if (existingProduct) {
                    // Produto existe - atualizar
                    const updateResponse = await client.put(`/products/${existingProduct.id}`, {
                        data: { product: productData }
                    });
                    
                    if (updateResponse.data && updateResponse.data.product) {
                        updatedCount++;
                        if ((i + 1) % 10 === 0) {
                            console.log(`🔄 Produto atualizado: ${csvProduct.Title}`);
                        }
                    }
                } else {
                    // Produto não existe - criar
                    const createResponse = await client.post('/products', {
                        data: { product: productData }
                    });
                    
                    if (createResponse.data && createResponse.data.product) {
                        createdCount++;
                        if ((i + 1) % 10 === 0) {
                            console.log(`✅ Produto criado: ${csvProduct.Title}`);
                        }
                    }
                }
                
                // Delay para evitar rate limiting (Shopify permite 2 requests/segundo)
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Log de progresso a cada 50 produtos
                if ((i + 1) % 50 === 0) {
                    console.log(`📊 Progresso: ${i + 1}/${csvProducts.length} (${Math.round((i + 1) / csvProducts.length * 100)}%)`);
                    console.log(`   • Criados: ${createdCount} | Atualizados: ${updatedCount} | Erros: ${errorCount}`);
                }
                
            } catch (error) {
                errorCount++;
                if (error.message.includes('rate limit') || error.message.includes('429')) {
                    console.log(`⏸️ Rate limit atingido, aguardando 10 segundos...`);
                    await new Promise(resolve => setTimeout(resolve, 10000));
                    i--; // Retry este produto
                } else {
                    console.error(`❌ Erro no produto ${csvProduct.Title}: ${error.message}`);
                }
            }
        }
        
        console.log('\n🎉 Upload concluído!');
        console.log(`📊 Estatísticas finais:`);
        console.log(`  • Produtos criados: ${createdCount}`);
        console.log(`  • Produtos atualizados: ${updatedCount}`);
        console.log(`  • Produtos ignorados: ${skippedCount}`);
        console.log(`  • Erros: ${errorCount}`);
        console.log(`  • Total processado: ${createdCount + updatedCount + skippedCount + errorCount}`);
        
        return { 
            created: createdCount, 
            updated: updatedCount,
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

