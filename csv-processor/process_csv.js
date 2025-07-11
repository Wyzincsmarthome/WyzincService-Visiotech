require('dotenv').config();
const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const axios = require('axios');

// --- CONFIGURAÇÃO ---
const CSV_INPUT_PATH = path.join(__dirname, '../csv-input/visiotech_connect.csv');
const SHOPIFY_STORE_URL = process.env.SHOPIFY_STORE_URL;
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_LOCATION_ID = process.env.SHOPIFY_LOCATION_ID;
const API_VERSION = '2024-10'; // Usar uma versão LTS estável
const SHOPIFY_GRAPHQL_ENDPOINT = `https://${SHOPIFY_STORE_URL}/admin/api/${API_VERSION}/graphql.json`;
const HEADERS = { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': SHOPIFY_ACCESS_TOKEN };
const SKU_COLUMN_NAME = 'name'; // A coluna 'name' do CSV funciona como SKU

// --- LÓGICA DE TRANSFORMAÇÃO (Inspirada no seu ficheiro csv_transformer.js) ---

const translations = { 'Sirena': 'Sirene', 'Exterior': 'Exterior', /* Adicione aqui mais traduções se necessário */ };

function translateText(text) {
    if (!text || typeof text !== 'string') return '';
    let translatedText = text;
    for (const [spanish, portuguese] of Object.entries(translations)) {
        const regex = new RegExp(`\\b${spanish}\\b`, 'gi');
        translatedText = translatedText.replace(regex, portuguese);
    }
    return translatedText;
}

function normalizeBrand(brand) {
    if (!brand || typeof brand !== 'string') return '';
    return brand.charAt(0).toUpperCase() + brand.slice(1).toLowerCase();
}

function parseEan(eanValue) {
    if (!eanValue || typeof eanValue !== 'string') return '';
    if (eanValue.includes('E+')) {
        try { return BigInt(Math.round(parseFloat(eanValue.replace(',', '.')))).toString(); }
        catch (e) { return eanValue; }
    }
    return eanValue.trim();
}

function parseImages(mainImage, extraImagesJson) {
    const allImages = [mainImage];
    if (extraImagesJson) {
        try {
            const extra = JSON.parse(extraImagesJson).details;
            if (Array.isArray(extra)) allImages.push(...extra.filter(img => img && !img.includes('_thumb.')));
        } catch (e) { /* Ignorar */ }
    }
    return allImages.filter(Boolean).map(src => ({ src }));
}

function parseStock(stockValue) {
    const stockLower = (stockValue || '').toLowerCase();
    if (stockLower.includes('high') || stockLower.includes('disponível')) return 100;
    if (stockLower.includes('low') || stockLower.includes('reduzido')) return 5;
    return 0;
}

function transformRowToProduct(row) {
    const brand = normalizeBrand(row.brand || '');
    const title = translateText(row.short_description || row.name || '');
    const description = translateText(row.description || '');
    const specifications = translateText(row.specifications || '');
    
    return {
        sku: row[SKU_COLUMN_NAME],
        title: title,
        vendor: brand,
        productType: translateText(row.category_parent || ''),
        bodyHtml: `${description}<br><br><h3>Especificações</h3>${specifications}`,
        tags: [brand, translateText(row.category_parent), translateText(row.category)].filter(Boolean).join(', '),
        price: (row.PVP || row.precio_venta_cliente_final || row.msrp || '0').replace(',', '.'),
        stock: parseStock(row.stock),
        images: parseImages(row.image_path, row.extra_images_paths),
        ean: parseEan(row.ean)
    };
}


// --- LÓGICA DA API SHOPIFY (O processo correto de 3 passos) ---

async function callShopifyApi(query, variables) {
    try {
        const response = await axios.post(SHOPIFY_GRAPHQL_ENDPOINT, { query, variables }, { headers: HEADERS });
        if (response.data.errors) {
            throw new Error(response.data.errors.map(e => e.message).join(', '));
        }
        const responseData = response.data.data;
        const mutationResultKey = Object.keys(responseData)[0];
        const mutationResult = responseData[mutationResultKey];
        if (mutationResult.userErrors && mutationResult.userErrors.length > 0) {
            throw new Error(mutationResult.userErrors.map(e => `${e.field}: ${e.message}`).join(', '));
        }
        return mutationResult;
    } catch (error) {
        // Log detalhado do erro da API
        if (error.response) {
            console.error('❌ Erro na resposta da API:', JSON.stringify(error.response.data, null, 2));
        }
        throw error; // Re-lançar o erro para ser capturado pela função que chamou
    }
}

async function getExistingShopifyProducts() {
    console.log('🔄 A obter produtos existentes da Shopify...');
    const products = new Map();
    let hasNextPage = true;
    let cursor = null;
    const query = `query getProducts($cursor: String) { products(first: 250, after: $cursor) { pageInfo { hasNextPage }, edges { cursor, node { id, handle, variants(first: 1) { edges { node { id, sku } } } } } } }`;

    while (hasNextPage) {
        const responseData = await callShopifyApi(query, { cursor });
        const responseProducts = responseData.products;
        for (const productEdge of responseProducts.edges) {
            const product = productEdge.node;
            const firstVariant = product.variants.edges[0]?.node;
            if (firstVariant?.sku) {
                products.set(firstVariant.sku, { productId: product.id, variantId: firstVariant.id });
            }
            cursor = productEdge.cursor;
        }
        hasNextPage = responseProducts.pageInfo.hasNextPage;
    }
    console.log(`✅ Encontrados ${products.size} produtos existentes.`);
    return products;
}

async function manageProduct(ids, productData, isNewProduct) {
    const action = isNewProduct ? 'criar' : 'atualizar';
    let { productId, variantId } = ids || {};

    console.log(`\n📦 A ${action} produto: ${productData.title}`);

    // PASSO 1: Criar o esqueleto (só para produtos novos)
    if (isNewProduct) {
        const createMutation = `mutation productCreate($input: ProductInput!) { productCreate(input: $input) { product { id, variants(first: 1) { edges { node { id } } } } userErrors { field, message } } }`;
        const createInput = { title: productData.title, vendor: productData.vendor, productType: productData.productType, tags: productData.tags, status: "DRAFT" };
        const createResult = await callShopifyApi(createMutation, { input: createInput });
        productId = createResult.product.id;
        variantId = createResult.product.variants.edges[0].node.id;
        console.log(`   -> ✅ Esqueleto criado. ID do Produto: ${productId}`);
    }

    // PASSO 2: Atualizar a variante e o produto principal com todos os detalhes
    const updateMutation = `mutation productUpdate($input: ProductInput!) { productUpdate(input: $input) { product { id }, userErrors { field, message } } }`;
    const updateInput = {
        id: productId,
        bodyHtml: productData.bodyHtml,
        images: productData.images,
        status: "ACTIVE",
        variants: [{
            id: variantId,
            price: productData.price,
            sku: productData.sku,
            barcode: productData.ean,
            inventoryItem: { tracked: true },
            inventoryQuantities: [{
                availableQuantity: productData.stock,
                locationId: `gid://shopify/Location/${SHOPIFY_LOCATION_ID}`
            }]
        }]
    };
    
    console.log(`   -> 🔄 A preencher/atualizar detalhes para o produto ${productId}...`);
    await callShopifyApi(updateMutation, { input: updateInput });
    console.log(`   -> ✅ Produto "${productData.title}" ${action} com sucesso.`);
}


// --- FUNÇÃO PRINCIPAL ---
async function main() {
    try {
        console.log("🚀 Iniciando processo...");
        if (!SHOPIFY_STORE_URL || !SHOPIFY_ACCESS_TOKEN || !SHOPIFY_LOCATION_ID) {
            throw new Error("As variáveis de ambiente são obrigatórias.");
        }

        const existingProducts = await getExistingShopifyProducts();
        const productsToProcess = [];

        fs.createReadStream(CSV_INPUT_PATH)
            .on('error', (err) => { throw err; })
            .pipe(csv({ separator: ';', headers: CSV_HEADERS, skipLines: 1 }))
            .on('data', (row) => {
                if (row.name && row.name.trim() !== '') {
                    productsToProcess.push(transformRowToProduct(row));
                }
            })
            .on('end', async () => {
                try {
                    console.log(`\n✅ Ficheiro lido. ${productsToProcess.length} produtos para sincronizar.`);
                    for (const product of productsToProcess) {
                        if (!product.sku) continue;
                        await new Promise(resolve => setTimeout(resolve, 1000)); // Delay para não sobrecarregar a API
                        
                        try {
                            if (existingProducts.has(product.sku)) {
                                await manageProduct(existingProducts.get(product.sku), product, false);
                            } else {
                                await manageProduct(null, product, true);
                            }
                        } catch (productSyncError) {
                            console.error(`🚨 Falha ao sincronizar SKU ${product.sku}: ${productSyncError.message}`.red);
                        }
                    }
                    console.log(`\n🎉 Sincronização concluída!`);
                } catch (syncError) {
                    console.error(`🚨 Erro geral durante a sincronização: ${syncError.message}`);
                }
            });
    } catch (error) {
        console.error(`🚨 Erro fatal no processo: ${error.message}`);
        process.exit(1);
    }
}

main();
