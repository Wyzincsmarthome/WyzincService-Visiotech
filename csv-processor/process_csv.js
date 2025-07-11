require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

// --- CONFIGURAÇÃO ---
const CSV_INPUT_PATH = path.join(__dirname, '../csv-input/products.csv'); // O nome do seu ficheiro CSV
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const API_VERSION = '2025-07';
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };
const UNIQUE_PRODUCT_IDENTIFIER = 'name'; // Usaremos a coluna 'name' do CSV como SKU

// --- FUNÇÕES DA API SHOPIFY ---

/**
 * Obtém um mapa de todos os SKUs existentes na loja para uma verificação rápida.
 * @returns {Promise<Map<string, string>>} Um mapa onde a chave é o SKU e o valor é o GID do produto.
 */
async function getExistingShopifySkus() {
    console.log('🔄 A obter SKUs existentes da Shopify...');
    const skus = new Map();
    let hasNextPage = true;
    let cursor = null;

    const query = `
        query getProducts($cursor: String) {
            products(first: 100, after: $cursor) {
                pageInfo { hasNextPage }
                edges {
                    cursor
                    node {
                        id
                        variants(first: 10) {
                            edges { node { sku } }
                        }
                    }
                }
            }
        }`;

    while (hasNextPage) {
        const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables: { cursor } }, { headers });
        const { products } = response.data.data;
        
        for (const productEdge of products.edges) {
            const productId = productEdge.node.id;
            for (const variantEdge of productEdge.node.variants.edges) {
                if (variantEdge.node.sku) {
                    skus.set(variantEdge.node.sku, productId);
                }
            }
            cursor = productEdge.cursor;
        }
        hasNextPage = products.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${skus.size} SKUs existentes.`);
    return skus;
}

/**
 * Cria um novo produto na Shopify.
 * @param {object} product - O objeto do produto transformado.
 */
async function createShopifyProduct(product) {
    console.log(`➕ A criar novo produto: ${product.title}`);
    const mutation = `
        mutation productCreate($input: ProductInput!) {
            productCreate(input: $input) {
                product { id, title }
                userErrors { field, message }
            }
        }`;
    
    const input = {
        title: product.title,
        vendor: product.vendor,
        productType: product.productType,
        descriptionHtml: product.descriptionHtml,
        tags: product.tags,
        status: 'ACTIVE',
        images: product.images,
        variants: [{
            price: product.price,
            sku: product.sku,
            inventoryItem: { tracked: true },
            inventoryQuantities: [{
                availableQuantity: product.stock,
                locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`
            }]
        }]
    };
    
    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: mutation, variables: { input } }, { headers });
    if (response.data.errors) throw new Error(`Erro GraphQL ao criar: ${response.data.errors[0].message}`);
    if (response.data.data.productCreate.userErrors.length > 0) throw new Error(`Erro API ao criar: ${response.data.data.productCreate.userErrors[0].message}`);
    
    console.log(`   -> ✅ Produto "${product.title}" criado com sucesso.`);
}

/**
 * Atualiza um produto existente na Shopify.
 * @param {string} productId - O GID do produto a atualizar.
 * @param {object} product - O objeto do produto transformado.
 */
async function updateShopifyProduct(productId, product) {
    console.log(`🔄 A atualizar produto existente: ${product.title}`);
    const mutation = `
        mutation productUpdate($input: ProductInput!) {
            productUpdate(input: $input) {
                product { id }
                userErrors { field, message }
            }
        }`;

    // Apenas atualizamos os campos que queremos. O ID da variante é necessário se quisermos atualizar o preço/stock.
    // Para simplificar, vamos atualizar apenas os campos principais. A atualização de variantes é mais complexa.
    const input = {
        id: productId,
        title: product.title, // Pode querer remover isto se não quiser atualizar o título
        vendor: product.vendor,
        productType: product.productType,
        descriptionHtml: product.descriptionHtml,
        tags: product.tags,
        // A atualização de imagens e stock de variantes é mais complexa e omitida para esta primeira versão.
    };

    const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query: mutation, variables: { input } }, { headers });
    if (response.data.errors) throw new Error(`Erro GraphQL ao atualizar: ${response.data.errors[0].message}`);
    if (response.data.data.productUpdate.userErrors.length > 0) throw new Error(`Erro API ao atualizar: ${response.data.data.productUpdate.userErrors[0].message}`);

    console.log(`   -> ✅ Produto "${product.title}" atualizado com sucesso.`);
}

