require('dotenv').config();
const fs = require('fs');
const { createAdminRestApiClient } = require('@shopify/admin-api-client');
const path = require('path');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '').replace('http://', '') : undefined;
    
    console.log('🔍 Configurando cliente Shopify...');
    console.log('Store Domain:', storeDomain);
    
    return createAdminRestApiClient({
        storeDomain: storeDomain,
        apiVersion: '2024-07', // Versão atualizada da API
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
        
        // Função para parsear linha CSV respeitando aspas
        function parseCSVLine(line) {
            const result = [];
            let inQuotes = false;
            let currentValue = '';
            
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                
                if (char === '"') {
                    if (i + 1 < line.length && line[i + 1] === '"') {
                        // Aspas escapadas
                        currentValue += '"';
                        i++; // Pular próximo caractere
                    } else {
                        // Alternar estado de aspas
                        inQuotes = !inQuotes;
                    }
                } else if (char === ',' && !inQuotes) {
                    // Fim do valor
                    result.push(currentValue);
                    currentValue = '';
                } else {
                    // Caractere normal
                    currentValue += char;
                }
            }
            
            // Adicionar último valor
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
                
                // CORREÇÃO: Ignorar linhas que são apenas HTML de especificações
                if (product['Handle'] && 
                    product['Handle'].trim() !== '' && 
                    !product['Handle'].startsWith('<') && 
                    !product['Handle'].includes('Especificações Técnicas')) {
                    
                    if (currentProduct) {
                        products.push(currentProduct);
                    }
                    currentProduct = product;
                    validProductCount++;
                    
                    if (validProductCount % 100 === 0) {
                        console.log(`📦 Produtos válidos encontrados: ${validProductCount}`);
                    }
                } else if (currentProduct && product['Image Src'] && product['Image Src'].trim() !== '') {
                    // Se não tem Handle mas tem imagem, é uma imagem extra do produto atual
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
        if (!csvProduct['Title'] || !csvProduct['Handle'] || 
            csvProduct['Title'].startsWith('<') || 
            csvProduct['Handle'].startsWith('<')) {
            console.log('⚠️ Produto sem título ou handle válido:', csvProduct['Handle'] || 'desconhecido');
            return null;
        }
        
        // Processar preço
        const priceStr = csvProduct['Variant Price'] || '0';
        const price = priceStr ? parseFloat(priceStr.replace(',', '.')) : 0;
        
        // Processar preço de comparação (PVP)
        const comparePriceStr = csvProduct['Variant Compare At Price'] || '';
        const comparePrice = comparePriceStr ? parseFloat(comparePriceStr.replace(',', '.')) : null;
        
        // Processar custo por item
        const costPerItemStr = csvProduct['Cost per item'] || '';
        const costPerItem = costPerItemStr ? parseFloat(costPerItemStr.replace(',', '.')) : null;
        
        // Processar EAN/código de barras
        const barcode = csvProduct['Variant Barcode'] || '';
        
        // Processar SKU
        const sku = csvProduct['Variant SKU'] || '';
        
        // Processar quantidade em estoque
        const inventoryQty = csvProduct['Variant Inventory Qty'] ? 
            parseInt(csvProduct['Variant Inventory Qty']) : 0;
        
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
        if (comparePrice) {
            variant.compare_at_price = comparePrice.toFixed(2);
        }
        
        // Adicionar custo por item se existir
        if (costPerItem) {
            variant.cost = costPerItem.toFixed(2);
        }
        
        // Criar produto
        const shopifyProduct = {
            title: csvProduct['Title'],
            body_html: csvProduct['Body (HTML)'] || '',
            vendor: csvProduct['Vendor'] || '',
            product_type: csvProduct['Type'] || '',
            tags: csvProduct['Tags'] || '',
            status: csvProduct['Status'] || 'active',
            variants: [variant],
            options: [],
            images: []
        };
        
        // Adicionar imagem principal
        if (csvProduct['Image Src']) {
            shopifyProduct.images.push({
                src: csvProduct['Image Src'],
                position: 1,
                alt: csvProduct['Image Alt Text'] || csvProduct['Title']
            });
        }
        
        // Adicionar imagens extras
        if (csvProduct.extraImages && Array.isArray(csvProduct.extraImages)) {
            csvProduct.extraImages.forEach(img => {
                shopifyProduct.images.push({
                    src: img.src,
                    position: img.position,
                    alt: img.alt || csvProduct['Title']
                });
            });
        }
        
        // Logs detalhados para debugging
        console.log(`🔍 Produto convertido: ${csvProduct['Title']}`);
        console.log(`💰 Preço: ${price.toFixed(2)}`);
        if (comparePrice) console.log(`💰 Preço comparação: ${comparePrice.toFixed(2)}`);
        if (costPerItem) console.log(`💰 Custo por item: ${costPerItem.toFixed(2)}`);
        if (barcode) console.log(`📊 EAN/Barcode: ${barcode}`);
        console.log(`🖼️ Imagens: ${shopifyProduct.images.length}`);
        
        return shopifyProduct;
        
    } catch (error) {
        console.error(`❌ Erro ao converter produto ${csvProduct['Title'] || 'desconhecido'}:`, error.message);
        return null;
    }
}

// Função para criar produto no Shopify
async function createProduct(client, shopifyProduct) {
    try {
        console.log(`🚀 Criando produto: ${shopifyProduct.title}`);
        
        // CORREÇÃO: Usar método correto para API Shopify
        const response = await client.request({
            method: "POST",
            path: "products",
            data: { product: shopifyProduct },
            type: "json"
        });
        
        // Verificar resposta por status HTTP
        if (response.status === 201) {
            console.log(`✅ Produto criado com sucesso: ${shopifyProduct.title}`);
            return true;
        } else {
            console.error(`❌ Erro ao criar produto: Status ${response.status}`);
            return false;
        }
        
    } catch (error) {
        console.error(`❌ Erro no produto ${shopifyProduct.title}:`, error.message);
        
        // Tentar extrair detalhes do erro
        if (error.response) {
            try {
                const errorBody = await error.response.text();
                console.error(`Body: ${errorBody}`);
            } catch (e) {
                console.error('Não foi possível extrair corpo da resposta');
            }
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
        
        // CORREÇÃO: Limitar a 10 produtos para teste
        const maxProducts = 10;
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
                    console.log(`❌ Erro no produto ${productsToProcess[i]['Title']}`);
                }
                
                // Rate limiting - esperar 1s entre requests
                await new Promise(resolve => setTimeout(resolve, 1000));
                
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
    // Obter caminho do ficheiro CSV
    const csvFilePath = process.argv[2];
    
    if (!csvFilePath) {
        console.error('❌ Uso: node upload_to_shopify.js <caminho_csv>');
        process.exit(1);
    }
    
    // Executar upload
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

