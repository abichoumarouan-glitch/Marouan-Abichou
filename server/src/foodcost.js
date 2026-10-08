import { all, get, run, insert, tx } from './db.js';
import { nowLocal } from './time.js';
import { notifyOwner } from './realtime.js';

// Calculs en précision complète : aucun arrondi ici, uniquement à l'affichage.

export const UNIT_LABELS = { kg: 'kilo', l: 'litre', piece: 'pièce', carton: 'carton' };
export const ALLERGENS = [
  'Gluten', 'Crustacés', 'Œufs', 'Poissons', 'Arachides', 'Soja', 'Lait',
  'Fruits à coque', 'Céleri', 'Moutarde', 'Sésame', 'Sulfites', 'Lupin', 'Mollusques',
];

/** Nombre d'unités de base (g, ml, pièce) contenues dans une unité d'achat. */
export function naturalConversion(purchaseUnit, baseUnit) {
  if (purchaseUnit === 'kg' && baseUnit === 'g') return 1000;
  if (purchaseUnit === 'l' && baseUnit === 'ml') return 1000;
  if (purchaseUnit === 'piece' && baseUnit === 'piece') return 1;
  return null; // carton ou unités incompatibles : contenance à préciser
}

export function normalizeKey(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lien produit → ingrédient déjà connu (même fournisseur d'abord, puis tout fournisseur). */
export function findProductLink(estId, supplierName, productName) {
  const pk = normalizeKey(productName);
  if (!pk) return null;
  return (
    get('SELECT * FROM product_links WHERE establishment_id = ? AND supplier_key = ? AND product_key = ?', estId, normalizeKey(supplierName), pk) ||
    get('SELECT * FROM product_links WHERE establishment_id = ? AND product_key = ? ORDER BY id DESC LIMIT 1', estId, pk) ||
    null
  );
}

/** Dernier prix d'achat connu d'un ingrédient (facture validée la plus récente). */
export function latestPrice(ingredientId) {
  return get(
    `SELECT l.unit_cost_base, l.purchase_price_ht, l.quantity, l.unit, l.conversion,
            i.delivery_date, i.supplier_name, i.id AS invoice_id
     FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id
     WHERE l.ingredient_id = ? AND i.status = 'validee' AND l.unit_cost_base IS NOT NULL
     ORDER BY COALESCE(i.delivery_date, i.invoice_date) DESC, i.validated_at DESC, l.id DESC
     LIMIT 1`,
    ingredientId,
  ) || null;
}

/** Fiche technique chiffrée d'un plat. */
export function computeDish(dish) {
  const lines = all(
    `SELECT r.*, g.name AS ingredient_name, g.base_unit, g.allergens
     FROM recipe_lines r JOIN ingredients g ON g.id = r.ingredient_id
     WHERE r.dish_id = ? ORDER BY r.id`,
    dish.id,
  );
  let foodCost = 0;
  let missing = 0;
  const allergens = new Set();
  const detailed = lines.map((l) => {
    for (const a of JSON.parse(l.allergens || '[]')) allergens.add(a);
    const price = latestPrice(l.ingredient_id);
    // prix unitaire (par unité d'achat) = prix d'achat HT / quantité achetée
    const unitPrice = price && price.quantity ? price.purchase_price_ht / price.quantity : null;
    // coût ingrédient = prix unitaire × quantité dans le plat (converti en unité de base)
    const cost = price ? price.unit_cost_base * l.quantity : null;
    if (cost == null) missing++;
    else foodCost += cost;
    return {
      ...l,
      allergens: undefined,
      unit_price: unitPrice,
      purchase_unit: price?.unit ?? null,
      unit_cost_base: price?.unit_cost_base ?? null,
      price_date: price?.delivery_date ?? null,
      cost,
    };
  });
  const sale = Number(dish.sale_price_ht) || 0;
  const target = Number(dish.target_food_cost_pct) || 0;
  return {
    ...dish,
    lines: detailed,
    food_cost_eur: foodCost,
    food_cost_pct: sale > 0 ? (foodCost / sale) * 100 : null,
    recommended_price_ht: target > 0 ? (foodCost / target) * 100 : null,
    missing_prices: missing,
    allergens: ALLERGENS.filter((a) => allergens.has(a)),
  };
}

export function dishesForEstablishment(estId) {
  return all('SELECT * FROM dishes WHERE establishment_id = ? AND active = 1 ORDER BY category, name', estId).map(computeDish);
}

/** Enregistre un point d'historique et alerte si le plat devient moins rentable. */
export function snapshotDish(dish, { cause, invoiceId = null, alert = true } = {}) {
  const c = computeDish(dish);
  const prev = get('SELECT * FROM dish_cost_history WHERE dish_id = ? ORDER BY id DESC LIMIT 1', dish.id);
  insert(
    'INSERT INTO dish_cost_history (dish_id, food_cost_eur, food_cost_pct, cause, invoice_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    dish.id, c.food_cost_eur, c.food_cost_pct, cause, invoiceId, nowLocal(),
  );
  if (alert && prev && c.food_cost_pct != null && prev.food_cost_pct != null && c.food_cost_pct - prev.food_cost_pct > 0.05) {
    const over = c.food_cost_pct > c.target_food_cost_pct;
    const pct = (n) => `${n.toFixed(1).replace('.', ',')} %`;
    notifyOwner(dish.establishment_id, {
      type: 'food_cost',
      severity: over ? 'danger' : 'warning',
      title: `${dish.name} devient moins rentable`,
      body: `Food cost : ${pct(prev.food_cost_pct)} → ${pct(c.food_cost_pct)} (cible ${pct(c.target_food_cost_pct)}).`,
      link: `/restaurateur/food-cost/${dish.id}`,
    });
  }
  return c;
}

/** Recalcule tous les plats qui utilisent l'un des ingrédients donnés. */
export function recomputeDishesForIngredients(estId, ingredientIds, { cause, invoiceId } = {}) {
  if (!ingredientIds.length) return [];
  const dishes = all(
    `SELECT DISTINCT d.* FROM dishes d JOIN recipe_lines r ON r.dish_id = d.id
     WHERE d.establishment_id = ? AND d.active = 1 AND r.ingredient_id IN (${ingredientIds.map(() => '?').join(',')})`,
    estId, ...ingredientIds,
  );
  return dishes.map((d) => snapshotDish(d, { cause, invoiceId }));
}

// ---- Classement automatique des dépenses (pour le comptable) ----
const CATEGORY_RULES = [
  ['Boissons', /\b(vin|biere|bière|jus|soda|eau minerale|cafe|café|the |thé|spiritueux|champagne|boisson|sirop|limonade|cola)\b/i],
  ['Emballages et consommables', /\b(emballage|barquette|sac|serviette|gobelet|film|aluminium|papier|boite|boîte|couvert jetable|paille)\b/i],
  ["Produits d'entretien", /\b(nettoyant|detergent|détergent|degraissant|dégraissant|javel|liquide vaisselle|desinfectant|désinfectant|eponge|éponge|lessive|savon)\b/i],
  ['Énergie et fluides', /\b(edf|engie|electricite|électricité|gaz|eau de paris|veolia|energie|énergie|total ?energies)\b/i],
  ['Loyer et charges', /\b(loyer|bail|charges locatives|syndic)\b/i],
  ['Entretien et réparations', /\b(reparation|réparation|maintenance|depannage|dépannage|plombier|electricien|électricien|froid)\b/i],
  ['Frais de déplacement', /\b(carburant|essence|gasoil|peage|péage|parking|taxi|uber|train|sncf|billet|hotel|hôtel)\b/i],
  ['Repas et réceptions', /\b(repas|restaurant|dejeuner|déjeuner|diner|dîner)\b/i],
  ['Fournitures et petit matériel', /\b(fourniture|stylo|cartouche|imprimante|ustensile|couteau|casserole|bac gastro|materiel|matériel)\b/i],
  ['Honoraires et services', /\b(honoraires|abonnement|logiciel|assurance|banque|frais bancaires|telephone|téléphone|internet)\b/i],
];
export const EXPENSE_CATEGORIES = ['Achats alimentaires', ...CATEGORY_RULES.map((r) => r[0]), 'Autres'];

export function classifyText(text, fallback = 'Autres') {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text || '')) return cat;
  return fallback;
}