// --- FUNÇÃO PRINCIPAL ---

async function main() {
    try {
        console.log("🚀 Iniciando processo de sincronização de produtos do CSV.");

        // Validação das variáveis de ambiente
        if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN || !SHOPIFY_LOCATION_ID) {
            throw new Error("As variáveis de ambiente SHOPIFY_STORE_URL, SHOPIFY_ACCESS_TOKEN e SHOPIFY_LOCATION_ID são obrigatórias.");
        }

        const existingSkus = await getExistingShopifySkus();
        const productsToProcess = [];

        // Ler e processar o CSV
        fs.createReadStream(CSV_INPUT_PATH)
            .pipe(csv({ separator: '\t' })) // IMPORTANTE: Usar tabulação como separador
            .on('data', (row) => {
                try {
                    // Limpar e transformar os dados da linha do CSV
                    const eanString = String(row.ean).includes('E+') ? BigInt(row.ean).toString() : String(row.ean);
                    const allImages = [row.image_path];
                    if (row.extra_images_paths) {
                        try {
                            const extraImages = JSON.parse(row.extra_images_paths).details;
                            if (Array.isArray(extraImages)) {
                                allImages.push(...extraImages.filter(img => !img.includes('_thumb.')));
                            }
                        } catch (e) { /* ignorar JSON inválido */ }
                    }

                    const transformedProduct = {
                        sku: row[UNIQUE_PRODUCT_IDENTIFIER],
                        title: row.name,
                        vendor: row.brand,
                        productType: row.category_parent,
                        descriptionHtml: row.description || row.short_description_html || '',
                        tags: [row.brand, row.category_parent, row.category].filter(Boolean).join(','),
                        price: (row.PVP || row.msrp || '0').replace(',', '.'),
                        stock: row.stock === 'high' ? 100 : (row.stock === 'low' ? 5 : 0),
                        images: allImages.filter(Boolean).map(src => ({ src })),
                        ean: eanString
                    };
                    productsToProcess.push(transformedProduct);
                } catch (transformError) {
                    console.warn(`⚠️ Erro ao transformar a linha com SKU ${row[UNIQUE_PRODUCT_IDENTIFIER]}: ${transformError.message}`);
                }
            })
            .on('end', async () => {
                console.log(`\n✅ Ficheiro CSV lido. ${productsToProcess.length} produtos para sincronizar.`);
                let createdCount = 0;
                let updatedCount = 0;

                // Loop para criar ou atualizar produtos
                for (const product of productsToProcess) {
                    if (!product.sku) {
                        console.warn(`   -> ⚠️ Pulando produto sem SKU: ${product.title}`);
                        continue;
                    }
                    
                    if (existingSkus.has(product.sku)) {
                        const productId = existingSkus.get(product.sku);
                        await updateShopifyProduct(productId, product);
                        updatedCount++;
                    } else {
                        await createShopifyProduct(product);
                        createdCount++;
                    }
                    // Pequena pausa para não sobrecarregar a API
                    await new Promise(resolve => setTimeout(resolve, 500)); 
                }

                console.log(`\n🎉 Sincronização concluída!`);
                console.log(`   - ${createdCount} produtos criados.`);
                console.log(`   - ${updatedCount} produtos atualizados.`);
            });

    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    }
}

main();
