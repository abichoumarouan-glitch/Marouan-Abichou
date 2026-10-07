import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { all, get, run, insert, UPLOAD_DIR } from '../db.js';
import { fail } from '../auth.js';
import { nowLocal, today, mondayOf, isDate, isDateTime, normDateTime } from '../time.js';
import { upload, saveUpload, num, str, ownRow, periodFromQuery } from '../util.js';
import { aiAvailable, readLabelPhoto } from '../ai.js';
import { notifyOwner } from '../realtime.js';
import { checkDlc } from '../jobs.js';
import { haccpExport } from '../exports.js';

const router = express.Router({ mergeParams: true });
const userName = (u) => `${u.first_name} ${u.last_name}`.trim();

// ---- Équipements et relevés de température ----
router.get('/equipment', (req, res) => {
  const rows = all('SELECT * FROM equipment WHERE establishment_id = ? AND active = 1 ORDER BY name', req.est.id).map((e) => ({
    ...e,
    last: get('SELECT * FROM temperature_readings WHERE equipment_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1', e.id) || null,
  }));
  res.json({ equipment: rows });
});

function equipmentFields(b, cur = {}) {
  const name = 'name' in b ? str(b.name) : cur.name;
  const min = 'min_temp' in b ? num(b.min_temp) : cur.min_temp;
  const max = 'max_temp' in b ? num(b.max_temp) : cur.max_temp;
  if (!name) fail(400, "Le nom de l'équipement est obligatoire.");
  if (min == null || max == null || min >= max) fail(400, 'Le seuil bas doit être inférieur au seuil haut.');
  return { name, min, max, kind: 'kind' in b ? str(b.kind) : cur.kind };
}
router.post('/equipment', (req, res) => {
  const f = equipmentFields(req.body || {});
  const id = insert('INSERT INTO equipment (establishment_id, name, kind, min_temp, max_temp) VALUES (?, ?, ?, ?, ?)', req.est.id, f.name, f.kind, f.min, f.max);
  res.status(201).json({ equipment: get('SELECT * FROM equipment WHERE id = ?', id) });
});
router.put('/equipment/:id', (req, res) => {
  const cur = ownRow('equipment', Number(req.params.id), req.est.id, 'Équipement');
  if (req.body?.active === false) {
    run('UPDATE equipment SET active = 0 WHERE id = ?', cur.id);
    return res.json({ ok: true });
  }
  const f = equipmentFields(req.body || {}, cur);
  run('UPDATE equipment SET name = ?, kind = ?, min_temp = ?, max_temp = ? WHERE id = ?', f.name, f.kind, f.min, f.max, cur.id);
  res.json({ equipment: get('SELECT * FROM equipment WHERE id = ?', cur.id) });
});

router.get('/temperatures', (req, res) => {
  const { from, to } = periodFromQuery(req.query, 7);
  const eq = Number(req.query.equipment) || null;
  const rows = all(
    `SELECT t.*, e.name AS equipment_name FROM temperature_readings t JOIN equipment e ON e.id = t.equipment_id
     WHERE t.establishment_id = ? AND substr(t.taken_at, 1, 10) BETWEEN ? AND ? ${eq ? 'AND t.equipment_id = ?' : ''}
     ORDER BY t.taken_at DESC, t.id DESC`,
    ...(eq ? [req.est.id, from, to, eq] : [req.est.id, from, to]),
  );
  res.json({ readings: rows, from, to });
});

