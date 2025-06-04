const fs = require('fs');
const path = require('path');

// Configuração de marcas aprovadas
const APPROVED_BRANDS = {
    'ajax': 'Ajax',
    'ajaxcctv': 'Ajax', 
    'ajaxviviendavacia': 'Ajax',
    'ajaxviviendavaca': 'Ajax', // Com encoding problem
    'aqara': 'Aqara',
    'eufy': 'Eufy',
    'yale': 'Yale',
    'reolink': 'Reolink'
};

// Mapeamento de stock
const STOCK_MAPPING = {
    'high': 10,
    'medium': 5,
    'low': 2,
    'none': 0
};

// Mapeamento de categorias
const CATEGORY_MAPPING = {
    'acessórios': 'Gadgets Diversos',
    'peças de reposição': 'Gadgets Diversos',
    'câmaras': 'Câmaras',
    'sensores': 'Sensores inteligentes',
    'fechaduras': 'Fechaduras Inteligentes',
    'tomadas': 'Tomadas',
    'iluminação': 'Iluminação',
    'audio': 'Audio',
    'termostato': 'Termostato Inteligente',
    'campainha': 'Campainha Inteligente',
    'interruptor': 'Interruptor Inteligente',
    'hub': 'Hubs Inteligentes',
    'controlo remoto': 'Controlo Remoto',
    'motor cortinas': 'Motor Cortinas',
    'painel': 'Painel Controlo'
};

// Traduções ES→PT
const TRANSLATIONS = {
    'sirena': 'sirene',
    'exterior': 'exterior',
    'interior': 'interior',
    'blanco': 'branco',
    'negro': 'preto',
    'rojo': 'vermelho',
    'azul': 'azul',
    'verde': 'verde',
    'amarillo': 'amarelo',
    'botón': 'botão',
    'alarma': 'alarme',
    'incendio': 'incêndio',
    'seguridad': 'segurança',
    'inalámbrico': 'sem fios',
    'batería': 'bateria',
    'alimentación': 'alimentação',
    'instalación': 'instalação',
    'compatible': 'compatível',
    'unidades': 'unidades',
    'pack': 'pack',
    'manual': 'manual',
    'instrucciones': 'instruções',
    'material': 'material',
    'montaje': 'montagem',
    'personalizable': 'personalizável',
    'herramienta': 'ferramenta',
    'reposición': 'reposição',
    'chavero': 'porta-chaves',
    'acceso': 'acesso',
    'contacto': 'contacto',
    'tecnología': 'tecnologia',
    'memoria': 'memória',
    'capacidad': 'capacidade',
    'funcionamiento': 'funcionamento',
    'temperatura': 'temperatura',
    'dimensiones': 'dimensões',
    'peso': 'peso'
};

// Função para corrigir encoding
function fixEncoding(text) {
    if (!text) return '';
    
    const encodingFixes = {
        'Ã§Ã£o': 'ção',
        'Ã§': 'ç',
        'Ã£': 'ã',
        'Ã¡': 'á',
        'Ã©': 'é',
        'Ã­': 'í',
        'Ã³': 'ó',
        'Ãº': 'ú',
        'Ã ': 'à',
        'Ã¢': 'â',
        'Ãª': 'ê',
        'Ã´': 'ô',
        'Ã¼': 'ü',
        'Ã±': 'ñ',
        'reposiÃ§Ã£o': 'reposição',
        'alimentaÃ§Ã£o': 'alimentação',
        'instalaÃ§Ã£o': 'instalação',
        'instruÃ§Ãµes': 'instruções',
        'dimensÃµes': 'dimensões'
    };
    
    let fixed = text;
    for (const [wrong, correct] of Object.entries(encodingFixes)) {
        fixed = fixed.replace(new RegExp(wrong, 'gi'), correct);
    }
    
    return fixed;
}

// Função para traduzir texto ES→PT
function translateText(text) {
    if (!text) return '';
    
    let translated = fixEncoding(text);
    
    for (const [spanish, portuguese] of Object.entries(TRANSLATIONS)) {
        const regex = new RegExp(`\\b${spanish}\\b`, 'gi');
        translated = translated.replace(regex, portuguese);
    }
    
    return translated;
}

// Função para normalizar marca
function normalizeBrand(brand) {
    if (!brand) return null;
    
    const normalized = brand.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
    
    return APPROVED_BRANDS[normalized] || null;
}

// Função para mapear categoria
function mapCategory(category) {
    if (!category) return 'Gadgets Diversos';
    
    const categoryLower = category.toLowerCase();
    
    for (const [key, value] of Object.entries(CATEGORY_MAPPING)) {
        if (categoryLower.includes(key)) {
            return value;
        }
    }
    
    return 'Gadgets Diversos';
}

