require('dotenv').config();
const fs = require('fs');
const { createAdminApiClient } = require('@shopify/admin-api-client');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '').replace('http://', '') : undefined;
    
    console.log('🔍 Configurando cliente Shopify...');
    console.log('Store Domain:', storeDomain);
    
    // CORREÇÃO: Configuração para versão 1.1.0
    return createAdminApiClient({
        storeDomain: storeDomain,
        apiVersion: '2024-07', // Versão atual suportada
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
        
        // Função para parsear linha CSV respeitando aspas
        function parseCSVLine(line) {
            const result = [];
            let inQuotes = false;
            let currentValue = '';
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        currentValue += '"';
                        i++;
                    } else {
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    result.push(currentValue);
                    currentValue = '';
                } else {
                    currentValue += char;
                }
            }
            
            result.push(currentValue);
            return result;
        }
        
        // Parsear headers
        const headers = parseCSVLine(lines[0]);
        console.log(`📋 Headers encontrados: ${headers.slice(0, 5).join(', ')}...`);
        
        // Parsear produtos
        const products = [];
        let currentProduct = null;
        let validProductCount = 0;
        
        for (let i = 1; i < lines.length; i++) {
            try {
                const values = parseCSVLine(lines[i]);
                
                // Criar objeto com headers e valores
                const product = {};
                headers.forEach((header, index) => {
                    product[header] = values[index] || '';
                });
                
                // Validar se é um produto válido
                const handle = product['Handle'] || '';
                const title = product['Title'] || '';
                
                // Critérios para produto válido
                const isValidProduct = handle && 
                    handle.trim() !== '' && 
                    !handle.startsWith('<') && 
                    !handle.includes('Especificações') &&
                    !handle.includes('table') &&
                    !handle.includes('tbody') &&
                    !handle.includes('Ajax Wireless') &&
                    title && 
                    title.trim() !== '' &&
                    !title.startsWith('<') &&
                    !title.includes('table') &&
                    !title.includes('tbody') &&
                    handle.length < 100 && // Handle não deve ser muito longo
                    title.length < 500; // Título não deve ser muito longo
                
                if (isValidProduct) {
                    if (currentProduct) {
                        products.push(currentProduct);
                    }
                    currentProduct = product;
                    validProductCount++;
                    
                    if (validProductCount % 100 === 0) {
                        console.log(`📦 Produtos válidos encontrados: ${validProductCount}`);
                    }
                } else if (currentProduct && product['Image Src'] && product['Image Src'].trim() !== '') {
                    // Se não é produto válido mas tem imagem, pode ser imagem extra
                    if (!currentProduct.extraImages) {
                        currentProduct.extraImages = [];
                    }
                    
                    currentProduct.extraImages.push({
                        src: product['Image Src'],
                        position: parseInt(product['Image Position'] || '1'),
                        alt: product['Image Alt Text'] || ''
                    });
                }
            } catch (error) {
                console.error(`❌ Erro ao processar linha ${i}:`, error.message);
            }
        }
        
        // Adicionar último produto
        if (currentProduct) {
            products.push(currentProduct);
        }
        
        console.log(`✅ ${validProductCount} produtos válidos encontrados no total`);
        return products;
        
    } catch (error) {
        console.error('❌ Erro ao parsear CSV:', error.message);
        return [];
    }
}

