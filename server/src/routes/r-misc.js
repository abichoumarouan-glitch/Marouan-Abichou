import express from 'express';
import { all, get, run, insert, tx } from '../db.js';
import { fail } from '../auth.js';
import { nowLocal, today, addDays, isDate } from '../time.js';
import { num, str, ownRow } from '../util.js';
import { proposeOrders, lowStock } from '../jobs.js';
import { aiAvailable, proposeMarketing } from '../ai.js';
import { emit, notify, notifyOwner } from '../realtime.js';
import { orderPdf } from '../exports.js';

// =============== Commandes fournisseurs ===============
export const ordersRouter = express.Router({ mergeParams: true });

function orderView(o) {
  return {
    ...o,
    supplier: o.supplier_id ? get('SELECT * FROM suppliers WHERE id = ?', o.supplier_id) : null,
    lines: all(
      `SELECT l.*, g.stock, g.min_stock, g.base_unit FROM supplier_order_lines l
       LEFT JOIN ingredients g ON g.id = l.ingredient_id WHERE l.order_id = ? ORDER BY l.id`,
      o.id,
    ),
  };
}

ordersRouter.get('/orders', (req, res) => {
  const orders = all(
    `SELECT * FROM supplier_orders WHERE establishment_id = ?
     ORDER BY status = 'proposee' DESC, created_at DESC LIMIT 100`,
    req.est.id,
  ).map(orderView);
  res.json({
    orders,
    low_stock: lowStock(req.est.id),
    ingredients: all('SELECT id, name, base_unit, stock, min_stock FROM ingredients WHERE establishment_id = ? ORDER BY name COLLATE NOCASE', req.est.id),
    suppliers: all('SELECT * FROM suppliers WHERE establishment_id = ? ORDER BY name', req.est.id),
  });
});

ordersRouter.post('/orders/propose', (req, res) => {
  const created = proposeOrders(req.est.id);
  res.json({ created: created.length });
});

function proposedOrder(req) {
  const o = ownRow('supplier_orders', Number(req.params.id), req.est.id, 'Commande');
  if (o.status !== 'proposee') fail(409, 'Cette commande a déjà été traitée.');
  return o;
}

ordersRouter.put('/orders/:id', (req, res) => {
  const o = proposedOrder(req);
  const b = req.body || {};
  tx(() => {
    if ('note' in b) run('UPDATE supplier_orders SET note = ? WHERE id = ?', str(b.note), o.id);
    if (Array.isArray(b.lines)) {
      run('DELETE FROM supplier_order_lines WHERE order_id = ?', o.id);
      for (const l of b.lines) {
        const q = num(l.quantity);
        if (!(q > 0)) continue;
        const ing = l.ingredient_id ? ownRow('ingredients', Number(l.ingredient_id), req.est.id, 'Ingrédient') : null;
        const label = str(l.label) || ing?.name;
        if (!label) continue;
        insert('INSERT INTO supplier_order_lines (order_id, ingredient_id, label, quantity, unit) VALUES (?, ?, ?, ?, ?)',
          o.id, ing?.id ?? null, label, q, ['kg', 'l', 'piece', 'carton'].includes(l.unit) ? l.unit : 'piece');
      }
    }
  });
  res.json({ order: orderView(get('SELECT * FROM supplier_orders WHERE id = ?', o.id)) });
});

ordersRouter.post('/orders/:id/validate', (req, res) => {
  const o = proposedOrder(req);
  if (!get('SELECT COUNT(*) AS n FROM supplier_order_lines WHERE order_id = ?', o.id).n) fail(400, 'La commande est vide.');
  run("UPDATE supplier_orders SET status = 'validee', validated_at = ?, validated_by = ? WHERE id = ?", nowLocal(), req.user.id, o.id);
  res.json({ order: orderView(get('SELECT * FROM supplier_orders WHERE id = ?', o.id)) });
});

ordersRouter.post('/orders/:id/cancel', (req, res) => {
  const o = proposedOrder(req);
  run("UPDATE supplier_orders SET status = 'annulee' WHERE id = ?", o.id);
  res.json({ ok: true });
});

ordersRouter.get('/orders/:id/pdf', (req, res) => {
  const o = ownRow('supplier_orders', Number(req.params.id), req.est.id, 'Commande');
  if (o.status !== 'validee') fail(409, 'Le bon de commande est disponible après validation.');
  orderPdf(res, req.est, orderView(o));
});

ordersRouter.put('/suppliers/:id', (req, res) => {
  const s = ownRow('suppliers', Number(req.params.id), req.est.id, 'Fournisseur');
  const email = str(req.body?.email);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Email invalide.');
  run('UPDATE suppliers SET email = ?, phone = ? WHERE id = ?', email, str(req.body?.phone), s.id);
  res.json({ supplier: get('SELECT * FROM suppliers WHERE id = ?', s.id) });
});

// =============== Marketing ===============
export const marketingRouter = express.Router({ mergeParams: true });

