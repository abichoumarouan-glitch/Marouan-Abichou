// Arrondi au centime uniquement à l'affichage : les calculs gardent la précision complète.
const eurFmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
const eur0Fmt = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

export const eur = (n) => (n == null || Number.isNaN(n) ? '—' : eurFmt.format(n));
export const eur0 = (n) => (n == null || Number.isNaN(n) ? '—' : eur0Fmt.format(n));
export const num = (n, digits = 2) => (n == null ? '—' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: digits }).format(n));
export const pct = (n, digits = 1) => (n == null || Number.isNaN(n) ? '—' : `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n)} %`);
export const qty = (n) => (n == null ? '—' : numFmt.format(n));

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const DAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const parts = (s) => s.slice(0, 10).split('-').map(Number);
const dow = (s) => { const [y, m, d] = parts(s); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };

export const date = (s) => (s ? s.slice(0, 10).split('-').reverse().join('/') : '—');
export const dateShort = (s) => { if (!s) return '—'; const [, m, d] = parts(s); return `${d} ${MONTHS[m - 1]}`; };
export const dateLong = (s) => { if (!s) return '—'; const [y, m, d] = parts(s); return `${DAYS_LONG[dow(s)]} ${d} ${MONTHS_LONG[m - 1]} ${y}`; };
export const dayName = (s) => DAYS[dow(s)];
export const dayNameLong = (s) => DAYS_LONG[dow(s)];
export const monthLabel = (ym) => { const [y, m] = ym.split('-').map(Number); return `${MONTHS_LONG[m - 1]} ${y}`; };
export const time = (s) => (s ? s.slice(11, 16).replace(':', 'h') : '—');
export const hhmm = (t) => (t ? t.slice(0, 5).replace(':', 'h') : '');
export const dateTime = (s) => (s ? `${date(s)} à ${time(s)}` : '—');

export const minutes = (m) => {
  if (m == null) return '—';
  const sign = m < 0 ? '−' : '';
  const a = Math.round(Math.abs(m));
  return `${sign}${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}`;
};

// Dates locales (navigateur) au format AAAA-MM-JJ
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const todayIso = () => iso(new Date());
export const addDays = (s, n) => { const [y, m, d] = parts(s); return iso(new Date(y, m - 1, d + n)); };
export const mondayOf = (s) => addDays(s, -((dow(s) + 6) % 7));
export const nowLocalInput = () => { const d = new Date(); d.setSeconds(0, 0); return `${iso(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export const UNIT_LABELS = { kg: 'kilo', l: 'litre', piece: 'pièce', carton: 'carton' };
export const UNIT_SHORT = { kg: 'kg', l: 'L', piece: 'pc', carton: 'crt' };
export const BASE_LABELS = { g: 'g', ml: 'ml', piece: 'pièce(s)' };

/** Quantité d'un ingrédient en unité de base, affichée lisiblement (g → kg, ml → L). */
export const baseQty = (v, unit) => {
  if (v == null) return '—';
  if (unit === 'g') return v >= 1000 ? `${num(v / 1000)} kg` : `${num(v, 0)} g`;
  if (unit === 'ml') return v >= 1000 ? `${num(v / 1000)} L` : `${num(v, 0)} ml`;
  return `${num(v, 1)} pc`;
};
/** Prix par unité « lisible » : €/kg, €/L ou €/pièce à partir du coût par g/ml/pièce. */
export const pricePerUnit = (costBase, unit) => {
  if (costBase == null) return '—';
  if (unit === 'g') return `${eur(costBase * 1000)} / kg`;
  if (unit === 'ml') return `${eur(costBase * 1000)} / L`;
  return `${eur(costBase)} / pièce`;
};
