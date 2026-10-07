import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, insert, tx, UPLOAD_DIR } from '../db.js';
import { fail } from '../auth.js';
import { nowLocal, isDate } from '../time.js';
import { upload, saveUpload, num, str, optDate, ownRow } from '../util.js';
import { aiAvailable, readInvoicePhoto } from '../ai.js';
import { autoLinkLines, validateInvoice, normalizeKey, naturalConversion, classifyText, EXPENSE_CATEGORIES } from '../foodcost.js';
import { emitEstablishment } from '../realtime.js';
import { checkLowStock } from '../jobs.js';

const router = express.Router({ mergeParams: true });
const UNITS = ['kg', 'l', 'piece', 'carton'];

function ensureSupplier(estId, name) {
  if (!name) return null;
  const existing = all('SELECT * FROM suppliers WHERE establishment_id = ?', estId).find((s) => normalizeKey(s.name) === normalizeKey(name));
  if (existing) return existing.id;
  return insert('INSERT INTO suppliers (establishment_id, name) VALUES (?, ?)', estId, name);
}

function suggestions(estId, productName) {
  const words = new Set(normalizeKey(productName).split(' ').filter((w) => w.length > 2));
  if (!words.size) return [];
  return all('SELECT id, name, base_unit FROM ingredients WHERE establishment_id = ?', estId)
    .map((g) => {
      const gw = normalizeKey(g.name).split(' ').filter((w) => w.length > 2);
      const score = gw.filter((w) => [...words].some((x) => x.startsWith(w) || w.startsWith(x))).length;
      return { ...g, score };
    })
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function fullInvoice(estId, id) {
  const invoice = ownRow('invoices', id, estId, 'Facture');
  const lines = all(
    `SELECT l.*, g.name AS ingredient_name, g.base_unit FROM invoice_lines l
     LEFT JOIN ingredients g ON g.id = l.ingredient_id WHERE l.invoice_id = ? ORDER BY l.position, l.id`,
    id,
  ).map((l) => ({
    ...l,
    unit_price: l.quantity ? (l.purchase_price_ht ?? 0) / l.quantity : null,
    needs_conversion: Boolean(l.ingredient_id && l.unit && !naturalConversion(l.unit, l.base_unit)),
    suggestions: !l.ingredient_id && !l.not_ingredient ? suggestions(estId, l.product_name) : [],
  }));
  const ht = lines.reduce((s, l) => s + (l.purchase_price_ht || 0), 0);
  const tva = lines.reduce((s, l) => s + (l.purchase_price_ht || 0) * ((l.tva_rate ?? 0) / 100), 0);
  return { invoice: { ...invoice, computed_ht: ht, computed_tva: tva, computed_ttc: ht + tva }, lines };
}

function insertLines(invoiceId, lines) {
  lines.forEach((l, i) => {
    insert(
      'INSERT INTO invoice_lines (invoice_id, position, product_name, quantity, unit, purchase_price_ht, tva_rate) VALUES (?, ?, ?, ?, ?, ?, ?)',
      invoiceId, i, String(l.product || 'Produit').slice(0, 200), num(l.quantity),
      UNITS.includes(l.unit) ? l.unit : null, num(l.purchase_price_ht), num(l.tva_rate) ?? 5.5,
    );
  });
}

async function runAi(invoiceId, file) {
  try {
    const r = await readInvoicePhoto(file.buffer, file.mimetype);
    tx(() => {
      run('DELETE FROM invoice_lines WHERE invoice_id = ?', invoiceId);
      insertLines(invoiceId, r.lines || []);
      const inv = get('SELECT * FROM invoices WHERE id = ?', invoiceId);
      const supplier = str(r.supplier) || inv.supplier_name;
      run(
        `UPDATE invoices SET supplier_name = ?, supplier_id = ?, invoice_number = ?, invoice_date = ?, delivery_date = ?,
           due_date = ?, total_ht = ?, total_tva = ?, total_ttc = ?, ai_status = 'ok', ai_message = ? WHERE id = ?`,
        supplier, ensureSupplier(inv.establishment_id, supplier), str(r.invoice_number),
        optDate(r.invoice_date), optDate(r.delivery_date) || optDate(r.invoice_date), optDate(r.due_date),
        num(r.total_ht), num(r.total_tva), num(r.total_ttc),
        `${(r.lines || []).length} ligne(s) lue(s). Vérifiez chaque ligne avant de valider.`, invoiceId,
      );
      autoLinkLines(invoiceId);
    });
  } catch (e) {
    console.error('Lecture IA facture :', e.message);
    run("UPDATE invoices SET ai_status = 'erreur', ai_message = ? WHERE id = ?", `Lecture automatique impossible : ${e.message}. Saisissez les lignes manuellement.`, invoiceId);
  }
}

router.get('/invoices', (req, res) => {
  const status = ['brouillon', 'validee'].includes(req.query.status) ? req.query.status : null;
  const rows = all(
    `SELECT i.*, (SELECT COUNT(*) FROM invoice_lines l WHERE l.invoice_id = i.id) AS line_count
     FROM invoices i WHERE i.establishment_id = ? ${status ? 'AND i.status = ?' : ''}
     ORDER BY i.status = 'brouillon' DESC, COALESCE(i.delivery_date, i.invoice_date, substr(i.created_at,1,10)) DESC, i.id DESC LIMIT 300`,
    ...(status ? [req.est.id, status] : [req.est.id]),
  );
  res.json({ invoices: rows, ai: aiAvailable() });
});

router.post('/invoices', upload.single('photo'), async (req, res) => {
  const photo = saveUpload(req.file);
  const ai = Boolean(req.file && aiAvailable() && req.file.mimetype.startsWith('image/'));
  const id = insert(
    `INSERT INTO invoices (establishment_id, photo_path, status, ai_status, ai_message, created_by, created_at)
     VALUES (?, ?, 'brouillon', ?, ?, ?, ?)`,
    req.est.id, photo, ai ? 'en_cours' : 'manuel',
    ai ? null : req.file ? "Lecture automatique non configurée : saisissez les lignes à partir de la photo." : 'Saisie manuelle.',
    req.user.id, nowLocal(),
  );
  if (ai) await runAi(id, req.file);
  res.status(201).json(fullInvoice(req.est.id, id));
});

router.get('/invoices/:id', (req, res) => {
  res.json({ ...fullInvoice(req.est.id, Number(req.params.id)), ai: aiAvailable() });
});

router.put('/invoices/:id', (req, res) => {
  const inv = ownRow('invoices', Number(req.params.id), req.est.id, 'Facture');
  const b = req.body || {};
  if (inv.status === 'validee') {
    // après validation, seules l'échéance et la date de paiement restent modifiables
    run('UPDATE invoices SET due_date = ?, paid_at = ? WHERE id = ?',
      'due_date' in b ? optDate(b.due_date) : inv.due_date,
      'paid_at' in b ? optDate(b.paid_at) : inv.paid_at, inv.id);
  } else {
    const supplier = 'supplier_name' in b ? str(b.supplier_name) : inv.supplier_name;
    run(
      `UPDATE invoices SET supplier_name = ?, supplier_id = ?, invoice_number = ?, invoice_date = ?, delivery_date = ?, due_date = ? WHERE id = ?`,
      supplier, ensureSupplier(req.est.id, supplier),
      'invoice_number' in b ? str(b.invoice_number) : inv.invoice_number,
      'invoice_date' in b ? optDate(b.invoice_date) : inv.invoice_date,
      'delivery_date' in b ? optDate(b.delivery_date) : inv.delivery_date,
      'due_date' in b ? optDate(b.due_date) : inv.due_date,
      inv.id,
    );
    if (supplier !== inv.supplier_name) autoLinkLines(inv.id);
  }
  res.json(fullInvoice(req.est.id, inv.id));
});

router.delete('/invoices/:id', (req, res) => {
  const inv = ownRow('invoices', Number(req.params.id), req.est.id, 'Facture');
  if (inv.status === 'validee') fail(409, 'Une facture validée ne peut pas être supprimée.');
  run('DELETE FROM invoices WHERE id = ?', inv.id);
  res.json({ ok: true });
});

router.post('/invoices/:id/reread', async (req, res) => {
  const inv = ownRow('invoices', Number(req.params.id), req.est.id, 'Facture');
  if (inv.status === 'validee') fail(409, 'Facture déjà validée.');
  if (!aiAvailable()) fail(400, "La lecture automatique n'est pas configurée sur ce serveur.");
  if (!inv.photo_path) fail(400, 'Aucune photo à relire.');
  const buffer = fs.readFileSync(path.join(UPLOAD_DIR, inv.photo_path));
  const mime = inv.photo_path.endsWith('.png') ? 'image/png' : inv.photo_path.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  await runAi(inv.id, { buffer, mimetype: mime });
  res.json(fullInvoice(req.est.id, inv.id));
});

function draftInvoice(req) {
  const inv = ownRow('invoices', Number(req.params.id), req.est.id, 'Facture');
  if (inv.status === 'validee') fail(409, 'Facture déjà validée : les lignes ne sont plus modifiables.');
  return inv;
}

function applyLineBody(estId, line, b) {
  const fields = {};
  if ('product_name' in b) fields.product_name = str(b.product_name) || line.product_name;
  if ('quantity' in b) fields.quantity = num(b.quantity);
  if ('unit' in b) fields.unit = UNITS.includes(b.unit) ? b.unit : null;
  if ('purchase_price_ht' in b) fields.purchase_price_ht = num(b.purchase_price_ht);
  if ('tva_rate' in b) fields.tva_rate = num(b.tva_rate);
  if ('conversion' in b) fields.conversion = num(b.conversion);
  if ('not_ingredient' in b) {
    fields.not_ingredient = b.not_ingredient ? 1 : 0;
    if (b.not_ingredient) fields.ingredient_id = null;
  }
  if (b.new_ingredient) {
    const n = b.new_ingredient;
    const name = str(n.name);
    if (!name) fail(400, "Nom de l'ingrédient obligatoire.");
    const base = ['g', 'ml', 'piece'].includes(n.base_unit) ? n.base_unit : 'g';
    fields.ingredient_id = insert(
      'INSERT INTO ingredients (establishment_id, name, base_unit, category, allergens, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      estId, name, base, str(n.category), JSON.stringify(Array.isArray(n.allergens) ? n.allergens : []), nowLocal(),
    );
    fields.not_ingredient = 0;
  } else if ('ingredient_id' in b) {
    if (b.ingredient_id) ownRow('ingredients', Number(b.ingredient_id), estId, 'Ingrédient');
    fields.ingredient_id = b.ingredient_id ? Number(b.ingredient_id) : null;
    if (b.ingredient_id) fields.not_ingredient = 0;
  }
  const keys = Object.keys(fields);
  if (keys.length) run(`UPDATE invoice_lines SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => fields[k]), line.id);
}

router.post('/invoices/:id/lines', (req, res) => {
  const inv = draftInvoice(req);
  const pos = get('SELECT COALESCE(MAX(position), -1) + 1 AS p FROM invoice_lines WHERE invoice_id = ?', inv.id).p;
  const id = insert('INSERT INTO invoice_lines (invoice_id, position, product_name, tva_rate) VALUES (?, ?, ?, ?)', inv.id, pos, str(req.body?.product_name) || 'Nouveau produit', 5.5);
  applyLineBody(req.est.id, get('SELECT * FROM invoice_lines WHERE id = ?', id), req.body || {});
  autoLinkLines(inv.id);
  res.status(201).json(fullInvoice(req.est.id, inv.id));
});

router.put('/invoices/:id/lines/:lineId', (req, res) => {
  const inv = draftInvoice(req);
  const line = get('SELECT * FROM invoice_lines WHERE id = ? AND invoice_id = ?', Number(req.params.lineId), inv.id);
  if (!line) fail(404, 'Ligne introuvable.');
  applyLineBody(req.est.id, line, req.body || {});
  if ('product_name' in (req.body || {})) autoLinkLines(inv.id);
  res.json(fullInvoice(req.est.id, inv.id));
});

router.delete('/invoices/:id/lines/:lineId', (req, res) => {
  const inv = draftInvoice(req);
  run('DELETE FROM invoice_lines WHERE id = ? AND invoice_id = ?', Number(req.params.lineId), inv.id);
  res.json(fullInvoice(req.est.id, inv.id));
});

router.post('/invoices/:id/validate', (req, res) => {
  const inv = draftInvoice(req);
  if (!inv.supplier_name) fail(400, 'Indiquez le fournisseur.');
  if (!inv.delivery_date) fail(400, 'Indiquez la date de livraison.');
  let result;
  try {
    result = validateInvoice(inv.id, req.user.id);
  } catch (e) {
    fail(e.status || 500, e.message);
  }
  checkLowStock(req.est.id);
  emitEstablishment(req.est.id, 'refresh', { scope: 'invoices' });
  res.json({ ...fullInvoice(req.est.id, inv.id), result });
});

// ---- Notes de frais ----
router.get('/expenses', (req, res) => {
  res.json({
    expenses: all('SELECT * FROM expense_reports WHERE establishment_id = ? ORDER BY date DESC, id DESC LIMIT 300', req.est.id),
    categories: EXPENSE_CATEGORIES,
  });
});
router.post('/expenses', upload.single('photo'), (req, res) => {
  const b = req.body || {};
  const label = str(b.label);
  const amount = num(b.amount_ttc);
  if (!label) fail(400, 'Libellé obligatoire.');
  if (!(amount > 0)) fail(400, 'Montant TTC invalide.');
  if (!isDate(b.date)) fail(400, 'Date invalide.');
  const category = EXPENSE_CATEGORIES.includes(b.category) ? b.category : classifyText(label);
  const id = insert(
    'INSERT INTO expense_reports (establishment_id, date, label, amount_ttc, vat_amount, category, photo_path, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    req.est.id, b.date, label, amount, num(b.vat_amount) ?? 0, category, saveUpload(req.file), req.user.id, nowLocal(),
  );
  res.status(201).json({ expense: get('SELECT * FROM expense_reports WHERE id = ?', id) });
});
router.delete('/expenses/:id', (req, res) => {
  ownRow('expense_reports', Number(req.params.id), req.est.id, 'Note de frais');
  run('DELETE FROM expense_reports WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

export default router;