// Função para converter produto CSV para formato Shopify API
function convertToShopifyProduct(csvProduct) {
    try {
        // Validar campos obrigatórios
        const title = csvProduct['Title'] || '';
        const handle = csvProduct['Handle'] || '';
        
        if (!title || !handle || title.startsWith('<') || handle.startsWith('<')) {
            console.log('⚠️ Produto inválido:', handle);
            return null;
        }
        
        // Processar preço
        const priceStr = csvProduct['Variant Price'] || '0';
        let price = 0;
        try {
            price = parseFloat(priceStr.replace(',', '.')) || 0;
        } catch (e) {
            price = 0;
        }
        
        // Se preço é 0, tentar usar preço base
        if (price === 0) {
            price = 1.00; // Preço mínimo
        }
        
        // Processar preço de comparação
        const comparePriceStr = csvProduct['Variant Compare At Price'] || '';
        let comparePrice = null;
        if (comparePriceStr) {
            try {
                comparePrice = parseFloat(comparePriceStr.replace(',', '.'));
            } catch (e) {
                comparePrice = null;
            }
        }
        
        // Processar custo por item
        const costPerItemStr = csvProduct['Cost per item'] || '';
        let costPerItem = null;
        if (costPerItemStr) {
            try {
                costPerItem = parseFloat(costPerItemStr.replace(',', '.'));
            } catch (e) {
                costPerItem = null;
            }
        }
        
        // Processar outros campos
        const sku = csvProduct['Variant SKU'] || '';
        const barcode = csvProduct['Variant Barcode'] || '';
        const inventoryQty = parseInt(csvProduct['Variant Inventory Qty'] || '0');
        
        // Criar variante
        const variant = {
            price: price.toFixed(2),
            sku: sku,
            barcode: barcode,
            inventory_management: 'shopify',
            inventory_quantity: inventoryQty,
            inventory_policy: 'deny',
            fulfillment_service: 'manual',
            requires_shipping: true,
            taxable: true,
            weight_unit: 'g'
        };
        
        // Adicionar preço de comparação se existir
        if (comparePrice && comparePrice > 0) {
            variant.compare_at_price = comparePrice.toFixed(2);
        }
        
        // Adicionar custo por item se existir
        if (costPerItem && costPerItem > 0) {
            variant.cost = costPerItem.toFixed(2);
        }
        
        // Criar produto
        const shopifyProduct = {
            title: title,
            body_html: csvProduct['Body (HTML)'] || '',
            vendor: csvProduct['Vendor'] || '',
            product_type: csvProduct['Type'] || '',
            tags: csvProduct['Tags'] || '',
            status: 'active',
            variants: [variant],
            images: []
        };
        
        // Adicionar imagem principal
        if (csvProduct['Image Src']) {
            shopifyProduct.images.push({
                src: csvProduct['Image Src'],
                position: 1,
                alt: csvProduct['Image Alt Text'] || title
            });
        }
        
        // Adicionar imagens extras
        if (csvProduct.extraImages && Array.isArray(csvProduct.extraImages)) {
            csvProduct.extraImages.forEach(img => {
                shopifyProduct.images.push({
                    src: img.src,
                    position: img.position,
                    alt: img.alt || title
                });
            });
        }
        
        // Logs detalhados
        console.log(`🔍 Produto convertido: ${title}`);
        console.log(`💰 Preço: ${price.toFixed(2)}`);
        if (comparePrice) console.log(`💰 Preço comparação: ${comparePrice.toFixed(2)}`);
        if (costPerItem) console.log(`💰 Custo por item: ${costPerItem.toFixed(2)}`);
        if (barcode) console.log(`📊 EAN/Barcode: ${barcode}`);
        console.log(`🖼️ Imagens: ${shopifyProduct.images.length}`);
        
        return shopifyProduct;
        
    } catch (error) {
        console.error(`❌ Erro ao converter produto:`, error.message);
        return null;
    }
}

