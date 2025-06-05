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
    'gris': 'cinzento',
    'detector': 'detetor',
    'camara': 'câmara',
    'sensor': 'sensor',
    'alarma': 'alarme',
    'control': 'controlo',
    'remoto': 'remoto',
    'inteligente': 'inteligente',
    'inalambrico': 'sem fios',
    'bateria': 'bateria',
    'alimentacion': 'alimentação',
    'instalacion': 'instalação',
    'configuracion': 'configuração'
};

// Função para corrigir encoding
function fixEncoding(text) {
    if (!text) return '';
    
    const encodingFixes = {
        'Ã¡': 'á',
        'Ã ': 'à',
        'Ã¢': 'â',
        'Ã£': 'ã',
        'Ã¤': 'ä',
        'Ã©': 'é',
        'Ãª': 'ê',
        'Ã­': 'í',
        'Ã³': 'ó',
        'Ãµ': 'õ',
        'Ã´': 'ô',
        'Ãº': 'ú',
        'Ã§': 'ç',
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

// Função para gerar handle único
function generateHandle(name) {
    if (!name) return '';
    
    return name.toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

// Função para calcular preço com IVA
function calculatePriceWithVAT(price) {
    const vatRate = 1.23; // 23% IVA
    return (parseFloat(price) * vatRate).toFixed(2);
}

// Função para processar imagens extras
function processExtraImages(extraImagesJson) {
    if (!extraImagesJson) return [];
    
    try {
        const parsed = JSON.parse(extraImagesJson);
        if (parsed.details && Array.isArray(parsed.details)) {
            // Filtrar apenas imagens principais (não thumbnails)
            return parsed.details.filter(url => !url.includes('_thumb'));
        }
    } catch (error) {
        console.log('Erro ao processar imagens extras:', error.message);
    }
    
    return [];
}

// Função para transformar produto
function transformProduct(visiProduct) {
    try {
        // Verificar marca aprovada
        const brand = normalizeBrand(visiProduct.brand);
        if (!brand) {
            return null; // Pular produtos de marcas não aprovadas
        }
        
        // Usar short_description como título (mais descritivo)
        const title = translateText(visiProduct.short_description || visiProduct.name);
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
        
        // Criar produto base
        const baseProduct = {
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
            'Status': status
        };
        
        // Array de produtos (produto base + imagens extras)
        const products = [baseProduct];
        
        // Adicionar linhas para imagens extras
        extraImages.forEach((imageUrl, index) => {
            const imageProduct = {
                'Handle': handle,
                'Title': '',
                'Body (HTML)': '',
                'Vendor': '',
                'Product Category': '',
                'Type': '',
                'Tags': '',
                'Published': '',
                'Option1 Name': '',
                'Option1 Value': '',
                'Option2 Name': '',
                'Option2 Value': '',
                'Option3 Name': '',
                'Option3 Value': '',
                'Variant SKU': '',
                'Variant Grams': '',
                'Variant Inventory Tracker': '',
                'Variant Inventory Qty': '',
                'Variant Inventory Policy': '',
                'Variant Fulfillment Service': '',
                'Variant Price': '',
                'Variant Compare At Price': '',
                'Variant Requires Shipping': '',
                'Variant Taxable': '',
                'Variant Barcode': '',
                'Image Src': imageUrl,
                'Image Position': (index + 2).toString(),
                'Image Alt Text': title,
                'Gift Card': '',
                'SEO Title': '',
                'SEO Description': '',
                'Google Shopping / Google Product Category': '',
                'Google Shopping / Gender': '',
                'Google Shopping / Age Group': '',
                'Google Shopping / MPN': '',
                'Google Shopping / Condition': '',
                'Google Shopping / Custom Product': '',
                'Variant Image': '',
                'Variant Weight Unit': '',
                'Variant Tax Code': '',
                'Cost per item': '',
                'Included / United States': '',
                'Price / United States': '',
                'Compare At Price / United States': '',
                'Included / International': '',
                'Price / International': '',
                'Compare At Price / International': '',
                'Status': ''
            };
            
            products.push(imageProduct);
        });
        
        return products;
        
    } catch (error) {
        console.error('Erro ao transformar produto:', visiProduct.name, error.message);
        return null;
    }
}

module.exports = {
    transformProduct,
    APPROVED_BRANDS,
    STOCK_MAPPING,
    CATEGORY_MAPPING
};

