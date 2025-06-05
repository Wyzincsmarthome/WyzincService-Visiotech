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

// Função para ler CSV Shopify
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
    // Validar campos obrigatórios
    if (!csvProduct.Title || csvProduct.Title.trim() === '') {
        throw new Error('Título é obrigatório');
    }
    
    const price = parseFloat(csvProduct['Variant Price']) || 1.00;
    const inventoryQty = parseInt(csvProduct['Variant Inventory Qty']) || 0;
    
    const product = {
        title: csvProduct.Title.trim(),
        body_html: csvProduct['Body (HTML)'] || '',
        vendor: csvProduct.Vendor || '',
        product_type: csvProduct.Type || '',
        tags: csvProduct.Tags || '',
        status: 'active',
        variants: [{
            price: price.toFixed(2),
            sku: csvProduct['Variant SKU'] || '',
            inventory_management: 'shopify',
            inventory_quantity: inventoryQty,
            weight: 0,
            weight_unit: 'g'
        }]
    };
    
    // Adicionar imagem se disponível
    if (csvProduct['Image Src'] && csvProduct['Image Src'].trim() !== '') {
        product.images = [{
            src: csvProduct['Image Src'].trim(),
            alt: csvProduct['Image Alt Text'] || csvProduct.Title
        }];
    }
    
    return product;
}

// Função principal com foco na criação de produtos
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
        
        // PULAR teste de credenciais e ir direto para criação
        console.log('⏭️ Pulando teste de credenciais, indo direto para criação de produtos...');
        
        let createdCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        
        // Processar apenas os primeiros 3 produtos para debugging
        const testProducts = csvProducts.slice(0, 3);
        console.log(`🧪 Modo debugging: processando apenas ${testProducts.length} produtos`);
        
        for (let i = 0; i < testProducts.length; i++) {
            const csvProduct = testProducts[i];
            
            try {
                console.log(`\n📦 Processando ${i + 1}/${testProducts.length}: ${csvProduct.Title}`);
                
                const productData = convertToShopifyProduct(csvProduct);
                
                console.log('📤 Enviando para Shopify API...');
                console.log('📋 Dados básicos:', {
                    title: productData.title,
                    vendor: productData.vendor,
                    price: productData.variants[0].price,
                    sku: productData.variants[0].sku,
                    hasImage: !!productData.images
                });
                
                // Criar produto
                console.log('🔗 Fazendo POST para /products...');
                const response = await client.post('/products', {
                    data: { product: productData }
                });
                
                console.log('📥 Resposta recebida!');
                console.log('📊 Status:', response.status);
                console.log('📊 StatusText:', response.statusText);
                
                // Verificar se response.data existe
                if (!response.data) {
                    console.log('❌ response.data é undefined');
                    console.log('📄 Resposta completa:', JSON.stringify(response, null, 2));
                    throw new Error('Resposta da API não contém dados');
                }
                
                console.log('📄 Tipo de response.data:', typeof response.data);
                console.log('📄 Keys de response.data:', Object.keys(response.data));
                
                if (response.data.product) {
                    createdCount++;
                    console.log(`✅ Produto criado com sucesso!`);
                    console.log(`   • ID: ${response.data.product.id}`);
                    console.log(`   • Handle: ${response.data.product.handle}`);
                    console.log(`   • Status: ${response.data.product.status}`);
                } else {
                    console.log('❌ response.data.product não existe');
                    console.log('📄 Conteúdo de response.data:', JSON.stringify(response.data, null, 2));
                    
                    // Verificar se há erros na resposta
                    if (response.data.errors) {
                        console.log('🚨 Erros encontrados:', JSON.stringify(response.data.errors, null, 2));
                        throw new Error(`Erro da API: ${JSON.stringify(response.data.errors)}`);
                    } else {
                        throw new Error('Resposta inválida da API - produto não encontrado na resposta');
                    }
                }
                
                // Delay para evitar rate limiting
                console.log('⏸️ Aguardando 2 segundos...');
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                errorCount++;
                console.error(`❌ Erro detalhado no produto ${csvProduct.Title}:`);
                console.error(`   • Mensagem: ${error.message}`);
                console.error(`   • Tipo: ${error.constructor.name}`);
                
                if (error.response) {
                    console.error(`   • Status HTTP: ${error.response.status}`);
                    console.error(`   • StatusText: ${error.response.statusText}`);
                    console.error(`   • Headers:`, Object.fromEntries(error.response.headers.entries()));
                    
                    // Tentar ler o body da resposta de erro
                    try {
                        const errorBody = await error.response.text();
                        console.error(`   • Body: ${errorBody}`);
                    } catch (bodyError) {
                        console.error(`   • Erro ao ler body: ${bodyError.message}`);
                    }
                } else if (error.request) {
                    console.error(`   • Problema de rede`);
                    console.error(`   • Request:`, error.request);
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