marketingRouter.get('/marketing', (req, res) => {
  res.json({
    tasks: all("SELECT * FROM marketing_tasks WHERE establishment_id = ? ORDER BY status = 'faite', COALESCE(due_date, '9999'), id DESC", req.est.id),
    contents: all("SELECT * FROM marketing_contents WHERE establishment_id = ? ORDER BY status = 'a_valider' DESC, created_at DESC LIMIT 200", req.est.id),
    ai: aiAvailable(),
  });
});

marketingRouter.post('/marketing/tasks', (req, res) => {
  const title = str(req.body?.title);
  if (!title) fail(400, 'Titre obligatoire.');
  const id = insert('INSERT INTO marketing_tasks (establishment_id, title, description, due_date, created_at) VALUES (?, ?, ?, ?, ?)',
    req.est.id, title, str(req.body?.description), isDate(req.body?.due_date) ? req.body.due_date : null, nowLocal());
  res.status(201).json({ task: get('SELECT * FROM marketing_tasks WHERE id = ?', id) });
});

marketingRouter.put('/marketing/tasks/:id', (req, res) => {
  const t = ownRow('marketing_tasks', Number(req.params.id), req.est.id, 'Tâche');
  const b = req.body || {};
  const status = b.status === 'faite' ? 'faite' : b.status === 'a_faire' ? 'a_faire' : t.status;
  run('UPDATE marketing_tasks SET title = ?, description = ?, due_date = ?, status = ?, done_at = ? WHERE id = ?',
    str(b.title) || t.title, 'description' in b ? str(b.description) : t.description,
    'due_date' in b ? (isDate(b.due_date) ? b.due_date : null) : t.due_date,
    status, status === 'faite' ? t.done_at || nowLocal() : null, t.id);
  res.json({ task: get('SELECT * FROM marketing_tasks WHERE id = ?', t.id) });
});

