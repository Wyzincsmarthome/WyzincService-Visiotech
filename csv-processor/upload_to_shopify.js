require('dotenv').config();
const fs = require('fs');
const { createAdminRestApiClient } = require('@shopify/admin-api-client');

// Configurar cliente Shopify
function createShopifyClient() {
    const storeUrl = process.env.SHOPIFY_STORE_URL;
    const storeDomain = storeUrl ? storeUrl.replace('https://', '').replace('http://', '') : undefined;
    
    return createAdminRestApiClient({
        storeDomain: storeDomain,
        apiVersion: '2023-04',
        accessToken: process.env.SHOPIFY_ACCESS_TOKEN,
    });
}

// Função para ler CSV Shopify
function parseShopifyCSV(csvContent) {
    const lines = csvContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) return [];
    
    const headers = lines[0].split(',');
    const products = [];
    
    for (let i = 1; i < lines.length; i++) {
        const values = parseCSVLine(lines[i]);
        const product = {};
        
        headers.forEach((header, index) => {
            product[header.trim()] = values[index] ? values[index].trim() : '';
        });
        
        // Apenas processar linhas com Handle (produtos principais)
        if (product.Handle && product.Title) {
            products.push(product);
        }
    }
    
    return products;
}

// Função para parsear linha CSV com aspas
function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current);
    return result;
}

// Função para converter produto CSV para formato Shopify API
function convertToShopifyProduct(csvProduct) {
    const product = {
        title: csvProduct.Title,
        body_html: csvProduct['Body (HTML)'],
        vendor: csvProduct.Vendor,
        product_type: csvProduct.Type,
        tags: csvProduct.Tags,
        status: csvProduct.Status === 'active' ? 'active' : 'draft',
        variants: [
            {
                price: csvProduct['Variant Price'],
                compare_at_price: csvProduct['Variant Compare At Price'] || null,
                sku: csvProduct['Variant SKU'],
                barcode: csvProduct['Variant Barcode'],
                inventory_management: 'shopify',
                inventory_policy: csvProduct['Variant Inventory Policy'] || 'deny',
                inventory_quantity: parseInt(csvProduct['Variant Inventory Qty']) || 0,
                requires_shipping: csvProduct['Variant Requires Shipping'] === 'TRUE',
                taxable: csvProduct['Variant Taxable'] === 'TRUE',
                weight: parseFloat(csvProduct['Variant Grams']) || 0,
                weight_unit: 'g'
            }
        ],
        images: []
    };
    
    // Adicionar imagem principal
    if (csvProduct['Image Src']) {
        product.images.push({
            src: csvProduct['Image Src'],
            alt: csvProduct['Image Alt Text'] || csvProduct.Title
        });
    }
    
    // SEO
    if (csvProduct['SEO Title'] || csvProduct['SEO Description']) {
        product.metafields = [
            {
                namespace: 'global',
                key: 'title_tag',
                value: csvProduct['SEO Title'],
                type: 'single_line_text_field'
            },
            {
                namespace: 'global',
                key: 'description_tag',
                value: csvProduct['SEO Description'],
                type: 'multi_line_text_field'
            }
        ];
    }
    
    return product;
}

// Função para verificar se produto já existe
async function findExistingProduct(client, sku) {
    try {
        const response = await client.get('/products', {
            query: {
                fields: 'id,handle,variants',
                limit: 250
            }
        });
        
        if (response.data && response.data.products) {
            for (const product of response.data.products) {
                if (product.variants) {
                    for (const variant of product.variants) {
                        if (variant.sku === sku) {
                            return { productId: product.id, variantId: variant.id };
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.log(`Erro ao procurar produto com SKU ${sku}:`, error.message);
    }
    
    return null;
}

// Função para criar produto no Shopify
async function createShopifyProduct(client, productData) {
    try {
        const response = await client.post('/products', {
            data: { product: productData }
        });
        
        if (response.data && response.data.product) {
            return response.data.product;
        }
        
        throw new Error('Resposta inválida da API Shopify');
        
    } catch (error) {
        console.error('Erro ao criar produto:', error.message);
        throw error;
    }
}

// Função para atualizar produto existente
async function updateShopifyProduct(client, productId, variantId, productData) {
    try {
        // Atualizar dados do produto
        await client.put(`/products/${productId}`, {
            data: {
                product: {
                    title: productData.title,
                    body_html: productData.body_html,
                    vendor: productData.vendor,
                    product_type: productData.product_type,
                    tags: productData.tags,
                    status: productData.status
                }
            }
        });
        
        // Atualizar variante
        if (productData.variants && productData.variants[0]) {
            await client.put(`/variants/${variantId}`, {
                data: { variant: productData.variants[0] }
            });
        }
        
        console.log(`✅ Produto ${productId} atualizado`);
        return true;
        
    } catch (error) {
        console.error(`Erro ao atualizar produto ${productId}:`, error.message);
        throw error;
    }
}

// Função principal para upload
async function uploadToShopify(csvFilePath) {
    try {
        console.log('🚀 Iniciando upload para Shopify...');
        
        // Ler CSV
        const csvContent = fs.readFileSync(csvFilePath, 'utf-8');
        const csvProducts = parseShopifyCSV(csvContent);
        
        console.log(`📊 ${csvProducts.length} produtos encontrados no CSV`);
        
        // Criar cliente Shopify
        const client = createShopifyClient();
        
        let createdCount = 0;
        let updatedCount = 0;
        let errorCount = 0;
        
        // Processar cada produto
        for (let i = 0; i < csvProducts.length; i++) {
            const csvProduct = csvProducts[i];
            const sku = csvProduct['Variant SKU'];
            
            try {
                console.log(`\n📦 Processando ${i + 1}/${csvProducts.length}: ${csvProduct.Title}`);
                
                // Converter para formato Shopify
                const productData = convertToShopifyProduct(csvProduct);
                
                // Verificar se produto já existe
                const existing = await findExistingProduct(client, sku);
                
                if (existing) {
                    // Atualizar produto existente
                    await updateShopifyProduct(client, existing.productId, existing.variantId, productData);
                    updatedCount++;
                    console.log(`🔄 Produto atualizado: ${csvProduct.Title}`);
                } else {
                    // Criar novo produto
                    const newProduct = await createShopifyProduct(client, productData);
                    createdCount++;
                    console.log(`✅ Produto criado: ${csvProduct.Title} (ID: ${newProduct.id})`);
                }
                
                // Delay para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
                
            } catch (error) {
                errorCount++;
                console.error(`❌ Erro no produto ${csvProduct.Title}:`, error.message);
            }
        }
        
        console.log('\n🎉 Upload concluído!');
        console.log(`📊 Estatísticas:`);
        console.log(`   • Produtos criados: ${createdCount}`);
        console.log(`   • Produtos atualizados: ${updatedCount}`);
        console.log(`   • Erros: ${errorCount}`);
        
        return {
            created: createdCount,
            updated: updatedCount,
            errors: errorCount,
            total: csvProducts.length
        };
        
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


