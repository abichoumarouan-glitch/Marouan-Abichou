import Anthropic from '@anthropic-ai/sdk';

// Lecture d'images (factures, étiquettes) et propositions marketing avec Claude.
// Sans clé ANTHROPIC_API_KEY, l'application reste utilisable en saisie manuelle.
const MODEL = process.env.MIZU_AI_MODEL || 'claude-opus-5-5';
let client = null;

export function aiAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const nullable = (type) => ({ anyOf: [{ type }, { type: 'null' }] });

const INVOICE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['supplier', 'invoice_number', 'invoice_date', 'delivery_date', 'due_date', 'lines', 'total_ht', 'total_tva', 'total_ttc'],
  properties: {
    supplier: nullable('string'),
    invoice_number: nullable('string'),
    invoice_date: nullable('string'),
    delivery_date: nullable('string'),
    due_date: nullable('string'),
    total_ht: nullable('number'),
    total_tva: nullable('number'),
    total_ttc: nullable('number'),
    lines: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['product', 'quantity', 'unit', 'purchase_price_ht', 'tva_rate'],
        properties: {
          product: { type: 'string' },
          quantity: nullable('number'),
          unit: { anyOf: [{ type: 'string', enum: ['kg', 'l', 'piece', 'carton'] }, { type: 'null' }] },
          purchase_price_ht: nullable('number'),
          tva_rate: nullable('number'),
        },
      },
    },
  },
};

const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product_name', 'date', 'date_type', 'lot_number'],
  properties: {
    product_name: nullable('string'),
    date: nullable('string'),
    date_type: { anyOf: [{ type: 'string', enum: ['DLC', 'DDM'] }, { type: 'null' }] },
    lot_number: nullable('string'),
  },
};

const MARKETING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['contents'],
  properties: {
    contents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['channel', 'title', 'body'],
        properties: {
          channel: { type: 'string', enum: ['Instagram', 'Facebook', 'Google', 'Newsletter'] },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
};

async function structured({ system, content, schema, maxTokens = 8000 }) {
  const response = await getClient().beta.messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
    system,
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error("La lecture automatique a été refusée pour cette image.");
  if (response.stop_reason === 'max_tokens') throw new Error('Réponse incomplète de la lecture automatique.');
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return JSON.parse(text);
}

function imageBlock(buffer, mime) {
  const media = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime) ? mime : 'image/jpeg';
  return { type: 'image', source: { type: 'base64', media_type: media, data: buffer.toString('base64') } };
}

export async function readInvoicePhoto(buffer, mime) {
  return structured({
    system:
      "Tu lis des factures et bons de livraison de fournisseurs de restaurants en France. " +
      "Retourne fidèlement ce qui est imprimé, sans inventer. Dates au format AAAA-MM-JJ. " +
      "Pour chaque ligne de produit : le libellé, la quantité livrée, l'unité ramenée à kg, l, piece ou carton " +
      "(colis, caisse, pack, lot, boîte → carton ; unité, botte, pièce → piece ; g → convertis en kg ; cl/ml → convertis en l), " +
      "le prix d'achat HT total de la ligne (pas le prix unitaire ; calcule quantité × prix unitaire si seul ce dernier figure), " +
      "et le taux de TVA en pourcentage s'il est indiqué. Ignore les lignes de consigne, de port ou de remise globale sauf si elles sont facturées comme produit. " +
      "Si la date de livraison n'apparaît pas, reprends la date de facture. Mets null pour toute valeur illisible.",
    content: [imageBlock(buffer, mime), { type: 'text', text: 'Extrais les informations de cette facture fournisseur.' }],
    schema: INVOICE_SCHEMA,
  });
}

export async function readLabelPhoto(buffer, mime) {
  return structured({
    system:
      "Tu lis des étiquettes de produits alimentaires. Trouve la date limite de consommation (« à consommer jusqu'au », DLC) " +
      "ou à défaut la date de durabilité minimale (« à consommer de préférence avant », DDM). " +
      "Date au format AAAA-MM-JJ (si seul le mois et l'année figurent, prends le dernier jour du mois). " +
      "Donne aussi le nom du produit et le numéro de lot s'ils sont lisibles. Mets null pour toute valeur illisible.",
    content: [imageBlock(buffer, mime), { type: 'text', text: 'Lis cette étiquette.' }],
    schema: LABEL_SCHEMA,
    maxTokens: 2000,
  });
}

export async function proposeMarketing({ establishment, dishes, recent }) {
  const result = await structured({
    system:
      "Tu es responsable marketing pour un restaurant indépendant en France. Tu proposes des contenus courts, chaleureux, " +
      "sans superlatifs creux ni emojis en excès, en français. Ces contenus seront relus et validés par le restaurateur avant toute publication.",
    content: [{
      type: 'text',
      text:
        `Restaurant : ${establishment.name}${establishment.address ? ` (${establishment.address})` : ''}.\n` +
        `Plats à la carte : ${dishes.map((d) => d.name).join(', ') || 'non renseignés'}.\n` +
        `Contenus déjà proposés récemment (à ne pas répéter) : ${recent.join(' | ') || 'aucun'}.\n` +
        'Propose 3 contenus variés : un post Instagram, un post Facebook et une réponse type ou actualité Google.',
    }],
    schema: MARKETING_SCHEMA,
    maxTokens: 4000,
  });
  return result.contents;
}