export function classifyInvoice(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  const lines = all(
    `SELECT l.*, g.category AS ing_category FROM invoice_lines l
     LEFT JOIN ingredients g ON g.id = l.ingredient_id WHERE l.invoice_id = ?`,
    invoiceId,
  );
  const weights = {};
  for (const l of lines) {
    let cat;
    if (l.ingredient_id) cat = /boisson/i.test(l.ing_category || '') ? 'Boissons' : classifyText(l.product_name, 'Achats alimentaires');
    else cat = classifyText(`${l.product_name} ${inv.supplier_name || ''}`);
    if (cat === 'Autres' && l.ingredient_id) cat = 'Achats alimentaires';
    weights[cat] = (weights[cat] || 0) + Math.abs(l.purchase_price_ht || 0) + 0.0001;
  }
  const best = Object.entries(weights).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : classifyText(inv.supplier_name || '');
}

// ---- Validation d'une facture ----
export function validateInvoice(invoiceId, userId) {
  return tx(() => {
    const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
    if (inv.status === 'validee') throw Object.assign(new Error('Facture déjà validée.'), { status: 409 });
    const lines = all('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY position, id', invoiceId);
    if (!lines.length) throw Object.assign(new Error('La facture ne contient aucune ligne.'), { status: 400 });
    const touched = new Set();
    let totalHt = 0;
    let totalTva = 0;
    for (const l of lines) {
      if (!(l.quantity > 0) || l.purchase_price_ht == null || !l.unit) {
        throw Object.assign(new Error(`Ligne « ${l.product_name} » incomplète (quantité, unité et prix requis).`), { status: 400 });
      }
      totalHt += l.purchase_price_ht;
      totalTva += l.purchase_price_ht * ((l.tva_rate ?? 0) / 100);
      if (l.not_ingredient) {
        upsertLink(inv, l, null, true, null);
        continue;
      }
      if (!l.ingredient_id) {
        throw Object.assign(new Error(`Reliez « ${l.product_name} » à un ingrédient (ou indiquez qu'il n'en est pas un).`), { status: 400 });
      }
      const ing = get('SELECT * FROM ingredients WHERE id = ?', l.ingredient_id);
      const conv = naturalConversion(l.unit, ing.base_unit) ?? l.conversion;
      if (!(conv > 0)) {
        throw Object.assign(new Error(`Indiquez la contenance d'un(e) ${UNIT_LABELS[l.unit]} de « ${l.product_name} » en ${ing.base_unit === 'piece' ? 'pièces' : ing.base_unit}.`), { status: 400 });
      }
      const baseQty = l.quantity * conv;
      const unitCostBase = l.purchase_price_ht / baseQty;
      run('UPDATE invoice_lines SET conversion = ?, base_quantity = ?, unit_cost_base = ? WHERE id = ?', conv, baseQty, unitCostBase, l.id);
      run('UPDATE ingredients SET stock = stock + ? WHERE id = ?', baseQty, ing.id);
      upsertLink(inv, l, ing.id, false, naturalConversion(l.unit, ing.base_unit) ? null : conv);
      touched.add(ing.id);
    }
    run(
      `UPDATE invoices SET status = 'validee', validated_at = ?, total_ht = ?, total_tva = ?,
         total_ttc = ?, expense_category = ? WHERE id = ?`,
      nowLocal(), totalHt, totalTva, totalHt + totalTva, null, invoiceId,
    );
    run('UPDATE invoices SET expense_category = ? WHERE id = ?', classifyInvoice(invoiceId), invoiceId);
    const recomputed = recomputeDishesForIngredients(inv.establishment_id, [...touched], { cause: 'facture', invoiceId });
    return { recomputed: recomputed.length, ingredients: touched.size };
  });
}

function upsertLink(inv, line, ingredientId, notIngredient, conversion) {
  run(
    `INSERT INTO product_links (establishment_id, supplier_key, product_key, ingredient_id, not_ingredient, conversion)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(establishment_id, supplier_key, product_key)
     DO UPDATE SET ingredient_id = excluded.ingredient_id, not_ingredient = excluded.not_ingredient, conversion = excluded.conversion`,
    inv.establishment_id, normalizeKey(inv.supplier_name), normalizeKey(line.product_name), ingredientId, notIngredient ? 1 : 0, conversion,
  );
}

/** Applique les liens connus aux lignes d'une facture en brouillon. */
export function autoLinkLines(invoiceId) {
  const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
  for (const l of all('SELECT * FROM invoice_lines WHERE invoice_id = ? AND ingredient_id IS NULL AND not_ingredient = 0', invoiceId)) {
    const link = findProductLink(inv.establishment_id, inv.supplier_name, l.product_name);
    if (!link) continue;
    run('UPDATE invoice_lines SET ingredient_id = ?, not_ingredient = ?, conversion = COALESCE(conversion, ?) WHERE id = ?',
      link.ingredient_id, link.not_ingredient, link.conversion, l.id);
  }
}