router.post('/temperatures', (req, res) => {
  const b = req.body || {};
  const eq = ownRow('equipment', Number(b.equipment_id), req.est.id, 'Équipement');
  const value = num(b.value);
  if (value == null || value < -60 || value > 120) fail(400, 'Température invalide.');
  const takenAt = isDateTime(b.taken_at) ? normDateTime(b.taken_at) : nowLocal();
  const out = value < eq.min_temp || value > eq.max_temp;
  if (out && !str(b.comment)) fail(400, 'Température hors seuil : indiquez l’action corrective réalisée.');
  const id = insert(
    `INSERT INTO temperature_readings (equipment_id, establishment_id, value, min_temp, max_temp, out_of_range, taken_at, taken_by, user_id, comment)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    eq.id, req.est.id, value, eq.min_temp, eq.max_temp, out ? 1 : 0, takenAt, str(b.taken_by) || userName(req.user), req.user.id, str(b.comment),
  );
  if (out) {
    notifyOwner(req.est.id, {
      type: 'temperature', severity: 'danger',
      title: `Température hors seuil : ${eq.name}`,
      body: `${String(value).replace('.', ',')} °C relevés (seuils ${eq.min_temp} °C à ${eq.max_temp} °C).`,
      link: '/restaurateur/haccp/temperatures',
    });
  }
  res.status(201).json({ reading: get('SELECT * FROM temperature_readings WHERE id = ?', id), out_of_range: out });
});

// ---- Dates limites ----
router.get('/dlc', (req, res) => {
  const status = ['actif', 'utilise', 'jete'].includes(req.query.status) ? req.query.status : 'actif';
  res.json({
    items: all('SELECT * FROM dlc_items WHERE establishment_id = ? AND status = ? ORDER BY dlc_date, product_name LIMIT 500', req.est.id, status),
    today: today(),
    ai: aiAvailable(),
  });
});

router.post('/dlc/label', upload.single('photo'), async (req, res) => {
  if (!req.file) fail(400, 'Photo manquante.');
  const photo = saveUpload(req.file);
  if (!aiAvailable()) {
    return res.json({ photo_path: photo, ai: false, message: "Lecture automatique non configurée : saisissez la date lue sur l'étiquette." });
  }
  try {
    const r = await readLabelPhoto(req.file.buffer, req.file.mimetype);
    res.json({
      photo_path: photo, ai: true,
      product_name: r.product_name, dlc_date: isDate(r.date) ? r.date : null, date_type: r.date_type || 'DLC', lot_number: r.lot_number,
      message: isDate(r.date) ? 'Date lue sur l’étiquette : vérifiez avant d’enregistrer.' : 'Date illisible : saisissez-la manuellement.',
    });
  } catch (e) {
    res.json({ photo_path: photo, ai: false, message: `Lecture impossible (${e.message}). Saisissez la date manuellement.` });
  }
});

router.post('/dlc', (req, res) => {
  const b = req.body || {};
  const name = str(b.product_name);
  if (!name) fail(400, 'Nom du produit obligatoire.');
  if (!isDate(b.dlc_date)) fail(400, 'Date limite invalide.');
  const origin = b.origin === 'maison' ? 'maison' : 'livre';
  let photo = null;
  if (b.photo_path) {
    photo = path.basename(String(b.photo_path));
    const taken = get('SELECT id FROM dlc_items WHERE photo_path = ?', photo) || get('SELECT id FROM invoices WHERE photo_path = ?', photo);
    if (taken || !fs.existsSync(path.join(UPLOAD_DIR, photo))) photo = null;
  }
  const id = insert(
    `INSERT INTO dlc_items (establishment_id, product_name, origin, date_type, dlc_date, lot_number, quantity_label, photo_path, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    req.est.id, name, origin, b.date_type === 'DDM' ? 'DDM' : 'DLC', b.dlc_date, str(b.lot_number), str(b.quantity_label), photo, req.user.id, nowLocal(),
  );
  checkDlc(req.est.id);
  res.status(201).json({ item: get('SELECT * FROM dlc_items WHERE id = ?', id) });
});

router.put('/dlc/:id', (req, res) => {
  const item = ownRow('dlc_items', Number(req.params.id), req.est.id, 'Produit');
  const status = ['actif', 'utilise', 'jete'].includes(req.body?.status) ? req.body.status : item.status;
  run('UPDATE dlc_items SET status = ? WHERE id = ?', status, item.id);
  res.json({ item: get('SELECT * FROM dlc_items WHERE id = ?', item.id) });
});

// ---- Plan de nettoyage ----
function periodStart(freq) {
  const t = today();
  if (freq === 'hebdomadaire') return mondayOf(t);
  if (freq === 'mensuelle') return `${t.slice(0, 7)}-01`;
  return t;
}

router.get('/cleaning', (req, res) => {
  const tasks = all('SELECT * FROM cleaning_tasks WHERE establishment_id = ? AND active = 1 ORDER BY zone, frequency, name', req.est.id).map((t) => {
    const last = get('SELECT * FROM cleaning_logs WHERE task_id = ? ORDER BY done_at DESC LIMIT 1', t.id) || null;
    return { ...t, last, done: Boolean(last && last.done_at.slice(0, 10) >= periodStart(t.frequency)) };
  });
  res.json({ tasks });
});

router.get('/cleaning/logs', (req, res) => {
  const { from, to } = periodFromQuery(req.query, 7);
  res.json({
    logs: all(
      `SELECT l.*, t.name AS task_name, t.zone, t.frequency FROM cleaning_logs l JOIN cleaning_tasks t ON t.id = l.task_id
       WHERE l.establishment_id = ? AND substr(l.done_at, 1, 10) BETWEEN ? AND ? ORDER BY l.done_at DESC`,
      req.est.id, from, to,
    ),
    from, to,
  });
});

router.post('/cleaning', (req, res) => {
  const b = req.body || {};
  const zone = str(b.zone);
  const name = str(b.name);
  if (!zone || !name) fail(400, 'Zone et tâche obligatoires.');
  const freq = ['quotidienne', 'hebdomadaire', 'mensuelle'].includes(b.frequency) ? b.frequency : 'quotidienne';
  const id = insert('INSERT INTO cleaning_tasks (establishment_id, zone, name, frequency) VALUES (?, ?, ?, ?)', req.est.id, zone, name, freq);
  res.status(201).json({ task: get('SELECT * FROM cleaning_tasks WHERE id = ?', id) });
});

router.delete('/cleaning/:id', (req, res) => {
  ownRow('cleaning_tasks', Number(req.params.id), req.est.id, 'Tâche');
  run('UPDATE cleaning_tasks SET active = 0 WHERE id = ?', Number(req.params.id));
  res.json({ ok: true });
});

router.post('/cleaning/:id/done', (req, res) => {
  const task = ownRow('cleaning_tasks', Number(req.params.id), req.est.id, 'Tâche');
  const by = str(req.body?.done_by) || userName(req.user);
  const id = insert('INSERT INTO cleaning_logs (task_id, establishment_id, done_at, done_by, user_id, comment) VALUES (?, ?, ?, ?, ?, ?)',
    task.id, req.est.id, nowLocal(), by, req.user.id, str(req.body?.comment));
  res.status(201).json({ log: get('SELECT * FROM cleaning_logs WHERE id = ?', id) });
});

// ---- Archive pour contrôle (export en un clic) ----
router.get('/haccp/export', async (req, res) => {
  const { from, to } = periodFromQuery(req.query, 30);
  await haccpExport(res, req.est, from, to, req.query.format === 'xlsx' ? 'xlsx' : 'pdf');
});

export default router;