// Função para gerar handle
function generateHandle(name) {
    if (!name) return '';
    
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// Função para calcular preço com IVA
function calculatePriceWithVAT(price) {
    if (!price || isNaN(price)) return 0;
    return (parseFloat(price) * 1.23).toFixed(2);
}

// Função para processar imagens extras
// Função para processar imagens extras
// Função para processar imagens extras
function processExtraImages(extraImagesJson ) {
    if (!extraImagesJson || extraImagesJson.trim() === '') return [];
    
    try {
        let cleanJson = extraImagesJson.trim();
        
        // Remover aspas externas se existirem
        if (cleanJson.startsWith('"') && cleanJson.endsWith('"')) {
            cleanJson = cleanJson.slice(1, -1);
        }
        
        // Corrigir aspas duplas escapadas incorretamente
        cleanJson = cleanJson.replace(/""/g, '"');
        
        console.log('🔍 JSON limpo:', cleanJson.substring(0, 100) + '...');
        
        const parsed = JSON.parse(cleanJson);
        if (parsed.details && Array.isArray(parsed.details)) {
            // Filtrar apenas imagens grandes (não thumbnails)
            const images = parsed.details.filter(img => !img.includes('_thumb'));
            console.log(`📸 ${images.length} imagens encontradas`);
            return images;
        }
    } catch (e) {
        console.log('⚠️ Aviso: Não foi possível processar imagens extras:', e.message);
        console.log('Dados originais:', extraImagesJson.substring(0, 100) + '...');
        // Retornar array vazio em vez de falhar
        return [];
    }
    
    return [];
}

// Função principal de transformação
function transformProduct(visiProduct) {
    // Verificar se marca é aprovada
    const brand = normalizeBrand(visiProduct.brand);
    if (!brand) {
        return null; // Pular produto se marca não aprovada
    }
    
    // Processar dados básicos
    const title = translateText(visiProduct.content || visiProduct.name);
    const handle = generateHandle(visiProduct.name);
    const category = mapCategory(visiProduct.category);
    const tags = `${brand}, ${category}`;
    
    // Processar preços
    const basePrice = parseFloat(visiProduct.precio_venta_cliente_final || 0);
    const priceWithVAT = calculatePriceWithVAT(basePrice);
    const comparePrice = visiProduct.PVP && parseFloat(visiProduct.PVP) > basePrice 
        ? calculatePriceWithVAT(visiProduct.PVP) 
        : '';
    
    // Processar stock
    const stockLevel = visiProduct.stock ? visiProduct.stock.toLowerCase() : 'none';
    const inventoryQty = STOCK_MAPPING[stockLevel] || 0;
    
    // Processar descrição
    const description = translateText(visiProduct.description || '');
    const specifications = translateText(visiProduct.specifications || '');
    const bodyHtml = description + (specifications ? '<br><br><strong>Especificações:</strong><br>' + specifications : '');
    
    // Processar imagens
    const mainImage = visiProduct.image_path || '';
    const extraImages = processExtraImages(visiProduct.extra_images_paths);
    
    // Status
    const status = visiProduct.published === '1' ? 'active' : 'draft';
    
    return {
        'Handle': handle,
        'Title': title,
        'Body (HTML)': bodyHtml,
        'Vendor': brand,
        'Product Category': '',
        'Type': category,
        'Tags': tags,
        'Published': 'TRUE',
        'Option1 Name': '',
        'Option1 Value': '',
        'Option2 Name': '',
        'Option2 Value': '',
        'Option3 Name': '',
        'Option3 Value': '',
        'Variant SKU': visiProduct.name,
        'Variant Grams': '',
        'Variant Inventory Tracker': 'shopify',
        'Variant Inventory Qty': inventoryQty,
        'Variant Inventory Policy': 'deny',
        'Variant Fulfillment Service': 'manual',
        'Variant Price': priceWithVAT,
        'Variant Compare At Price': comparePrice,
        'Variant Requires Shipping': 'TRUE',
        'Variant Taxable': 'TRUE',
        'Variant Barcode': visiProduct.ean || '',
        'Image Src': mainImage,
        'Image Position': '1',
        'Image Alt Text': title,
        'Gift Card': 'FALSE',
        'SEO Title': `${title} | ${brand}`,
        'SEO Description': translateText(visiProduct.short_description || ''),
        'Google Shopping / Google Product Category': '',
        'Google Shopping / Gender': '',
        'Google Shopping / Age Group': '',
        'Google Shopping / MPN': visiProduct.name,
        'Google Shopping / Condition': 'new',
        'Google Shopping / Custom Product': 'TRUE',
        'Variant Image': '',
        'Variant Weight Unit': 'g',
        'Variant Tax Code': '',
        'Cost per item': '',
        'Included / United States': 'TRUE',
        'Price / United States': '',
        'Compare At Price / United States': '',
        'Included / International': 'TRUE',
        'Price / International': '',
        'Compare At Price / International': '',
        'Status': status,
        // Campos extras para imagens adicionais
        'Extra Images': extraImages.join(','),
        'Related Products': visiProduct.related_products || ''
    };
}

module.exports = {
    transformProduct,
    APPROVED_BRANDS,
    STOCK_MAPPING,
    CATEGORY_MAPPING
};


