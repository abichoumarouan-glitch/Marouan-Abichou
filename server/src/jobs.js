import { all, get, insert, tx } from './db.js';
import { nowLocal, today, addDays } from './time.js';
import { notifyOwner } from './realtime.js';

const fmtQty = (base, unit) => {
  if (unit === 'g') return base >= 1000 ? `${(base / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} kg` : `${Math.round(base)} g`;
  if (unit === 'ml') return base >= 1000 ? `${(base / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} L` : `${Math.round(base)} ml`;
  return `${base.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} pièce(s)`;
};

/** Dernière façon d'acheter un ingrédient : fournisseur, unité d'achat et contenance. */
function lastPurchase(ingredientId) {
  return get(
    `SELECT l.unit, l.conversion, i.supplier_id, i.supplier_name FROM invoice_lines l
     JOIN invoices i ON i.id = l.invoice_id
     WHERE l.ingredient_id = ? AND i.status = 'validee' AND l.conversion > 0
     ORDER BY COALESCE(i.delivery_date, i.invoice_date) DESC, l.id DESC LIMIT 1`,
    ingredientId,
  );
}

/** Ingrédients sous le stock minimum. */
export function lowStock(estId) {
  return all('SELECT * FROM ingredients WHERE establishment_id = ? AND min_stock > 0 AND stock < min_stock ORDER BY name', estId);
}

/**
 * Propose des commandes pour les produits sous le stock minimum (objectif : 2 × le minimum).
 * Les commandes restent « proposées » : rien n'est transmis sans validation du restaurateur.
 */
export function proposeOrders(estId) {
  return tx(() => {
    const already = new Set(all(
      `SELECT l.ingredient_id FROM supplier_order_lines l JOIN supplier_orders o ON o.id = l.order_id
       WHERE o.establishment_id = ? AND (o.status = 'proposee' OR o.created_at >= ?)`, estId, `${addDays(today(), -3)}T00:00:00`,
    ).map((r) => r.ingredient_id));
    const groups = new Map();
    for (const ing of lowStock(estId)) {
      if (already.has(ing.id)) continue;
      const p = lastPurchase(ing.id);
      const unit = p?.unit || { g: 'kg', ml: 'l', piece: 'piece' }[ing.base_unit];
      const conv = p?.conversion || (ing.base_unit === 'piece' ? 1 : 1000);
      const needed = ing.min_stock * 2 - ing.stock;
      const qty = Math.max(1, Math.ceil(needed / conv));
      const key = p?.supplier_name || 'Fournisseur à définir';
      if (!groups.has(key)) groups.set(key, { supplier_id: p?.supplier_id ?? null, lines: [] });
      groups.get(key).lines.push({ ingredient_id: ing.id, label: ing.name, quantity: qty, unit });
    }
    const created = [];
    for (const [name, g] of groups) {
      const id = insert(
        "INSERT INTO supplier_orders (establishment_id, supplier_id, supplier_name, status, note, created_at) VALUES (?, ?, ?, 'proposee', ?, ?)",
        estId, g.supplier_id, name, 'Proposée automatiquement : stock sous le minimum.', nowLocal(),
      );
      for (const l of g.lines) insert('INSERT INTO supplier_order_lines (order_id, ingredient_id, label, quantity, unit) VALUES (?, ?, ?, ?, ?)', id, l.ingredient_id, l.label, l.quantity, l.unit);
      created.push(id);
    }
    if (created.length) {
      notifyOwner(estId, {
        type: 'commande', severity: 'info',
        title: `${created.length} commande(s) fournisseur à valider`,
        body: 'Des produits sont sous le stock minimum. Vérifiez et validez avant envoi.',
        link: '/restaurateur/commandes',
      });
    }
    return created;
  });
}

/** Alerte stock bas (une fois par passage sous le seuil) puis propose les commandes. */
export function checkLowStock(estId) {
  for (const ing of lowStock(estId)) {
    notifyOwner(estId, {
      type: 'stock', severity: 'warning',
      title: `Stock bas : ${ing.name}`,
      body: `Stock ${fmtQty(ing.stock, ing.base_unit)} pour un minimum de ${fmtQty(ing.min_stock, ing.base_unit)}.`,
      link: '/restaurateur/commandes',
      dedupeKey: `stock:${ing.id}:${Math.round(ing.min_stock)}:${today()}`,
    });
  }
  proposeOrders(estId);
}

/** Alertes de dates limites : J-2, J-1, jour J et dépassées. */
export function checkDlc(estId = null) {
  const t = today();
  const rows = all(
    `SELECT * FROM dlc_items WHERE status = 'actif' AND dlc_date <= ? ${estId ? 'AND establishment_id = ?' : ''}`,
    ...(estId ? [addDays(t, 2), estId] : [addDays(t, 2)]),
  );
  for (const item of rows) {
    const expired = item.dlc_date < t;
    const isToday = item.dlc_date === t;
    const stage = expired ? 'depassee' : isToday ? 'jour' : 'bientot';
    notifyOwner(item.establishment_id, {
      type: 'dlc',
      severity: expired || isToday ? 'danger' : 'warning',
      title: expired ? `Date dépassée : ${item.product_name}` : isToday ? `À utiliser aujourd'hui : ${item.product_name}` : `Bientôt périmé : ${item.product_name}`,
      body: `${item.date_type} le ${item.dlc_date.split('-').reverse().join('/')}${item.lot_number ? ` · lot ${item.lot_number}` : ''}`,
      link: '/restaurateur/haccp/dates',
      dedupeKey: `dlc:${item.id}:${stage}`,
    });
  }
}

export function startJobs() {
  const tick = () => {
    try {
      checkDlc();
      for (const e of all('SELECT id FROM establishments')) checkLowStock(e.id);
    } catch (err) {
      console.error('Tâche planifiée :', err);
    }
  };
  setTimeout(tick, 2000);
  return setInterval(tick, 30 * 60 * 1000);
}
