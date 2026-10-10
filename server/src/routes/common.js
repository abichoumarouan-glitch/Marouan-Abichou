import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { all, get, run, tx, insert, getSetting, UPLOAD_DIR } from '../db.js';
import { COOKIE, login, logout, publicUser, requireRole, fail, hashPassword, createUser, openSession, normalizeJoinCode } from '../auth.js';
import { sseHandler, saveSubscription, vapidPublicKey, notifyOwner, emitEstablishment } from '../realtime.js';
import { aiAvailable } from '../ai.js';

const router = express.Router();
const anyUser = requireRole('restaurateur', 'comptable', 'collaborateur', 'support');

const setSessionCookie = (res, token) => res.cookie(COOKIE, token, {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 30 * 86400000,
});

router.post('/auth/login', (req, res) => {
  const { token, user } = login(req.body?.email, req.body?.password);
  setSessionCookie(res, token);
  res.json({ user: publicUser(user) });
});

// Configuration publique de l'écran de connexion (comptes de démonstration présents ?)
router.get('/auth/config', (_req, res) => {
  res.json({ demo: getSetting('demo') === '1' });
});

// Vérifie un code d'invitation avant l'inscription d'un collaborateur
router.get('/auth/join-code/:code', (req, res) => {
  const est = get('SELECT id, name FROM establishments WHERE join_code = ?', normalizeJoinCode(req.params.code));
  if (!est) fail(404, "Code d'invitation inconnu. Demandez-le à votre responsable.");
  res.json({ establishment: est });
});

/**
 * Inscription en libre-service :
 * - comptable : crée son cabinet, puis ajoute ses clients restaurateurs ;
 * - collaborateur : rejoint un établissement grâce au code d'invitation donné par le restaurateur.
 * Les comptes restaurateurs restent créés par le comptable.
 */
router.post('/auth/register', (req, res) => {
  const b = req.body || {};
  const str = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
  let userId;
  if (b.role === 'comptable') {
    const company = str(b.company);
    if (!company) fail(400, 'Le nom du cabinet est obligatoire.');
    userId = createUser({ email: b.email, password: b.password, first_name: b.first_name, last_name: b.last_name || '', company, phone: str(b.phone), role: 'comptable' });
  } else if (b.role === 'collaborateur') {
    const est = get('SELECT * FROM establishments WHERE join_code = ?', normalizeJoinCode(b.join_code));
    if (!est) fail(400, "Code d'invitation inconnu. Demandez-le à votre responsable.");
    userId = tx(() => {
      const uid = createUser({ email: b.email, password: b.password, first_name: b.first_name, last_name: b.last_name || '', phone: str(b.phone), role: 'collaborateur', owner_id: est.owner_id });
      const count = get('SELECT COUNT(*) AS n FROM collaborators WHERE establishment_id = ?', est.id).n;
      const colors = ['#3b82a0', '#7c6fb0', '#c0785a', '#5a9e7c', '#b0627c', '#8a8f3c', '#4f7cc0', '#a0703b'];
      insert('INSERT INTO collaborators (user_id, establishment_id, job_title, color) VALUES (?, ?, ?, ?)', uid, est.id, str(b.job_title), colors[count % colors.length]);
      return uid;
    });
    const name = `${str(b.first_name)} ${str(b.last_name) || ''}`.trim();
    notifyOwner(est.id, {
      type: 'equipe', severity: 'info',
      title: `${name} a rejoint votre équipe`,
      body: `Inscription avec le code d'invitation de ${est.name}.`,
      link: '/restaurateur/equipe/collaborateurs',
    });
    emitEstablishment(est.id, 'refresh', { scope: 'team' });
  } else {
    fail(400, 'Choisissez un type de compte.');
  }
  setSessionCookie(res, openSession(userId));
  res.status(201).json({ user: publicUser(get('SELECT * FROM users WHERE id = ?', userId)) });
});

router.post('/auth/logout', (req, res) => {
  logout(req.cookies?.[COOKIE]);
  res.clearCookie(COOKIE);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  res.json({ user: publicUser(req.user), ai: aiAvailable() });
});

router.post('/auth/password', anyUser, (req, res) => {
  const { current, next } = req.body || {};
  if (!bcrypt.compareSync(String(current || ''), req.user.password_hash)) fail(400, 'Mot de passe actuel incorrect.');
  if (!next || next.length < 8) fail(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères.');
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(next), req.user.id);
  res.json({ ok: true });
});

router.get('/stream', anyUser, sseHandler);

router.get('/push/key', anyUser, (_req, res) => res.json({ key: vapidPublicKey() }));
router.post('/push/subscribe', anyUser, (req, res) => {
  if (!saveSubscription(req.user.id, req.body)) fail(400, 'Abonnement invalide.');
  res.json({ ok: true });
});

// ---- Alertes / notifications de l'utilisateur connecté ----
router.get('/alerts', anyUser, (req, res) => {
  const estId = Number(req.query.establishment) || null;
  const rows = all(
    `SELECT * FROM alerts WHERE user_id = ? ${estId ? 'AND (establishment_id = ? OR establishment_id IS NULL)' : ''}
     ORDER BY created_at DESC, id DESC LIMIT 100`,
    ...(estId ? [req.user.id, estId] : [req.user.id]),
  );
  res.json({ alerts: rows, unread: rows.filter((a) => !a.read_at).length });
});
router.post('/alerts/read', anyUser, (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : null;
  if (ids?.length) {
    run(`UPDATE alerts SET read_at = datetime('now') WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, req.user.id, ...ids);
  } else {
    run("UPDATE alerts SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL", req.user.id);
  }
  res.json({ ok: true });
});

// ---- Photos (factures, étiquettes, notes de frais) avec contrôle d'accès ----
function canSeeFile(user, name) {
  const owners = [
    get('SELECT establishment_id FROM invoices WHERE photo_path = ?', name),
    get('SELECT establishment_id FROM dlc_items WHERE photo_path = ?', name),
    get('SELECT establishment_id FROM expense_reports WHERE photo_path = ?', name),
  ].filter(Boolean);
  if (!owners.length) return false;
  const est = get('SELECT e.*, u.accountant_id FROM establishments e JOIN users u ON u.id = e.owner_id WHERE e.id = ?', owners[0].establishment_id);
  if (!est) return false;
  if (user.role === 'restaurateur') return est.owner_id === user.id;
  if (user.role === 'comptable') return est.accountant_id === user.id;
  return false;
}

router.get('/files/:name', anyUser, (req, res) => {
  const name = path.basename(req.params.name);
  if (!canSeeFile(req.user, name)) fail(404, 'Fichier introuvable.');
  const file = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(file)) fail(404, 'Fichier introuvable.');
  res.set('Cache-Control', 'private, max-age=86400');
  res.sendFile(file);
});

export default router;
