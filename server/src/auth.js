import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { get, run, insert } from './db.js';
import { nowLocal } from './time.js';

const SESSION_DAYS = 30;
export const COOKIE = 'mizu_session';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
export function generatePassword() {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(10);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export function createUser({ email, password, first_name, last_name = '', role, company = null, phone = null, accountant_id = null, owner_id = null }) {
  email = String(email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'Adresse email invalide.');
  if (!first_name?.trim()) fail(400, 'Le prénom est obligatoire.');
  if (!password || password.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères.');
  if (get('SELECT id FROM users WHERE email = ?', email)) fail(409, 'Un compte existe déjà avec cette adresse email.');
  return insert(
    `INSERT INTO users (email, password_hash, first_name, last_name, role, company, phone, accountant_id, owner_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    email, hashPassword(password), first_name.trim(), last_name.trim(), role, company, phone, accountant_id, owner_id, nowLocal(),
  );
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function randomCode() {
  return Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** Code d'invitation de l'établissement (créé à la première demande). */
export function joinCodeFor(estId, regenerate = false) {
  const est = get('SELECT join_code FROM establishments WHERE id = ?', estId);
  if (!est) return null;
  if (est.join_code && !regenerate) return est.join_code;
  for (;;) {
    const code = randomCode();
    if (!get('SELECT id FROM establishments WHERE join_code = ?', code)) {
      run('UPDATE establishments SET join_code = ? WHERE id = ?', code, estId);
      return code;
    }
  }
}

export function normalizeJoinCode(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function openSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000).toISOString();
  run('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', token, userId, new Date().toISOString(), expires);
  return token;
}

export function login(email, password) {
  const user = get('SELECT * FROM users WHERE email = ?', String(email || '').trim().toLowerCase());
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    fail(401, 'Email ou mot de passe incorrect.');
  }
  if (!user.active) fail(403, 'Ce compte a été désactivé.');
  return { token: openSession(user.id), user };
}

export function logout(token) {
  if (token) run('DELETE FROM sessions WHERE token = ?', token);
}

export function userFromToken(token) {
  if (!token) return null;
  const row = get(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
    token, new Date().toISOString(),
  );
  return row || null;
}

export function publicUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

export function authenticate(req, _res, next) {
  req.user = userFromToken(req.cookies?.[COOKIE]);
  next();
}

export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Veuillez vous connecter.'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Accès réservé.'));
    next();
  };
}
