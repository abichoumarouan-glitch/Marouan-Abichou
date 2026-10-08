// Toutes les dates/heures métier sont stockées en heure locale du restaurant
// (fuseau MIZU_TZ, Europe/Paris par défaut) au format 'YYYY-MM-DDTHH:MM:SS'.
export const TZ = process.env.MIZU_TZ || 'Europe/Paris';

const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function nowLocal(date = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}
export const today = () => nowLocal().slice(0, 10);

// Arithmétique de dates sur des chaînes locales (UTC utilisé comme support neutre).
export function parseLocal(s) {
  const [d, t = '00:00:00'] = s.split('T');
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi, se = 0] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, day, h, mi, se);
}
export function toLocal(ms) {
  return new Date(ms).toISOString().slice(0, 19);
}
export function addDays(dateStr, n) {
  return toLocal(parseLocal(dateStr.slice(0, 10)) + n * 86400000).slice(0, 10);
}
export function diffMinutes(a, b) {
  return (parseLocal(b) - parseLocal(a)) / 60000;
}
export function mondayOf(dateStr) {
  const d = new Date(parseLocal(dateStr.slice(0, 10)));
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(dateStr, -dow);
}
export function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
export function isDateTime(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s);
}
export function normDateTime(s) {
  return s.length === 16 ? `${s}:00` : s;
}
export function shiftMinutes(s) {
  const [sh, sm] = s.start_time.split(':').map(Number);
  const [eh, em] = s.end_time.split(':').map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 1440; // créneau qui passe minuit
  return Math.max(0, m - (s.break_minutes || 0));
}
