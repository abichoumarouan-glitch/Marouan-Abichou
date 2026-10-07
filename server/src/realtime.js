import webpush from 'web-push';
import { all, run, get, getSetting, setSetting, insert } from './db.js';
import { nowLocal } from './time.js';

// ---- Temps réel (Server-Sent Events) ----
const clients = new Map(); // userId -> Set<res>

export function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const uid = req.user.id;
  if (!clients.has(uid)) clients.set(uid, new Set());
  clients.get(uid).add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.get(uid)?.delete(res);
  });
}

export function emit(userId, event, data = {}) {
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(payload);
}

export function emitEstablishment(estId, event, data = {}) {
  const est = get('SELECT owner_id FROM establishments WHERE id = ?', estId);
  if (est) emit(est.owner_id, event, { establishment_id: estId, ...data });
}

// ---- Notifications push (PWA) ----
let vapid = null;
export function initPush() {
  let pub = getSetting('vapid_public');
  let priv = getSetting('vapid_private');
  if (!pub || !priv) {
    const keys = webpush.generateVAPIDKeys();
    pub = keys.publicKey;
    priv = keys.privateKey;
    setSetting('vapid_public', pub);
    setSetting('vapid_private', priv);
  }
  webpush.setVapidDetails(process.env.MIZU_PUSH_CONTACT || 'mailto:contact@mizu.app', pub, priv);
  vapid = pub;
}
export const vapidPublicKey = () => vapid;

export function saveSubscription(userId, sub) {
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return false;
  run(
    `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`,
    userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, nowLocal(),
  );
  return true;
}

export async function sendPush(userId, payload) {
  if (!vapid) return;
  const subs = all('SELECT * FROM push_subscriptions WHERE user_id = ?', userId);
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600 },
      );
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) run('DELETE FROM push_subscriptions WHERE id = ?', s.id);
    }
  }));
}

// ---- Alertes : enregistrées, poussées en temps réel et en notification ----
export function notify({ userId, establishmentId = null, type, severity = 'info', title, body = '', link = null, dedupeKey = null }) {
  if (dedupeKey && get('SELECT id FROM alerts WHERE user_id = ? AND dedupe_key = ?', userId, dedupeKey)) return null;
  const id = insert(
    `INSERT INTO alerts (establishment_id, user_id, type, severity, title, body, link, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    establishmentId, userId, type, severity, title, body, link, dedupeKey, nowLocal(),
  );
  const alert = get('SELECT * FROM alerts WHERE id = ?', id);
  emit(userId, 'alerte', alert);
  sendPush(userId, { title, body, url: link || '/', tag: `${type}-${id}` }).catch(() => {});
  return alert;
}

export function notifyOwner(estId, alert) {
  const est = get('SELECT owner_id FROM establishments WHERE id = ?', estId);
  if (!est) return null;
  return notify({ ...alert, userId: est.owner_id, establishmentId: estId });
}
