import express from 'express';
import { all, get, run, insert } from '../db.js';
import { fail } from '../auth.js';
import { nowLocal, today, addDays, mondayOf, isDate } from '../time.js';
import { num, str, periodFromQuery } from '../util.js';
import { dishesForEstablishment } from '../foodcost.js';
import { liveStatus } from '../hours.js';

export const establishmentsRouter = express.Router();

establishmentsRouter.get('/', (req, res) => {
  res.json({ establishments: all('SELECT * FROM establishments WHERE owner_id = ? ORDER BY id', req.user.id) });
});
establishmentsRouter.post('/', (req, res) => {
  const name = str(req.body?.name);
  if (!name) fail(400, "Le nom de l'établissement est obligatoire.");
  const id = insert('INSERT INTO establishments (owner_id, name, address, created_at) VALUES (?, ?, ?, ?)', req.user.id, name, str(req.body?.address), nowLocal());
  res.status(201).json({ establishment: get('SELECT * FROM establishments WHERE id = ?', id) });
});
establishmentsRouter.put('/:id', (req, res) => {
  const est = get('SELECT * FROM establishments WHERE id = ? AND owner_id = ?', Number(req.params.id), req.user.id);
  if (!est) fail(404, 'Établissement introuvable.');
  const name = str(req.body?.name) || est.name;
  run('UPDATE establishments SET name = ?, address = ? WHERE id = ?', name, str(req.body?.address), est.id);
  res.json({ establishment: get('SELECT * FROM establishments WHERE id = ?', est.id) });
});

/** Garde : l'établissement de l'URL appartient au restaurateur connecté. */
export function establishmentGuard(req, _res, next) {
  const est = get('SELECT * FROM establishments WHERE id = ? AND owner_id = ?', Number(req.params.estId), req.user.id);
  if (!est) return next(Object.assign(new Error('Établissement introuvable.'), { status: 404 }));
  req.est = est;
  next();
}

export const coreRouter = express.Router({ mergeParams: true });

function bucketOf(date, group) {
  if (group === 'month') return date.slice(0, 7);
  if (group === 'week') return mondayOf(date);
  return date;
}

export function dashboardData(estId, from, to, group) {
  const sales = all('SELECT * FROM daily_sales WHERE establishment_id = ? AND date BETWEEN ? AND ?', estId, from, to);
  const purchases = all(
    `SELECT COALESCE(delivery_date, invoice_date) AS date, total_ht FROM invoices
     WHERE establishment_id = ? AND status = 'validee'
       AND expense_category IN ('Achats alimentaires', 'Boissons')
       AND COALESCE(delivery_date, invoice_date) BETWEEN ? AND ?`,
    estId, from, to,
  );
  const buckets = new Map();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const b = bucketOf(d, group);
    if (!buckets.has(b)) buckets.set(b, { key: b, revenue: 0, purchases: 0, covers: 0, days_with_sales: 0 });
  }
  for (const s of sales) {
    const b = buckets.get(bucketOf(s.date, group));
    b.revenue += s.revenue_ht;
    b.covers += s.covers || 0;
    b.days_with_sales += 1;
  }
  for (const p of purchases) buckets.get(bucketOf(p.date, group)).purchases += p.total_ht || 0;
  const series = [...buckets.values()].map((b) => ({ ...b, margin: b.revenue - b.purchases }));
  const revenue = series.reduce((s, x) => s + x.revenue, 0);
  const purchasesTotal = series.reduce((s, x) => s + x.purchases, 0);
  const covers = series.reduce((s, x) => s + x.covers, 0);
  return {
    from, to, group, series,
    totals: {
      revenue,
      purchases: purchasesTotal,
      margin: revenue - purchasesTotal,
      margin_pct: revenue > 0 ? ((revenue - purchasesTotal) / revenue) * 100 : null,
      food_cost_pct: revenue > 0 ? (purchasesTotal / revenue) * 100 : null,
      covers,
      average_ticket: covers > 0 ? revenue / covers : null,
    },
  };
}

