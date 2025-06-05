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

// Função para ler CSV Shopify com parsing robusto
function parseShopifyCSV(csvContent) {
    try {
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            console.log('❌ CSV vazio');
            return [];
        }
        
        console.log(`📄 ${lines.length} linhas encontradas no CSV`);
        
        // Parsing mais robusto para CSV com vírgulas nos valores
        const headers = parseCSVLine(lines[0]);
        const products = [];
        
        console.log('📋 Headers encontrados:', headers.slice(0, 5).join(', ') + '...');
        console.log('📋 Total headers:', headers.length);
        
        // Processar linhas
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = parseCSVLine(lines[i]);
                
                if (values.length !== headers.length) {
                    console.log(`⚠️ Linha ${i}: ${values.length} valores vs ${headers.length} headers`);
                    continue;
                }
                
                const product = {};
                headers.forEach((header, index) => {
                    product[header] = values[index] || '';
                });
                
                // Apenas processar linhas com Handle e Title
                if (product.Handle && product.Title) {
                    products.push(product);
                    
                    // Log detalhado dos primeiros produtos
                    if (products.length <= 3) {
                        console.log(`📦 Produto ${products.length}:`, {
                            Handle: product.Handle,
                            Title: product.Title,
                            Vendor: product.Vendor,
                            Price: product['Variant Price'],
                            SKU: product['Variant SKU'],
                            ImageSrc: product['Image Src'] ? 'SIM' : 'NÃO'
                        });
                    }
                    
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

// Função para parsear linha CSV com vírgulas nos valores
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
                i++; // Pular próxima aspa
            } else {
                // Alternar estado das aspas
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            // Vírgula fora das aspas = separador
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    // Adicionar último valor
    result.push(current.trim());
    
    return result;
}

// Função para converter produto com validação completa
function convertToShopifyProduct(csvProduct) {
    console.log(`🔧 Convertendo produto: ${csvProduct.Title}`);
    console.log(`📋 Dados CSV recebidos:`, {
        Handle: csvProduct.Handle,
        Title: csvProduct.Title,
        Vendor: csvProduct.Vendor,
        Type: csvProduct.Type,
        Tags: csvProduct.Tags,
        'Variant Price': csvProduct['Variant Price'],
        'Variant SKU': csvProduct['Variant SKU'],
        'Variant Inventory Qty': csvProduct['Variant Inventory Qty'],
        'Image Src': csvProduct['Image Src'] ? 'SIM' : 'NÃO',
        'Body (HTML)': csvProduct['Body (HTML)'] ? 'SIM' : 'NÃO'
    });
    
    // Validar campos obrigatórios
    if (!csvProduct.Title || csvProduct.Title.trim() === '') {
        throw new Error('Título é obrigatório');
    }
    
    // Processar preço corretamente
    const priceStr = csvProduct['Variant Price'] || '0';
    const price = parseFloat(priceStr.replace(',', '.')) || 1.00;
    console.log(`💰 Preço processado: "${priceStr}" → ${price}`);
    
    // Processar quantidade de stock
    const inventoryQtyStr = csvProduct['Variant Inventory Qty'] || '0';
    const inventoryQty = parseInt(inventoryQtyStr) || 0;
    console.log(`📦 Stock processado: "${inventoryQtyStr}" → ${inventoryQty}`);
    
    // Processar SKU
    const sku = csvProduct['Variant SKU'] || csvProduct.Handle || '';
    console.log(`🏷️ SKU processado: "${csvProduct['Variant SKU']}" → "${sku}"`);
    
    const product = {
        title: csvProduct.Title.trim(),
        body_html: csvProduct['Body (HTML)'] || '',
        vendor: csvProduct.Vendor || '',
        product_type: csvProduct.Type || '',
        tags: csvProduct.Tags || '',
        status: 'active',
        variants: [{
            price: price.toFixed(2),
            sku: sku,
            inventory_management: 'shopify',
            inventory_quantity: inventoryQty,
            weight: 0,
            weight_unit: 'g'
        }]
    };
    
    // Adicionar imagem se disponível
    if (csvProduct['Image Src'] && csvProduct['Image Src'].trim() !== '') {
        const imageSrc = csvProduct['Image Src'].trim();
        console.log(`🖼️ Adicionando imagem: ${imageSrc}`);
        product.images = [{
            src: imageSrc,
            alt: csvProduct['Image Alt Text'] || csvProduct.Title
        }];
    } else {
        console.log(`🖼️ Sem imagem disponível`);
    }
    
    console.log(`✅ Produto convertido final:`, {
        title: product.title,
        vendor: product.vendor,
        product_type: product.product_type,
        tags: product.tags,
        price: product.variants[0].price,
        sku: product.variants[0].sku,
        inventory_quantity: product.variants[0].inventory_quantity,
        hasImage: !!product.images,
        hasBodyHtml: !!product.body_html
    });
    
    return product;
}

// Função principal corrigida
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
                
                // Criar produto
                console.log('🔗 Fazendo POST para /products...');
                const response = await client.post('/products', {
                    data: { product: productData }
                });
                
                console.log('📥 Resposta recebida!');
                console.log('📊 Status:', response.status);
                console.log('📊 StatusText:', response.statusText);
                
                // Verificar status de sucesso
                if (response.status === 201 || response.status === 200) {
                    createdCount++;
                    console.log(`✅ Produto criado com sucesso! (Status: ${response.status})`);
                    
                    // Tentar extrair dados da resposta se disponível
                    try {
                        if (response.data && response.data.product) {
                            console.log(`   • ID: ${response.data.product.id}`);
                            console.log(`   • Handle: ${response.data.product.handle}`);
                        } else {
                            console.log(`   • Produto criado mas dados da resposta não disponíveis`);
                        }
                    } catch (dataError) {
                        console.log(`   • Produto criado mas erro ao ler dados: ${dataError.message}`);
                    }
                } else {
                    throw new Error(`Status HTTP inesperado: ${response.status}`);
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
                    
                    // Tentar ler o body da resposta de erro
                    try {
                        const errorBody = await error.response.text();
                        console.error(`   • Body: ${errorBody}`);
                    } catch (bodyError) {
                        console.error(`   • Erro ao ler body: ${bodyError.message}`);
                    }
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

