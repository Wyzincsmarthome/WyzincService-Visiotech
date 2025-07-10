const fs = require('fs');
const csvParse = require('csv-parse/lib/sync');
const Shopify = require('@shopify/admin-api-client');
require('dotenv').config();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;  // ex: 'minhaloja.myshopify.com'
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const client = new Shopify({
  domain: SHOPIFY_STORE,
  accessToken: SHOPIFY_ACCESS_TOKEN,
});

async function getProductByHandle(handle) {
  try {
    const response = await client.rest.Product.all({
      limit: 1,
      handle,
    });
    if (response.body.products.length > 0) {
      return response.body.products[0];
    }
    return null;
  } catch (error) {
    console.error(`Erro a obter produto handle=${handle}:`, error.message);
    return null;
  }
}

async function getProductBySKU(sku) {
  try {
    const response = await client.rest.ProductVariant.all({
      limit: 1,
      sku,
    });
    if (response.body.variants.length > 0) {
      // Retornar o produto pai
      const variant = response.body.variants[0];
      const productResponse = await client.rest.Product.get(variant.product_id);
      return productResponse.body.product;
    }
    return null;
  } catch (error) {
    console.error(`Erro a obter produto SKU=${sku}:`, error.message);
    return null;
  }
}

async function createOrUpdateProduct(productData) {
  // productData é um objeto com propriedades conforme CSV Shopify

  // Verifica por handle
  let existingProduct = null;
  if (productData['Handle']) {
    existingProduct = await getProductByHandle(productData['Handle']);
  }

  // Se não encontrado, verifica por SKU da variante principal
  if (!existingProduct && productData['Variant SKU']) {
    existingProduct = await getProductBySKU(productData['Variant SKU']);
  }

  // Construir payload para Shopify API
  // Aqui convém mapear o CSV para o formato da API (simplificado)
  const productPayload = {
    product: {
      title: productData['Title'],
      body_html: productData['Body (HTML)'],
      vendor: productData['Vendor'],
      product_type: productData['Type'],
      tags: productData['Tags'],
      variants: [
        {
          sku: productData['Variant SKU'],
          price: productData['Variant Price'],
          inventory_quantity: parseInt(productData['Variant Inventory Qty'], 10) || 0,
          inventory_management: productData['Variant Inventory Tracker'] || 'shopify',
          weight: parseFloat(productData['Variant Grams']) / 1000 || 0,
          weight_unit: productData['Variant Weight Unit'] || 'kg',
          taxable: productData['Variant Taxable'] === 'TRUE',
          requires_shipping: productData['Variant Requires Shipping'] === 'TRUE',
          barcode: productData['Variant Barcode'] || undefined,
        }
      ],
      images: productData['Image Src'] ? [{ src: productData['Image Src'] }] : [],
      published: productData['Published'] === 'TRUE',
    }
  };

  try {
    if (existingProduct) {
      // Atualizar produto existente
      const productId = existingProduct.id;
      await client.rest.Product.update(productId, productPayload.product);
      return { updated: 1, created: 0 };
    } else {
      // Criar produto novo
      await client.rest.Product.create(productPayload.product);
      return { updated: 0, created: 1 };
    }
  } catch (error) {
    console.error(`Erro ao criar/atualizar produto ${productData['Handle']}:`, error.message);
    return { updated: 0,
}
