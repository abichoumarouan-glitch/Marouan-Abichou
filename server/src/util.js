import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { UPLOAD_DIR, get } from './db.js';
import { fail } from './auth.js';
import { isDate, today, addDays } from './time.js';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\/|^application\/pdf$/.test(file.mimetype)),
});

export function saveUpload(file) {
  if (!file) return null;
  const ext = { 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' }[file.mimetype] || '.jpg';
  const name = `${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return name;
}

export const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
export const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
export const optDate = (v) => (isDate(v) ? v : null);

export function requireFields(obj, fields) {
  for (const [k, label] of Object.entries(fields)) {
    if (obj[k] == null || obj[k] === '') fail(400, `${label} : champ obligatoire.`);
  }
}

/** Vérifie qu'un enregistrement appartient bien à l'établissement. */
export function ownRow(table, id, estId, label = 'Élément') {
  const row = get(`SELECT * FROM ${table} WHERE id = ? AND establishment_id = ?`, id, estId);
  if (!row) fail(404, `${label} introuvable.`);
  return row;
}

export function periodFromQuery(q, fallbackDays = 30) {
  const to = isDate(q.to) ? q.to : today();
  const from = isDate(q.from) ? q.from : addDays(to, -fallbackDays);
  if (from > to) fail(400, 'La date de début doit précéder la date de fin.');
  return { from, to };
}
