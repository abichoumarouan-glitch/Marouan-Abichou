import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.MIZU_DATA_DIR || path.join(here, '..', 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const db = new DatabaseSync(process.env.MIZU_DB || path.join(DATA_DIR, 'mizu.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK (role IN ('restaurateur','comptable','collaborateur','support')),
  company TEXT,
  phone TEXT,
  accountant_id INTEGER REFERENCES users(id),
  owner_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS establishments (
  id INTEGER PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  address TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collaborators (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  job_title TEXT,
  weekly_hours REAL,
  color TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  collaborator_id INTEGER NOT NULL REFERENCES collaborators(id),
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  break_minutes INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shifts_est_date ON shifts(establishment_id, date);
CREATE TABLE IF NOT EXISTS clock_events (
  id INTEGER PRIMARY KEY,
  collaborator_id INTEGER NOT NULL REFERENCES collaborators(id),
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  type TEXT NOT NULL CHECK (type IN ('arrivee','debut_pause','fin_pause','depart')),
  at TEXT NOT NULL,
  original_at TEXT,
  correction_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS clock_collab_at ON clock_events(collaborator_id, at);
CREATE TABLE IF NOT EXISTS hours_validations (
  id INTEGER PRIMARY KEY,
  collaborator_id INTEGER NOT NULL REFERENCES collaborators(id),
  date TEXT NOT NULL,
  validated_minutes REAL NOT NULL,
  validated_by INTEGER REFERENCES users(id),
  validated_at TEXT NOT NULL,
  UNIQUE (collaborator_id, date)
);
CREATE TABLE IF NOT EXISTS correction_requests (
  id INTEGER PRIMARY KEY,
  collaborator_id INTEGER NOT NULL REFERENCES collaborators(id),
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  clock_event_id INTEGER REFERENCES clock_events(id),
  action TEXT NOT NULL CHECK (action IN ('modifier','ajouter','supprimer')),
  event_type TEXT,
  requested_at TEXT,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'en_attente' CHECK (status IN ('en_attente','acceptee','refusee')),
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  decision_comment TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_name TEXT,
  invoice_number TEXT,
  invoice_date TEXT,
  delivery_date TEXT,
  due_date TEXT,
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'brouillon' CHECK (status IN ('brouillon','validee')),
  ai_status TEXT,
  ai_message TEXT,
  total_ht REAL,
  total_tva REAL,
  total_ttc REAL,
  expense_category TEXT,
  paid_at TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL,
  validated_at TEXT
);
CREATE TABLE IF NOT EXISTS invoice_lines (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  product_name TEXT NOT NULL,
  quantity REAL,
  unit TEXT CHECK (unit IN ('kg','l','piece','carton')),
  purchase_price_ht REAL,
  tva_rate REAL,
  ingredient_id INTEGER REFERENCES ingredients(id),
  not_ingredient INTEGER NOT NULL DEFAULT 0,
  conversion REAL,
  base_quantity REAL,
  unit_cost_base REAL
);
CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  name TEXT NOT NULL,
  base_unit TEXT NOT NULL CHECK (base_unit IN ('g','ml','piece')),
  category TEXT,
  allergens TEXT NOT NULL DEFAULT '[]',
  stock REAL NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_links (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  supplier_key TEXT NOT NULL,
  product_key TEXT NOT NULL,
  ingredient_id INTEGER REFERENCES ingredients(id),
  not_ingredient INTEGER NOT NULL DEFAULT 0,
  conversion REAL,
  UNIQUE (establishment_id, supplier_key, product_key)
);
CREATE TABLE IF NOT EXISTS dishes (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  name TEXT NOT NULL,
  category TEXT,
  sale_price_ht REAL NOT NULL DEFAULT 0,
  target_food_cost_pct REAL NOT NULL DEFAULT 30,
  notes TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recipe_lines (
  id INTEGER PRIMARY KEY,
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  ingredient_id INTEGER NOT NULL REFERENCES ingredients(id),
  quantity REAL NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('g','ml','piece'))
);
CREATE TABLE IF NOT EXISTS dish_cost_history (
  id INTEGER PRIMARY KEY,
  dish_id INTEGER NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  food_cost_eur REAL NOT NULL,
  food_cost_pct REAL,
  cause TEXT,
  invoice_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER REFERENCES establishments(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  body TEXT,
  link TEXT,
  dedupe_key TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user_id, read_at);
CREATE TABLE IF NOT EXISTS daily_sales (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  date TEXT NOT NULL,
  revenue_ht REAL NOT NULL DEFAULT 0,
  vat_collected REAL NOT NULL DEFAULT 0,
  covers INTEGER,
  UNIQUE (establishment_id, date)
);
CREATE TABLE IF NOT EXISTS expense_reports (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  amount_ttc REAL NOT NULL,
  vat_amount REAL NOT NULL DEFAULT 0,
  category TEXT,
  photo_path TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  name TEXT NOT NULL,
  kind TEXT,
  min_temp REAL NOT NULL,
  max_temp REAL NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS temperature_readings (
  id INTEGER PRIMARY KEY,
  equipment_id INTEGER NOT NULL REFERENCES equipment(id),
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  value REAL NOT NULL,
  min_temp REAL NOT NULL,
  max_temp REAL NOT NULL,
  out_of_range INTEGER NOT NULL DEFAULT 0,
  taken_at TEXT NOT NULL,
  taken_by TEXT,
  user_id INTEGER REFERENCES users(id),
  comment TEXT
);
CREATE TABLE IF NOT EXISTS dlc_items (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  product_name TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('livre','maison')),
  date_type TEXT NOT NULL DEFAULT 'DLC',
  dlc_date TEXT NOT NULL,
  lot_number TEXT,
  quantity_label TEXT,
  photo_path TEXT,
  status TEXT NOT NULL DEFAULT 'actif' CHECK (status IN ('actif','utilise','jete')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cleaning_tasks (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  zone TEXT NOT NULL,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL CHECK (frequency IN ('quotidienne','hebdomadaire','mensuelle')),
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS cleaning_logs (
  id INTEGER PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES cleaning_tasks(id),
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  done_at TEXT NOT NULL,
  done_by TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  comment TEXT
);
CREATE TABLE IF NOT EXISTS supplier_orders (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  supplier_name TEXT,
  status TEXT NOT NULL DEFAULT 'proposee' CHECK (status IN ('proposee','validee','annulee')),
  note TEXT,
  created_at TEXT NOT NULL,
  validated_at TEXT,
  validated_by INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS supplier_order_lines (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES supplier_orders(id) ON DELETE CASCADE,
  ingredient_id INTEGER REFERENCES ingredients(id),
  label TEXT NOT NULL,
  quantity REAL NOT NULL,
  unit TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_tasks (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'a_faire' CHECK (status IN ('a_faire','faite')),
  done_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS marketing_contents (
  id INTEGER PRIMARY KEY,
  establishment_id INTEGER NOT NULL REFERENCES establishments(id),
  channel TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  planned_for TEXT,
  status TEXT NOT NULL DEFAULT 'a_valider' CHECK (status IN ('a_valider','validee','refusee','publiee')),
  source TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  published_at TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY,
  restaurateur_id INTEGER NOT NULL REFERENCES users(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  from_mizu INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
db.exec(SCHEMA);

// Migrations légères pour les bases existantes
const columns = (table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
if (!columns('establishments').includes('join_code')) db.exec('ALTER TABLE establishments ADD COLUMN join_code TEXT');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS establishments_join_code ON establishments(join_code)');

// node:sqlite refuse `undefined` : un champ facultatif absent est enregistré comme NULL.
const clean = (p) => p.map((v) => (v === undefined ? null : v));
export const all = (sql, ...p) => db.prepare(sql).all(...clean(p));
export const get = (sql, ...p) => db.prepare(sql).get(...clean(p));
export const run = (sql, ...p) => db.prepare(sql).run(...clean(p));
export const insert = (sql, ...p) => Number(db.prepare(sql).run(...clean(p)).lastInsertRowid);

let depth = 0;
export function tx(fn) {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export function getSetting(key) {
  return get('SELECT value FROM settings WHERE key = ?', key)?.value ?? null;
}
export function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value);
}