// Função para criar produto no Shopify
async function createProduct(client, shopifyProduct) {
    try {
        console.log(`🚀 Criando produto: ${shopifyProduct.title}`);
        
        // CORREÇÃO: Método correto para versão 1.1.0 (GraphQL)
        const mutation = `
            mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                    product {
                        id
                        title
                        handle
                    }
                    userErrors {
                        field
                        message
                    }
                }
            }
        `;
        
        const variables = {
            input: shopifyProduct
        };
        
        console.log('🔗 Fazendo request GraphQL...');
        console.log('📊 Dados do produto:', JSON.stringify(shopifyProduct, null, 2));
        
        const response = await client.request(mutation, { variables });
        
        console.log('📄 Resposta da API:', JSON.stringify(response, null, 2));
        
        // Verificar resposta
        if (response.data && response.data.productCreate && response.data.productCreate.product) {
            const product = response.data.productCreate.product;
            console.log(`✅ Produto criado com sucesso: ${shopifyProduct.title}`);
            console.log(`   • ID: ${product.id}`);
            console.log(`   • Handle: ${product.handle}`);
            return true;
        } else if (response.data && response.data.productCreate && response.data.productCreate.userErrors.length > 0) {
            const errors = response.data.productCreate.userErrors;
            console.error(`❌ Erros de validação para: ${shopifyProduct.title}`);
            errors.forEach(error => {
                console.error(`   • ${error.field}: ${error.message}`);
            });
            return false;
        } else {
            console.error(`❌ Resposta inválida da API para: ${shopifyProduct.title}`);
            console.error('Resposta completa:', JSON.stringify(response, null, 2));
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Erro no produto ${shopifyProduct.title}:`, error.message);
        
        // Log detalhado do erro
        if (error.response) {
            console.error(`   • Status: ${error.response.status || 'desconhecido'}`);
            console.error(`   • Detalhes:`, error.response.data || error.message);
        }
        
        if (error.stack) {
            console.error(`   • Stack:`, error.stack);
        }
        
        return false;
    }
}

// Função principal
async function uploadProductsToShopify(csvFilePath) {
    try {
        console.log('🚀 Iniciando upload para Shopify...');
        console.log(`📁 Ficheiro CSV: ${csvFilePath}`);
        
        // Verificar se o ficheiro existe
        if (!fs.existsSync(csvFilePath)) {
            throw new Error(`Ficheiro não encontrado: ${csvFilePath}`);
        }
        
        // Ler ficheiro CSV
        const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
        console.log(`📄 Ficheiro lido: ${csvContent.length} caracteres`);
        
        // Parsear CSV
        const csvProducts = parseShopifyCSV(csvContent);
        console.log(`🎯 Iniciando processamento de ${csvProducts.length} produtos...`);
        
        // Criar cliente Shopify
        const client = createShopifyClient();
        
        // Processar produtos
        let successCount = 0;
        let errorCount = 0;
        
        // Limitar a 2 produtos para teste
        const maxProducts = 2;
        const productsToProcess = csvProducts.slice(0, maxProducts);
        console.log(`⚠️ Limitando a ${maxProducts} produtos para teste`);
        
        // Processar produtos com rate limiting
        for (let i = 0; i < productsToProcess.length; i++) {
            try {
                console.log(`\n📦 Processando ${i+1}/${productsToProcess.length}: ${productsToProcess[i]['Handle']}`);
                
                // Converter para formato Shopify
                const shopifyProduct = convertToShopifyProduct(productsToProcess[i]);
                
                if (!shopifyProduct) {
                    console.log(`⚠️ Produto inválido: ${productsToProcess[i]['Handle']}`);
                    errorCount++;
                    continue;
                }
                
                // Criar produto
                const success = await createProduct(client, shopifyProduct);
                
                if (success) {
                    successCount++;
                } else {
                    errorCount++;
                }
                
                // Rate limiting - esperar 3s entre requests
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.error(`❌ Erro no produto ${i+1}:`, error.message);
                errorCount++;
            }
        }
        
        // Resumo final
        console.log('\n📊 Resumo do upload:');
        console.log(`   • Produtos processados: ${productsToProcess.length}`);
        console.log(`   • Sucessos: ${successCount}`);
        console.log(`   • Erros: ${errorCount}`);
        
        return {
            total: productsToProcess.length,
            success: successCount,
            errors: errorCount
        };
        
    } catch (error) {
        console.error('🚨 Erro no upload:', error.message);
        throw error;
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    const csvFilePath = process.argv[2];
    
    if (!csvFilePath) {
        console.error('❌ Uso: node upload_to_shopify.js <caminho_csv>');
        process.exit(1);
    }
    
    uploadProductsToShopify(csvFilePath)
        .then(result => {
            console.log('🎉 Upload concluído!');
            process.exit(0);
        })
        .catch(error => {
            console.error('🚨 Erro fatal:', error.message);
            process.exit(1);
        });
}

module.exports = {
    uploadProductsToShopify,
    parseShopifyCSV,
    convertToShopifyProduct,
    createProduct
};

