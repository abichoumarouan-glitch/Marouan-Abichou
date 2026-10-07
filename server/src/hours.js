import { all, get } from './db.js';
import { diffMinutes, nowLocal, shiftMinutes, addDays } from './time.js';

export const EVENT_LABELS = {
  arrivee: 'Arrivée',
  debut_pause: 'Début de pause',
  fin_pause: 'Fin de pause',
  depart: 'Départ',
};

/**
 * Regroupe les pointages en journées de travail (une journée commence à l'arrivée,
 * même si le départ a lieu après minuit). Retourne { date: { minutes, pause, events, open, incomplete } }.
 */
export function workedByDay(events, now = nowLocal()) {
  const days = {};
  let cur = null;
  const close = (endAt, incomplete) => {
    if (!cur) return;
    if (cur.pauseStart) {
      cur.pause += Math.max(0, diffMinutes(cur.pauseStart, endAt));
      cur.pauseStart = null;
    }
    const total = Math.max(0, diffMinutes(cur.start, endAt));
    const d = (days[cur.date] ||= { minutes: 0, pause: 0, events: [], open: false, incomplete: false });
    d.minutes += Math.max(0, total - cur.pause);
    d.pause += cur.pause;
    d.events.push(...cur.events);
    if (incomplete === 'open') d.open = true;
    else if (incomplete) d.incomplete = true;
    cur = null;
  };
  for (const e of [...events].sort((a, b) => a.at.localeCompare(b.at))) {
    if (e.type === 'arrivee') {
      if (cur) close(cur.last, true);
      cur = { date: e.at.slice(0, 10), start: e.at, pause: 0, pauseStart: null, events: [e], last: e.at };
      continue;
    }
    if (!cur) {
      // pointage orphelin (sans arrivée) : on le rattache à sa date pour affichage
      const d = (days[e.at.slice(0, 10)] ||= { minutes: 0, pause: 0, events: [], open: false, incomplete: true });
      d.events.push(e);
      d.incomplete = true;
      continue;
    }
    cur.events.push(e);
    cur.last = e.at;
    if (e.type === 'debut_pause' && !cur.pauseStart) cur.pauseStart = e.at;
    else if (e.type === 'fin_pause' && cur.pauseStart) {
      cur.pause += Math.max(0, diffMinutes(cur.pauseStart, e.at));
      cur.pauseStart = null;
    } else if (e.type === 'depart') close(e.at, false);
  }
  if (cur) {
    // journée en cours : comptée jusqu'à maintenant si elle a commencé il y a moins de 20 h
    if (diffMinutes(cur.start, now) < 20 * 60) close(now, 'open');
    else close(cur.last, true);
  }
  return days;
}

export function collaboratorEvents(collabId, from, to) {
  return all(
    'SELECT * FROM clock_events WHERE collaborator_id = ? AND at >= ? AND at < ? ORDER BY at',
    collabId, `${addDays(from, -1)}T00:00:00`, `${addDays(to, 1)}T12:00:00`,
  );
}

/** Synthèse prévu / pointé / validé par jour pour un collaborateur, de from à to inclus. */
export function hoursSummary(collabId, from, to) {
  const shifts = all('SELECT * FROM shifts WHERE collaborator_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time', collabId, from, to);
  const worked = workedByDay(collaboratorEvents(collabId, from, to));
  const validations = Object.fromEntries(
    all('SELECT * FROM hours_validations WHERE collaborator_id = ? AND date BETWEEN ? AND ?', collabId, from, to).map((v) => [v.date, v]),
  );
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const dayShifts = shifts.filter((s) => s.date === d);
    const w = worked[d];
    days.push({
      date: d,
      shifts: dayShifts,
      planned_minutes: dayShifts.reduce((s, x) => s + shiftMinutes(x), 0),
      worked_minutes: w?.minutes ?? 0,
      pause_minutes: w?.pause ?? 0,
      events: w?.events ?? [],
      open: w?.open ?? false,
      incomplete: w?.incomplete ?? false,
      validated: validations[d] || null,
    });
  }
  const sum = (k) => days.reduce((s, x) => s + x[k], 0);
  return {
    days,
    planned_minutes: sum('planned_minutes'),
    worked_minutes: sum('worked_minutes'),
    validated_minutes: days.reduce((s, x) => s + (x.validated?.validated_minutes ?? 0), 0),
  };
}

/** Statut en direct d'un collaborateur. */
export function liveStatus(collabId, now = nowLocal()) {
  const last = get(
    'SELECT * FROM clock_events WHERE collaborator_id = ? AND at <= ? ORDER BY at DESC LIMIT 1',
    collabId, now,
  );
  if (!last || diffMinutes(last.at, now) > 20 * 60) return { status: 'absent', since: null, last: null };
  const map = { arrivee: 'present', fin_pause: 'present', debut_pause: 'pause', depart: 'parti' };
  return { status: map[last.type], since: last.at, last };
}

export function nextActions(status) {
  switch (status) {
    case 'present': return ['debut_pause', 'depart'];
    case 'pause': return ['fin_pause'];
    default: return ['arrivee'];
  }
}
