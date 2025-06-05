require('dotenv').config();
const fs = require('fs');
const { createAdminRestApiClient } = require('@shopify/admin-api-client');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '').replace('http://', '') : undefined;
    
    console.log('🔍 Configurando cliente Shopify...');
    console.log('Store Domain:', storeDomain);
    console.log('Access Token:', process.env.SHOPIFY_ACCESS_TOKEN ? `${process.env.SHOPIFY_ACCESS_TOKEN.substring(0, 10)}...` : 'NÃO DEFINIDO');
    
    if (!storeDomain || !process.env.SHOPIFY_ACCESS_TOKEN) {
        throw new Error('❌ Credenciais Shopify em falta! Verifique SHOPIFY_STORE_URL e SHOPIFY_ACCESS_TOKEN');
    }
    
    return createAdminRestApiClient({
        storeDomain: storeDomain,
        apiVersion: '2024-07',
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    });
}

// Função para ler CSV Shopify com debugging
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

// Função para converter produto com validação
function convertToShopifyProduct(csvProduct) {
    console.log(`🔧 Convertendo produto: ${csvProduct.Title}`);
    
    // Validar campos obrigatórios
    if (!csvProduct.Title || csvProduct.Title.trim() === '') {
        throw new Error('Título é obrigatório');
    }
    
    const price = parseFloat(csvProduct['Variant Price']) || 0;
    if (price <= 0) {
        console.log(`⚠️ Preço inválido (${csvProduct['Variant Price']}), usando 1.00`);
    }
    
    const product = {
        title: csvProduct.Title.trim(),
        body_html: csvProduct['Body (HTML)'] || '',
        vendor: csvProduct.Vendor || '',
        product_type: csvProduct.Type || '',
        tags: csvProduct.Tags || '',
        status: 'active',
        variants: [{
            price: price > 0 ? price.toFixed(2) : '1.00',
            sku: csvProduct['Variant SKU'] || '',
            inventory_management: 'shopify',
            inventory_quantity: parseInt(csvProduct['Variant Inventory Qty']) || 0,
        }]
    };
    
    // Adicionar imagem se disponível
    if (csvProduct['Image Src'] && csvProduct['Image Src'].trim() !== '') {
        product.images = [{
            src: csvProduct['Image Src'].trim(),
            alt: csvProduct['Image Alt Text'] || csvProduct.Title
        }];
    }
    
    console.log(`✅ Produto convertido:`, {
        title: product.title,
        price: product.variants[0].price,
        sku: product.variants[0].sku,
        hasImage: !!product.images
    });
    
    return product;
}

// Função para testar credenciais
async function testShopifyCredentials(client) {
    try {
        console.log('🧪 Testando credenciais Shopify...');
        const response = await client.get('/shop');
        
        if (response.data && response.data.shop) {
            console.log(`✅ Credenciais válidas! Loja: ${response.data.shop.name}`);
            console.log(`📍 Domínio: ${response.data.shop.domain}`);
            return true;
        } else {
            console.log('❌ Resposta inesperada ao testar credenciais:', response);
            return false;
        }
    } catch (error) {
        console.error('❌ Erro ao testar credenciais:', error.message);
        if (error.response) {
            console.error('📄 Resposta da API:', JSON.stringify(error.response.data, null, 2));
        }
        return false;
    }
}

// Função principal com debugging completo
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
        
        // Testar credenciais primeiro
        const credentialsValid = await testShopifyCredentials(client);
        if (!credentialsValid) {
            throw new Error('Credenciais Shopify inválidas ou problema de conectividade');
        }
        
        let createdCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        
        // Processar apenas os primeiros 5 produtos para debugging
        const testProducts = csvProducts.slice(0, 5);
        console.log(`🧪 Modo debugging: processando apenas ${testProducts.length} produtos`);
        
        for (let i = 0; i < testProducts.length; i++) {
            const csvProduct = testProducts[i];
            
            try {
                console.log(`\n📦 Processando ${i + 1}/${testProducts.length}: ${csvProduct.Title}`);
                
                const productData = convertToShopifyProduct(csvProduct);
                
                console.log('📤 Enviando para Shopify API...');
                console.log('📋 Dados do produto:', JSON.stringify(productData, null, 2));
                
                // Criar produto
                const response = await client.post('/products', {
                    data: { product: productData }
                });
                
                console.log('📥 Resposta da API recebida');
                console.log('📊 Status da resposta:', response.status);
                console.log('📄 Dados da resposta:', JSON.stringify(response.data, null, 2));
                
                if (response.data && response.data.product) {
                    createdCount++;
                    console.log(`✅ Produto criado com sucesso!`);
                    console.log(`   • ID: ${response.data.product.id}`);
                    console.log(`   • Handle: ${response.data.product.handle}`);
                    console.log(`   • Status: ${response.data.product.status}`);
                } else {
                    console.log('❌ Resposta não contém produto válido');
                    console.log('📄 Resposta completa:', JSON.stringify(response, null, 2));
                    throw new Error('Resposta inválida da API - produto não criado');
                }
                
                // Delay para evitar rate limiting
                console.log('⏸️ Aguardando 2 segundos...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                errorCount++;
                console.error(`❌ Erro detalhado no produto ${csvProduct.Title}:`);
                console.error(`   • Mensagem: ${error.message}`);
                
                if (error.response) {
                    console.error(`   • Status HTTP: ${error.response.status}`);
                    console.error(`   • Headers: ${JSON.stringify(error.response.headers, null, 2)}`);
                    console.error(`   • Dados: ${JSON.stringify(error.response.data, null, 2)}`);
                } else if (error.request) {
                    console.error(`   • Problema de rede: ${JSON.stringify(error.request, null, 2)}`);
                } else {
                    console.error(`   • Stack trace: ${error.stack}`);
                }
                
                // Parar em caso de erro de credenciais
                if (error.message.includes('Unauthorized') || error.message.includes('401')) {
                    throw new Error('Credenciais Shopify inválidas - parando execução');
                }
            }
        }
        
        console.log('\n🎉 Debugging concluído!');
        console.log(`📊 Estatísticas:`);
        console.log(`   • Produtos criados: ${createdCount}`);
        console.log(`   • Erros: ${errorCount}`);
        console.log(`   • Total testado: ${testProducts.length}`);
        
        return {
            created: createdCount,
            skipped: skippedCount,
            errors: errorCount
        };
        
    } catch (error) {
        console.error('🚨 Erro crítico no upload:', error.message);
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

