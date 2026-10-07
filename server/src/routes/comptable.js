import express from 'express';
import { all, get, run, insert, tx } from '../db.js';
import { fail, createUser, generatePassword, publicUser } from '../auth.js';
import { nowLocal } from '../time.js';
import { str, periodFromQuery } from '../util.js';
import { accountingData } from '../accounting.js';
import { accountingExport } from '../exports.js';

// Le comptable consulte : aucune route ici ne modifie les données d'un restaurateur,
// à l'exception de la création et du retrait des comptes clients.
const router = express.Router();

function client(req) {
  const c = get("SELECT * FROM users WHERE id = ? AND role = 'restaurateur' AND accountant_id = ?", Number(req.params.id), req.user.id);
  if (!c) fail(404, 'Client introuvable.');
  return c;
}

function establishmentsFor(c, query) {
  const list = all('SELECT id, name, address FROM establishments WHERE owner_id = ? ORDER BY id', c.id);
  const only = Number(query.establishment);
  return only ? list.filter((e) => e.id === only) : list;
}

router.get('/clients', (req, res) => {
  const clients = all("SELECT * FROM users WHERE role = 'restaurateur' AND accountant_id = ? AND active = 1 ORDER BY company, last_name", req.user.id)
    .map((u) => {
      const ests = all('SELECT id, name FROM establishments WHERE owner_id = ?', u.id);
      const ids = ests.map((e) => e.id);
      const q = ids.map(() => '?').join(',') || 'NULL';
      return {
        ...publicUser(u),
        establishments: ests,
        invoices_to_check: ids.length ? get(`SELECT COUNT(*) AS n FROM invoices WHERE establishment_id IN (${q}) AND status = 'validee' AND paid_at IS NULL AND due_date IS NOT NULL`, ...ids).n : 0,
        last_invoice: ids.length ? get(`SELECT MAX(validated_at) AS d FROM invoices WHERE establishment_id IN (${q})`, ...ids).d : null,
      };
    });
  res.json({ clients });
});

router.post('/clients', (req, res) => {
  const b = req.body || {};
  const company = str(b.company);
  if (!company) fail(400, "Le nom de l'entreprise est obligatoire.");
  const password = generatePassword();
  const id = tx(() => {
    const uid = createUser({
      email: b.email, password, first_name: b.first_name, last_name: b.last_name || '', company, phone: str(b.phone),
      role: 'restaurateur', accountant_id: req.user.id,
    });
    insert('INSERT INTO establishments (owner_id, name, address, created_at) VALUES (?, ?, ?, ?)', uid, str(b.establishment_name) || company, str(b.address), nowLocal());
    return uid;
  });
  res.status(201).json({ client: publicUser(get('SELECT * FROM users WHERE id = ?', id)), password });
});

router.delete('/clients/:id', (req, res) => {
  const c = client(req);
  // Retrait : le compte est désactivé (connexion impossible) et détaché du cabinet.
  // Les données sont conservées pour les obligations légales d'archivage.
  tx(() => {
    run('UPDATE users SET active = 0, accountant_id = NULL WHERE id = ?', c.id);
    run('DELETE FROM sessions WHERE user_id = ?', c.id);
    const collabIds = all('SELECT c.user_id FROM collaborators c JOIN establishments e ON e.id = c.establishment_id WHERE e.owner_id = ?', c.id);
    for (const x of collabIds) {
      run('UPDATE users SET active = 0 WHERE id = ?', x.user_id);
      run('DELETE FROM sessions WHERE user_id = ?', x.user_id);
    }
  });
  res.json({ ok: true });
});

router.get('/clients/:id', (req, res) => {
  const c = client(req);
  const { from, to } = periodFromQuery(req.query, 30);
  res.json({
    client: publicUser(c),
    all_establishments: all('SELECT id, name FROM establishments WHERE owner_id = ? ORDER BY id', c.id),
    ...accountingData(establishmentsFor(c, req.query), from, to),
  });
});

router.get('/clients/:id/export', async (req, res) => {
  const c = client(req);
  const { from, to } = periodFromQuery(req.query, 30);
  const data = accountingData(establishmentsFor(c, req.query), from, to);
  await accountingExport(res, c, data, req.query.format === 'xlsx' ? 'xlsx' : 'pdf');
});

export default router;
