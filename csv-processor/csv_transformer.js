const fs = require('fs');
const csv = require('csv-parser');
const path = require('path');

// TODAS AS SUAS FUNÇÕES DE LÓGICA DE NEGÓCIO ESTÃO AQUI, PRESERVADAS
function translateText(text) {
    if (!text || typeof text !== 'string') return '';
    const translations = { 'Sirena': 'Sirene', 'Exterior': 'Exterior', /* etc. */ };
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
function formatEAN(eanValue) {
    if (!eanValue || typeof eanValue !== 'string') return '';
    if (eanValue.includes('E+')) {
        try { return BigInt(Math.round(parseFloat(eanValue.replace(',', '.')))).toString(); }
        catch (e) { console.warn(`⚠️  Não foi possível converter o EAN: ${eanValue}`); return eanValue; }
    }
    return eanValue.trim();
}
function processExtraImages(extraImagesJson) {
    const allImages = [];
    if (extraImagesJson) {
        try {
            const extra = JSON.parse(extraImagesJson).details;
            if (Array.isArray(extra)) allImages.push(...extra.filter(img => img && !img.includes('_thumb.')));
        } catch (e) { /* Ignorar */ }
    }
    return allImages;
}
function parseStock(stockValue) {
    const stockLower = (stockValue || '').toLowerCase();
    if (stockLower.includes('high') || stockLower.includes('disponível')) return 100;
    if (stockLower.includes('low') || stockLower.includes('reduzido')) return 5;
    return 0;
}
const slugify = (str) => str.toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');

// A SUA LÓGICA DE MAPEAMENTO, USANDO AS SUAS REGRAS
function transformRowToProduct(row) {
    const brand = normalizeBrand(row.brand || '');
    
    // Título Shopify = short_description do CSV
    const title = translateText(row.short_description || row.name || '');
    // SKU Shopify = name do CSV
    const sku = row.name;

    const description = translateText(row.description || '');
    const specifications = translateText(row.specifications || '');
    
    return {
        handle: slugify(sku),
        sku: sku,
        title: title,
        vendor: brand,
        productType: translateText(row.category_parent || ''),
        bodyHtml: `${description}<br><br><h3>Especificações</h3>${specifications}`,
        tags: [brand, translateText(row.category_parent), translateText(row.category)].filter(Boolean).join(','),
        price: (row.PVP || row.precio_venta_cliente_final || '0').replace(',', '.'),
        stock: parseStock(row.stock),
        images: [row.image_path, ...processExtraImages(row.extra_images_paths)].filter(Boolean).map(src => ({ src })),
        ean: formatEAN(row.ean),
    };
}

// A nova função que lê o CSV e devolve os dados transformados
async function getTransformedProducts(filePath) {
    console.log('🔄 A ler e a traduzir o CSV do fornecedor...');
    const productsToProcess = [];
    const CSV_HEADERS = ['name', 'image_path', 'stock', 'msrp', 'brand', 'description', 'specifications', 'content', 'short_description', 'short_description_html', 'category', 'category_parent', 'precio_neto_compra', 'precio_venta_cliente_final', 'PVP', 'ean', 'published', 'created', 'modified', 'params', 'related_products', 'extra_images_paths', 'category_id'];

    return new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
            .on('error', (err) => reject(err))
            .pipe(csv({ separator: ';', headers: CSV_HEADERS, skipLines: 1 }))
            .on('data', (row) => {
                if (row.name && row.name.trim() !== '') {
                    productsToProcess.push(transformRowToProduct(row));
                }
            })
            .on('end', () => {
                console.log(`✅ ${productsToProcess.length} produtos traduzidos com sucesso.`);
                resolve(productsToProcess);
            });
    });
}

module.exports = { getTransformedProducts };