marketingRouter.delete('/marketing/tasks/:id', (req, res) => {
  ownRow('marketing_tasks', Number(req.params.id), req.est.id, 'Tâche');
  run('DELETE FROM marketing_tasks WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

function templateContents(est, dishes) {
  const pick = (i) => dishes.length ? dishes[(new Date().getDate() + i) % dishes.length].name : 'notre plat du jour';
  return [
    { channel: 'Instagram', title: `Zoom sur ${pick(0)}`, body: `Cette semaine chez ${est.name}, on vous fait découvrir ${pick(0)} : des produits frais, travaillés sur place. À découvrir midi et soir. Réservation conseillée.` },
    { channel: 'Facebook', title: 'Les coulisses de la cuisine', body: `Chaque matin, l'équipe de ${est.name} réceptionne les livraisons et prépare tout sur place. Venez goûter ${pick(1)} et dites-nous ce que vous en pensez !` },
    { channel: 'Google', title: 'Remerciement après avis', body: `Merci beaucoup pour votre visite et votre retour ! Toute l'équipe de ${est.name} est ravie que vous ayez apprécié. Au plaisir de vous accueillir à nouveau.` },
  ];
}

marketingRouter.post('/marketing/propose', async (req, res) => {
  const dishes = all('SELECT name FROM dishes WHERE establishment_id = ? AND active = 1', req.est.id);
  const recent = all('SELECT title FROM marketing_contents WHERE establishment_id = ? ORDER BY id DESC LIMIT 10', req.est.id).map((r) => r.title);
  let contents;
  let source = 'modele';
  if (aiAvailable()) {
    try {
      contents = await proposeMarketing({ establishment: req.est, dishes, recent });
      source = 'ia';
    } catch (e) {
      console.error('Proposition marketing IA :', e.message);
    }
  }
  if (!contents?.length) contents = templateContents(req.est, dishes);
  const planned = addDays(today(), 2);
  tx(() => {
    for (const c of contents) {
      insert("INSERT INTO marketing_contents (establishment_id, channel, title, body, planned_for, status, source, created_at) VALUES (?, ?, ?, ?, ?, 'a_valider', ?, ?)",
        req.est.id, c.channel, c.title, c.body, planned, source, nowLocal());
    }
  });
  notifyOwner(req.est.id, {
    type: 'marketing', severity: 'info',
    title: `${contents.length} contenu(s) marketing à valider`,
    body: 'Relisez et validez : rien n’est publié automatiquement.',
    link: '/restaurateur/marketing',
  });
  res.json({ created: contents.length, source });
});

marketingRouter.put('/marketing/contents/:id', (req, res) => {
  const c = ownRow('marketing_contents', Number(req.params.id), req.est.id, 'Contenu');
  if (!['a_valider', 'validee'].includes(c.status)) fail(409, 'Ce contenu ne peut plus être modifié.');
  const b = req.body || {};
  run('UPDATE marketing_contents SET title = ?, body = ?, planned_for = ? WHERE id = ?',
    str(b.title) || c.title, str(b.body) || c.body, 'planned_for' in b ? (isDate(b.planned_for) ? b.planned_for : null) : c.planned_for, c.id);
  res.json({ content: get('SELECT * FROM marketing_contents WHERE id = ?', c.id) });
});

marketingRouter.post('/marketing/contents/:id/decide', (req, res) => {
  const c = ownRow('marketing_contents', Number(req.params.id), req.est.id, 'Contenu');
  if (c.status !== 'a_valider') fail(409, 'Ce contenu a déjà été traité.');
  const decision = req.body?.decision === 'validee' ? 'validee' : req.body?.decision === 'refusee' ? 'refusee' : fail(400, 'Décision invalide.');
  run('UPDATE marketing_contents SET status = ?, decided_at = ? WHERE id = ?', decision, nowLocal(), c.id);
  res.json({ content: get('SELECT * FROM marketing_contents WHERE id = ?', c.id) });
});

marketingRouter.post('/marketing/contents/:id/published', (req, res) => {
  const c = ownRow('marketing_contents', Number(req.params.id), req.est.id, 'Contenu');
  if (c.status !== 'validee') fail(409, 'Seul un contenu validé peut être marqué comme publié.');
  run("UPDATE marketing_contents SET status = 'publiee', published_at = ? WHERE id = ?", nowLocal(), c.id);
  res.json({ content: get('SELECT * FROM marketing_contents WHERE id = ?', c.id) });
});

// =============== Contact : messagerie avec l'équipe Mizu ===============
export const contactRouter = express.Router();

const thread = (restaurateurId) => all(
  `SELECT m.*, u.first_name, u.last_name FROM messages m JOIN users u ON u.id = m.author_id
   WHERE m.restaurateur_id = ? ORDER BY m.created_at, m.id`,
  restaurateurId,
);

contactRouter.get('/messages', (req, res) => {
  run('UPDATE messages SET read_at = ? WHERE restaurateur_id = ? AND from_mizu = 1 AND read_at IS NULL', nowLocal(), req.user.id);
  res.json({ messages: thread(req.user.id) });
});

contactRouter.post('/messages', (req, res) => {
  const body = str(req.body?.body);
  if (!body) fail(400, 'Message vide.');
  if (body.length > 5000) fail(400, 'Message trop long.');
  const id = insert('INSERT INTO messages (restaurateur_id, author_id, from_mizu, body, created_at) VALUES (?, ?, 0, ?, ?)', req.user.id, req.user.id, body, nowLocal());
  for (const s of all("SELECT id FROM users WHERE role = 'support' AND active = 1")) {
    emit(s.id, 'message', { restaurateur_id: req.user.id });
    notify({ userId: s.id, type: 'message', title: `Nouveau message de ${req.user.first_name} ${req.user.last_name}`.trim(), body: body.slice(0, 140), link: `/support/${req.user.id}` });
  }
  res.status(201).json({ message: get('SELECT * FROM messages WHERE id = ?', id) });
});

// Espace support (équipe Mizu) : répond aux restaurateurs
export const supportRouter = express.Router();

supportRouter.get('/threads', (_req, res) => {
  res.json({
    threads: all(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.company,
              MAX(m.created_at) AS last_at,
              SUM(CASE WHEN m.from_mizu = 0 AND m.read_at IS NULL THEN 1 ELSE 0 END) AS unread,
              (SELECT body FROM messages x WHERE x.restaurateur_id = u.id ORDER BY x.id DESC LIMIT 1) AS last_body
       FROM users u JOIN messages m ON m.restaurateur_id = u.id
       WHERE u.role = 'restaurateur' GROUP BY u.id ORDER BY last_at DESC`,
    ),
  });
});

supportRouter.get('/threads/:id', (req, res) => {
  const r = get("SELECT id, first_name, last_name, email, company FROM users WHERE id = ? AND role = 'restaurateur'", Number(req.params.id));
  if (!r) fail(404, 'Restaurateur introuvable.');
  run('UPDATE messages SET read_at = ? WHERE restaurateur_id = ? AND from_mizu = 0 AND read_at IS NULL', nowLocal(), r.id);
  res.json({ restaurateur: r, messages: thread(r.id) });
});

supportRouter.post('/threads/:id', (req, res) => {
  const r = get("SELECT id FROM users WHERE id = ? AND role = 'restaurateur'", Number(req.params.id));
  if (!r) fail(404, 'Restaurateur introuvable.');
  const body = str(req.body?.body);
  if (!body) fail(400, 'Message vide.');
  const id = insert('INSERT INTO messages (restaurateur_id, author_id, from_mizu, body, created_at) VALUES (?, ?, 1, ?, ?)', r.id, req.user.id, body, nowLocal());
  emit(r.id, 'message', {});
  notify({ userId: r.id, type: 'message', title: "Réponse de l'équipe Mizu", body: body.slice(0, 140), link: '/restaurateur/contact' });
  res.status(201).json({ message: get('SELECT * FROM messages WHERE id = ?', id) });
});