coreRouter.get('/dashboard', (req, res) => {
  const { from, to } = periodFromQuery(req.query, 6);
  const group = ['day', 'week', 'month'].includes(req.query.group) ? req.query.group : 'day';
  const data = dashboardData(req.est.id, from, to, group);
  // comparaison avec la période précédente, à durée égale ; une période en cours
  // n'est comparée que jusqu'à aujourd'hui (sinon une semaine entamée paraît toujours en baisse)
  const t0 = today();
  const effTo = to > t0 ? (from > t0 ? from : t0) : to;
  const len = Math.round((Date.parse(effTo) - Date.parse(from)) / 86400000) + 1;
  const prev = dashboardData(req.est.id, addDays(from, -len), addDays(from, -1), group);
  const cur = effTo === to ? data.totals : dashboardData(req.est.id, from, effTo, group).totals;
  const dishes = dishesForEstablishment(req.est.id);
  const priced = dishes.filter((d) => d.food_cost_pct != null);
  const collabs = all('SELECT id FROM collaborators WHERE establishment_id = ? AND active = 1', req.est.id);
  const statuses = collabs.map((c) => liveStatus(c.id).status);
  const t = today();
  res.json({
    ...data,
    previous: prev.totals,
    compared: { current: cur, from: addDays(from, -len), to: addDays(from, -1), until: effTo },
    theoretical_food_cost_pct: priced.length ? priced.reduce((s, d) => s + d.food_cost_pct, 0) / priced.length : null,
    dishes_over_target: dishes.filter((d) => d.food_cost_pct != null && d.food_cost_pct > d.target_food_cost_pct).map((d) => ({ id: d.id, name: d.name, food_cost_pct: d.food_cost_pct, target: d.target_food_cost_pct })),
    team: { present: statuses.filter((s) => s === 'present').length, pause: statuses.filter((s) => s === 'pause').length, total: collabs.length },
    pending: {
      draft_invoices: get("SELECT COUNT(*) AS n FROM invoices WHERE establishment_id = ? AND status = 'brouillon'", req.est.id).n,
      orders: get("SELECT COUNT(*) AS n FROM supplier_orders WHERE establishment_id = ? AND status = 'proposee'", req.est.id).n,
      marketing: get("SELECT COUNT(*) AS n FROM marketing_contents WHERE establishment_id = ? AND status = 'a_valider'", req.est.id).n,
      corrections: get("SELECT COUNT(*) AS n FROM correction_requests WHERE establishment_id = ? AND status = 'en_attente'", req.est.id).n,
      dlc_soon: get("SELECT COUNT(*) AS n FROM dlc_items WHERE establishment_id = ? AND status = 'actif' AND dlc_date <= ?", req.est.id, addDays(t, 2)).n,
    },
    today_sales: get('SELECT * FROM daily_sales WHERE establishment_id = ? AND date = ?', req.est.id, t) || null,
  });
});

coreRouter.get('/sales', (req, res) => {
  const { from, to } = periodFromQuery(req.query, 13);
  res.json({ sales: all('SELECT * FROM daily_sales WHERE establishment_id = ? AND date BETWEEN ? AND ? ORDER BY date DESC', req.est.id, from, to) });
});

coreRouter.put('/sales/:date', (req, res) => {
  const date = req.params.date;
  if (!isDate(date)) fail(400, 'Date invalide.');
  const revenue = num(req.body?.revenue_ht);
  if (revenue == null || revenue < 0) fail(400, "Chiffre d'affaires HT invalide.");
  const vat = num(req.body?.vat_collected) ?? revenue * 0.1;
  run(
    `INSERT INTO daily_sales (establishment_id, date, revenue_ht, vat_collected, covers) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(establishment_id, date) DO UPDATE SET revenue_ht = excluded.revenue_ht, vat_collected = excluded.vat_collected, covers = excluded.covers`,
    req.est.id, date, revenue, vat, num(req.body?.covers),
  );
  res.json({ sale: get('SELECT * FROM daily_sales WHERE establishment_id = ? AND date = ?', req.est.id, date) });
});
