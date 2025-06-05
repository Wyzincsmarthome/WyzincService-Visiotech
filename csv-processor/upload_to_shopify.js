require('dotenv').config();
const fs = require('fs');
const { createAdminApiClient } = require('@shopify/admin-api-client');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '').replace('http://', '') : undefined;
    
    console.log('🔍 Configurando cliente Shopify...');
    console.log('Store Domain:', storeDomain);
    
    return createAdminApiClient({
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
                    handle.length < 100 && 
                    title.length < 500;
                
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

// Função para converter produto CSV para formato Shopify GraphQL
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
        
        if (price === 0) {
            price = 1.00;
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
        
        // CORREÇÃO: Formato correto para GraphQL ProductInput
        const shopifyProduct = {
            title: title,
            descriptionHtml: csvProduct['Body (HTML)'] || '', // body_html → descriptionHtml
            vendor: csvProduct['Vendor'] || '',
            productType: csvProduct['Type'] || '', // product_type → productType
            tags: csvProduct['Tags'] ? csvProduct['Tags'].split(',').map(tag => tag.trim()) : [], // string → array
            status: 'ACTIVE', // "active" → "ACTIVE"
            variants: [
                {
                    price: price.toFixed(2),
                    sku: sku,
                    barcode: barcode,
                    inventoryManagement: 'SHOPIFY', // inventory_management → inventoryManagement
                    inventoryQuantities: [
                        {
                            availableQuantity: inventoryQty,
                            locationId: 'gid://shopify/Location/1' // ID padrão da localização
                        }
                    ],
                    inventoryPolicy: 'DENY', // inventory_policy → inventoryPolicy
                    fulfillmentService: 'MANUAL', // fulfillment_service → fulfillmentService
                    requiresShipping: true, // requires_shipping → requiresShipping
                    taxable: true,
                    weight: 0,
                    weightUnit: 'GRAMS' // weight_unit → weightUnit
                }
            ]
        };
        
        // Adicionar preço de comparação se existir
        if (comparePrice && comparePrice > 0) {
            shopifyProduct.variants[0].compareAtPrice = comparePrice.toFixed(2);
        }
        
        // Adicionar custo por item se existir
        if (costPerItem && costPerItem > 0) {
            shopifyProduct.variants[0].cost = costPerItem.toFixed(2);
        }
        
        // Adicionar imagens
        const images = [];
        
        // Imagem principal
        if (csvProduct['Image Src']) {
            images.push({
                src: csvProduct['Image Src'],
                altText: csvProduct['Image Alt Text'] || title
            });
        }
        
        // Imagens extras
        if (csvProduct.extraImages && Array.isArray(csvProduct.extraImages)) {
            csvProduct.extraImages.forEach(img => {
                images.push({
                    src: img.src,
                    altText: img.alt || title
                });
            });
        }
        
        if (images.length > 0) {
            shopifyProduct.images = images;
        }
        
        // Logs detalhados
        console.log(`🔍 Produto convertido: ${title}`);
        console.log(`💰 Preço: ${price.toFixed(2)}`);
        if (comparePrice) console.log(`💰 Preço comparação: ${comparePrice.toFixed(2)}`);
        if (costPerItem) console.log(`💰 Custo por item: ${costPerItem.toFixed(2)}`);
        if (barcode) console.log(`📊 EAN/Barcode: ${barcode}`);
        console.log(`🖼️ Imagens: ${images.length}`);
        
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
        
        // CORREÇÃO: Mutation GraphQL correta para ProductInput
        const mutation = `
            mutation productCreate($input: ProductInput!) {
                productCreate(input: $input) {
                    product {
                        id
                        title
                        handle
                        status
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
            console.log(`   • Status: ${product.status}`);
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
        
        if (!fs.existsSync(csvFilePath)) {
            throw new Error(`Ficheiro não encontrado: ${csvFilePath}`);
        }
        
        const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
        console.log(`📄 Ficheiro lido: ${csvContent.length} caracteres`);
        
        const csvProducts = parseShopifyCSV(csvContent);
        console.log(`🎯 Iniciando processamento de ${csvProducts.length} produtos...`);
        
        const client = createShopifyClient();
        
        let successCount = 0;
        let errorCount = 0;
        
        // Limitar a 2 produtos para teste
        const maxProducts = 2;
        const productsToProcess = csvProducts.slice(0, maxProducts);
        console.log(`⚠️ Limitando a ${maxProducts} produtos para teste`);
        
        for (let i = 0; i < productsToProcess.length; i++) {
            try {
                console.log(`\n📦 Processando ${i+1}/${productsToProcess.length}: ${productsToProcess[i]['Handle']}`);
                
                const shopifyProduct = convertToShopifyProduct(productsToProcess[i]);
                
                if (!shopifyProduct) {
                    console.log(`⚠️ Produto inválido: ${productsToProcess[i]['Handle']}`);
                    errorCount++;
                    continue;
                }
                
                const success = await createProduct(client, shopifyProduct);
                
                if (success) {
                    successCount++;
                } else {
                    errorCount++;
                }
                
                // Rate limiting
                await new Promise(resolve => setTimeout(resolve, 3000));
                
            } catch (error) {
                console.error(`❌ Erro no produto ${i+1}:`, error.message);
                errorCount++;
            }
        }
        
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

