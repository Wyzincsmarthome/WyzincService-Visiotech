require('dotenv').config();
const fs = require('fs');
const { createAdminRestApiClient } = require('@shopify/admin-api-client');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '' ).replace('http://', '' ) : undefined;
    
    console.log('🔍 Configurando cliente Shopify...');
    console.log('Store Domain:', storeDomain);
    
    return createAdminRestApiClient({
        storeDomain: storeDomain,
        apiVersion: '2023-04',
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    });
}

// Função SIMPLIFICADA para ler CSV Shopify
function parseShopifyCSV(csvContent) {
    try {
        const lines = csvContent.split('\n').filter(line => line.trim());
        if (lines.length === 0) {
            console.log('❌ CSV vazio');
            return [];
        }
        
        console.log(`📄 ${lines.length} linhas encontradas no CSV`);
        
        // Usar split simples por vírgula (assumindo que não há vírgulas nos valores)
        const headers = lines[0].split(',').map(h => h.trim());
        const products = [];
        
        console.log('📋 Headers encontrados:', headers.slice(0, 5).join(', ') + '...');
        
        for (let i = 1; i < Math.min(lines.length, 11); i++) { // LIMITE: apenas 10 produtos para teste
            const values = lines[i].split(',');
            const product = {};
            
            headers.forEach((header, index) => {
                product[header] = values[index] ? values[index].trim().replace(/"/g, '') : '';
            });
            
            // Apenas processar linhas com Handle e Title
            if (product.Handle && product.Title) {
                products.push(product);
                console.log(`📦 Produto ${i}: ${product.Title}`);
            }
        }
        
        console.log(`✅ ${products.length} produtos válidos encontrados`);
        return products;
        
    } catch (error) {
        console.error('🚨 Erro ao parsear CSV:', error.message);
        return [];
    }
}

// Função SIMPLIFICADA para converter produto
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

// Função principal SIMPLIFICADA
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
        
        // Criar cliente Shopify
        const client = createShopifyClient();
        
        let createdCount = 0;
        let errorCount = 0;
        
        // Processar apenas os primeiros produtos (teste)
        for (let i = 0; i < Math.min(csvProducts.length, 3); i++) {
            const csvProduct = csvProducts[i];
            
            try {
                console.log(`\n📦 Processando ${i + 1}/${csvProducts.length}: ${csvProduct.Title}`);
                
                const productData = convertToShopifyProduct(csvProduct);
                
                // Criar produto
                const response = await client.post('/products', {
                    data: { product: productData }
                });
                
                if (response.data && response.data.product) {
                    createdCount++;
                    console.log(`✅ Produto criado: ${csvProduct.Title} (ID: ${response.data.product.id})`);
                } else {
                    throw new Error('Resposta inválida da API');
                }
                
                // Delay para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 1000));
                
            } catch (error) {
                errorCount++;
                console.error(`❌ Erro no produto ${csvProduct.Title}:`, error.message);
            }
        }
        
        console.log('\n🎉 Upload concluído!');
        console.log(`📊 Estatísticas:`);
        console.log(` • Produtos criados: ${createdCount}`);
        console.log(` • Erros: ${errorCount}`);
        
        return { created: createdCount, errors: errorCount };
        
    } catch (error) {
        console.error('🚨 Erro no upload:', error.message);
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
