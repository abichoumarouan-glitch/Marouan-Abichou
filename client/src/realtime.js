import { useEffect, useRef } from 'react';
import { api } from './api.js';

// Une seule connexion temps réel (SSE) partagée par toute l'application.
let source = null;
const listeners = new Map(); // event -> Set<fn>

function ensureSource() {
  if (source) return;
  source = new EventSource('/api/stream');
  for (const ev of listeners.keys()) attach(ev);
}
function attach(ev) {
  source?.addEventListener(ev, (e) => {
    let data = {};
    try { data = JSON.parse(e.data); } catch { /* ignore */ }
    for (const fn of listeners.get(ev) || []) fn(data);
  });
}

export function closeRealtime() {
  source?.close();
  source = null;
}

/** Abonnement à un événement temps réel : 'alerte', 'planning', 'pointage', 'refresh', 'message', 'heures'. */
export function useRealtime(event, handler) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    const fn = (d) => ref.current(d);
    if (!listeners.has(event)) {
      listeners.set(event, new Set());
      if (source) attach(event);
    }
    listeners.get(event).add(fn);
    ensureSource();
    return () => listeners.get(event)?.delete(fn);
  }, [event]);
}

// ---------- PWA : service worker et notifications push ----------
export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

const b64ToUint8 = (b64) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushPermission = () => (pushSupported() ? Notification.permission : 'unsupported');

/** Demande l'autorisation et abonne l'appareil aux notifications. */
export async function enablePush() {
  if (!pushSupported()) throw new Error("Les notifications ne sont pas prises en charge sur cet appareil. Sur iPhone, installez d'abord Mizu sur l'écran d'accueil.");
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notifications refusées dans les réglages du navigateur.');
  await syncPushSubscription();
}

export async function syncPushSubscription() {
  if (pushPermission() !== 'granted') return;
  const reg = await navigator.serviceWorker.ready;
  const { key } = await api.get('/api/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) });
  await api.post('/api/push/subscribe', sub.toJSON());
}
