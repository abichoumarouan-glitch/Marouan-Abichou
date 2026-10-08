import express from 'express';
import { all, get, insert } from '../db.js';
import { fail } from '../auth.js';
import { nowLocal, today, addDays, mondayOf, isDateTime, normDateTime, shiftMinutes } from '../time.js';
import { str } from '../util.js';
import { hoursSummary, liveStatus, nextActions, EVENT_LABELS } from '../hours.js';
import { emitEstablishment, notifyOwner } from '../realtime.js';

const router = express.Router();

router.use((req, _res, next) => {
  const c = get(
    `SELECT c.*, e.name AS establishment_name, e.address AS establishment_address FROM collaborators c
     JOIN establishments e ON e.id = c.establishment_id WHERE c.user_id = ? AND c.active = 1`,
    req.user.id,
  );
  if (!c) return next(Object.assign(new Error('Aucun établissement associé à ce compte.'), { status: 403 }));
  req.collab = c;
  next();
});

router.get('/me', (req, res) => {
  const live = liveStatus(req.collab.id);
  const t = today();
  res.json({
    collaborator: req.collab,
    live,
    next_actions: nextActions(live.status),
    labels: EVENT_LABELS,
    today: t,
    today_shifts: all('SELECT * FROM shifts WHERE collaborator_id = ? AND date = ? ORDER BY start_time', req.collab.id, t),
    today_events: all('SELECT * FROM clock_events WHERE collaborator_id = ? AND at >= ? ORDER BY at', req.collab.id, `${t}T00:00:00`),
    now: nowLocal(),
  });
});

router.post('/clock', (req, res) => {
  const type = req.body?.type;
  const live = liveStatus(req.collab.id);
  if (!nextActions(live.status).includes(type)) fail(409, 'Ce pointage ne correspond pas à votre situation actuelle.');
  // l'heure est toujours celle du serveur : le collaborateur ne peut pas la choisir
  const at = nowLocal();
  const id = insert('INSERT INTO clock_events (collaborator_id, establishment_id, type, at, created_at) VALUES (?, ?, ?, ?, ?)',
    req.collab.id, req.collab.establishment_id, type, at, at);
  emitEstablishment(req.collab.establishment_id, 'pointage', { collaborator_id: req.collab.id, type, at });
  res.status(201).json({ event: get('SELECT * FROM clock_events WHERE id = ?', id) });
});

router.get('/planning', (req, res) => {
  const week = mondayOf(today());
  const weeks = [week, addDays(week, 7)].map((start) => {
    const end = addDays(start, 6);
    const shifts = all('SELECT * FROM shifts WHERE collaborator_id = ? AND date BETWEEN ? AND ? ORDER BY date, start_time', req.collab.id, start, end);
    return {
      start, end,
      days: Array.from({ length: 7 }, (_, i) => {
        const d = addDays(start, i);
        return { date: d, shifts: shifts.filter((s) => s.date === d) };
      }),
      planned_minutes: shifts.reduce((s, x) => s + shiftMinutes(x), 0),
    };
  });
  res.json({ weeks, today: today(), updated_at: get('SELECT MAX(updated_at) AS u FROM shifts WHERE collaborator_id = ?', req.collab.id)?.u });
});

router.get('/hours', (req, res) => {
  const t = today();
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : t.slice(0, 7);
  const monthStart = `${month}-01`;
  const nextMonth = addDays(`${month}-28`, 4).slice(0, 7);
  const monthEnd = addDays(`${nextMonth}-01`, -1);
  const week = mondayOf(t);
  res.json({
    month,
    week: withPlannedToDate(hoursSummary(req.collab.id, week, addDays(week, 6)), t),
    month_summary: hoursSummary(req.collab.id, monthStart, monthEnd < t ? monthEnd : t),
    corrections: all(
      `SELECT r.*, e.at AS original_at, e.type AS original_type FROM correction_requests r
       LEFT JOIN clock_events e ON e.id = r.clock_event_id WHERE r.collaborator_id = ? ORDER BY r.created_at DESC LIMIT 50`,
      req.collab.id,
    ),
    labels: EVENT_LABELS,
    today: t,
  });
});

function withPlannedToDate(summary, t) {
  return { ...summary, planned_to_date: summary.days.filter((d) => d.date <= t).reduce((s, d) => s + d.planned_minutes, 0) };
}

router.post('/corrections', (req, res) => {
  const b = req.body || {};
  const action = ['modifier', 'ajouter', 'supprimer'].includes(b.action) ? b.action : fail(400, 'Type de demande invalide.');
  const reason = str(b.reason);
  if (!reason) fail(400, 'Expliquez la raison de la demande.');
  let event = null;
  if (action !== 'ajouter') {
    event = get('SELECT * FROM clock_events WHERE id = ? AND collaborator_id = ?', Number(b.clock_event_id), req.collab.id);
    if (!event) fail(404, 'Pointage introuvable.');
  }
  let requestedAt = null;
  if (action !== 'supprimer') {
    if (!isDateTime(b.requested_at)) fail(400, "Indiquez la date et l'heure correctes.");
    requestedAt = normDateTime(b.requested_at);
    if (requestedAt > nowLocal()) fail(400, "L'heure demandée ne peut pas être dans le futur.");
  }
  const type = action === 'ajouter' ? (EVENT_LABELS[b.event_type] ? b.event_type : fail(400, 'Type de pointage invalide.')) : event.type;
  if (get("SELECT id FROM correction_requests WHERE collaborator_id = ? AND clock_event_id IS ? AND action = ? AND status = 'en_attente'", req.collab.id, event?.id ?? null, action) && event) {
    fail(409, 'Une demande est déjà en attente pour ce pointage.');
  }
  const id = insert(
    `INSERT INTO correction_requests (collaborator_id, establishment_id, clock_event_id, action, event_type, requested_at, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    req.collab.id, req.collab.establishment_id, event?.id ?? null, action, type, requestedAt, reason, nowLocal(),
  );
  const name = `${req.user.first_name} ${req.user.last_name}`.trim();
  notifyOwner(req.collab.establishment_id, {
    type: 'correction', severity: 'info',
    title: `Demande de correction de ${name}`,
    body: reason.slice(0, 140),
    link: '/restaurateur/equipe/corrections',
  });
  res.status(201).json({ correction: get('SELECT * FROM correction_requests WHERE id = ?', id) });
});

export default router;
