const fs = require('fs');
const csv = require('csv-parser');

// A sua função de tradução (mantida como está)
function translateText(text) {
    if (!text || typeof text !== 'string') return '';
    const translations = { 'Sirena': 'Sirene', 'Exterior': 'Exterior', /* ...e todas as suas outras traduções... */ };
    let translatedText = text;
    for (const [spanish, portuguese] of Object.entries(translations)) {
        const regex = new RegExp(`\\b${spanish}\\b`, 'gi');
        translatedText = translatedText.replace(regex, portuguese);
    }
    return translatedText;
}

// Suas outras funções auxiliares (mantidas como estão)
function normalizeBrand(brand) { /* ... */ }
function formatEAN(eanValue) { /* ... */ }
function processExtraImages(extraImagesJson) { /* ... */ }

// A sua função principal de transformação (mantida e chamada para cada linha)
function transformProduct(visiProduct) {
    // Título Shopify = short_description do CSV
    const title = translateText(visiProduct.short_description || visiProduct.name);
    // SKU Shopify = name do CSV
    const sku = visiProduct.name;
    const brand = normalizeBrand(visiProduct.brand || '');
    const fullDescription = translateText(visiProduct.description || '');
    const productType = translateText(visiProduct.category_parent || '');
    const tags = [brand, translateText(visiProduct.category), productType].filter(Boolean).join(', ');
    const price = (visiProduct.PVP || '0').replace(',', '.');
    const stock = visiProduct.stock === 'high' ? 100 : 0;
    const images = [visiProduct.image_path, ...processExtraImages(visiProduct.extra_images_paths)].filter(Boolean).map(src => ({src}));
    const ean = formatEAN(visiProduct.ean);

    // Retorna um objeto limpo para a API
    return {
        sku: sku,
        title: title,
        vendor: brand,
        productType: productType,
        bodyHtml: fullDescription,
        tags: tags,
        price: price,
        stock: stock,
        images: images,
        ean: ean,
    };
}

// Nova função principal do ficheiro: lê o CSV e transforma os dados em memória
async function getTransformedProducts(filePath) {
    console.log('🔄 Traduzindo o CSV do fornecedor...');
    const productsToProcess = [];
    const CSV_HEADERS = [ /* ... todos os seus 23 cabeçalhos aqui ... */ ];

    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .on('error', (err) => reject(err))
            .pipe(csv({ separator: ';', headers: CSV_HEADERS, skipLines: 1 }))
            .on('data', (row) => {
                if (row.name && row.name.trim() !== '') {
                    productsToProcess.push(transformProduct(row));
                }
            })
            .on('end', () => {
                console.log(`✅ ${productsToProcess.length} produtos traduzidos com sucesso.`);
                resolve(productsToProcess);
            });
    });
}

module.exports = { getTransformedProducts };
