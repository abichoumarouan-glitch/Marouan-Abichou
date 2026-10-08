import express from 'express';
import { all, get, run, insert, tx } from '../db.js';
import { fail, createUser, generatePassword, hashPassword } from '../auth.js';
import { nowLocal, today, addDays, mondayOf, isDate, isDateTime, normDateTime } from '../time.js';
import { num, str } from '../util.js';
import { hoursSummary, liveStatus, workedByDay, collaboratorEvents, EVENT_LABELS } from '../hours.js';
import { emit, notify } from '../realtime.js';

const router = express.Router({ mergeParams: true });
const COLORS = ['#3b82a0', '#7c6fb0', '#c0785a', '#5a9e7c', '#b0627c', '#8a8f3c', '#4f7cc0', '#a0703b'];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function collaborators(estId, includeInactive = false) {
  return all(
    `SELECT c.*, u.first_name, u.last_name, u.email, u.phone, u.active AS user_active FROM collaborators c
     JOIN users u ON u.id = c.user_id WHERE c.establishment_id = ? ${includeInactive ? '' : 'AND c.active = 1'}
     ORDER BY c.active DESC, u.first_name, u.last_name`,
    estId,
  );
}
function ownCollab(estId, id) {
  const c = get('SELECT c.*, u.first_name, u.last_name FROM collaborators c JOIN users u ON u.id = c.user_id WHERE c.id = ? AND c.establishment_id = ?', id, estId);
  if (!c) fail(404, 'Collaborateur introuvable.');
  return c;
}

// ---- Équipe : comptes collaborateurs ----
router.get('/team', (req, res) => {
  res.json({ collaborators: collaborators(req.est.id, true).map((c) => ({ ...c, live: liveStatus(c.id) })) });
});

router.post('/team', (req, res) => {
  const b = req.body || {};
  const password = b.password || generatePassword();
  const result = tx(() => {
    const userId = createUser({
      email: b.email, password, first_name: b.first_name, last_name: b.last_name || '',
      phone: str(b.phone), role: 'collaborateur', owner_id: req.user.id,
    });
    const count = get('SELECT COUNT(*) AS n FROM collaborators WHERE establishment_id = ?', req.est.id).n;
    return insert('INSERT INTO collaborators (user_id, establishment_id, job_title, weekly_hours, color) VALUES (?, ?, ?, ?, ?)',
      userId, req.est.id, str(b.job_title), num(b.weekly_hours), COLORS[count % COLORS.length]);
  });
  res.status(201).json({ collaborator: ownCollab(req.est.id, result), password });
});

router.put('/team/:id', (req, res) => {
  const c = ownCollab(req.est.id, Number(req.params.id));
  const b = req.body || {};
  tx(() => {
    run('UPDATE collaborators SET job_title = ?, weekly_hours = ?, active = ? WHERE id = ?',
      'job_title' in b ? str(b.job_title) : c.job_title,
      'weekly_hours' in b ? num(b.weekly_hours) : c.weekly_hours,
      'active' in b ? (b.active ? 1 : 0) : c.active, c.id);
    if ('active' in b) {
      run('UPDATE users SET active = ? WHERE id = ?', b.active ? 1 : 0, c.user_id);
      if (!b.active) run('DELETE FROM sessions WHERE user_id = ?', c.user_id);
    }
  });
  res.json({ collaborator: ownCollab(req.est.id, c.id) });
});

router.post('/team/:id/reset-password', (req, res) => {
  const c = ownCollab(req.est.id, Number(req.params.id));
  const password = generatePassword();
  run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), c.user_id);
  run('DELETE FROM sessions WHERE user_id = ?', c.user_id);
  res.json({ password });
});

// ---- Planning de la semaine ----
const pending = new Map(); // collaborateur -> timer, pour regrouper les notifications
function notifyPlanningChange(collabId, date) {
  const c = get('SELECT c.*, e.name AS est_name FROM collaborators c JOIN establishments e ON e.id = c.establishment_id WHERE c.id = ?', collabId);
  if (!c) return;
  emit(c.user_id, 'planning', { date });
  const prev = pending.get(collabId);
  if (prev) clearTimeout(prev.timer);
  const dates = new Set([...(prev?.dates || []), date]);
  const timer = setTimeout(() => {
    pending.delete(collabId);
    const list = [...dates].sort().map((d) => d.split('-').reverse().slice(0, 2).join('/')).join(', ');
    notify({
      userId: c.user_id, establishmentId: c.establishment_id, type: 'planning', severity: 'info',
      title: 'Votre planning a été modifié',
      body: `${c.est_name} · jour(s) concerné(s) : ${list}`,
      link: '/collaborateur/planning',
    });
  }, 4000);
  pending.set(collabId, { timer, dates });
}

router.get('/planning', (req, res) => {
  const week = mondayOf(isDate(req.query.week) ? req.query.week : today());
  const end = addDays(week, 6);
  const collabs = collaborators(req.est.id);
  res.json({
    week, end,
    days: Array.from({ length: 7 }, (_, i) => addDays(week, i)),
    collaborators: collabs.map((c) => ({ ...c, summary: hoursSummary(c.id, week, end) })),
    shifts: all('SELECT * FROM shifts WHERE establishment_id = ? AND date BETWEEN ? AND ? ORDER BY start_time', req.est.id, week, end),
  });
});

function shiftFields(b, cur = {}) {
  const date = 'date' in b ? b.date : cur.date;
  const start = 'start_time' in b ? b.start_time : cur.start_time;
  const end = 'end_time' in b ? b.end_time : cur.end_time;
  if (!isDate(date)) fail(400, 'Date invalide.');
  if (!TIME.test(start || '') || !TIME.test(end || '')) fail(400, 'Heures invalides (format HH:MM).');
  if (start === end) fail(400, "L'heure de fin doit différer de l'heure de début.");
  const brk = 'break_minutes' in b ? Math.max(0, Math.round(num(b.break_minutes) || 0)) : cur.break_minutes || 0;
  return { date, start, end, brk, note: 'note' in b ? str(b.note) : cur.note };
}

router.post('/shifts', (req, res) => {
  const c = ownCollab(req.est.id, Number(req.body?.collaborator_id));
  const f = shiftFields(req.body || {});
  const id = insert(
    'INSERT INTO shifts (establishment_id, collaborator_id, date, start_time, end_time, break_minutes, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    req.est.id, c.id, f.date, f.start, f.end, f.brk, f.note, nowLocal(), nowLocal(),
  );
  notifyPlanningChange(c.id, f.date);
  res.status(201).json({ shift: get('SELECT * FROM shifts WHERE id = ?', id) });
});

router.put('/shifts/:id', (req, res) => {
  const cur = get('SELECT * FROM shifts WHERE id = ? AND establishment_id = ?', Number(req.params.id), req.est.id);
  if (!cur) fail(404, 'Créneau introuvable.');
  const f = shiftFields(req.body || {}, cur);
  const collabId = req.body?.collaborator_id ? ownCollab(req.est.id, Number(req.body.collaborator_id)).id : cur.collaborator_id;
  run('UPDATE shifts SET collaborator_id = ?, date = ?, start_time = ?, end_time = ?, break_minutes = ?, note = ?, updated_at = ? WHERE id = ?',
    collabId, f.date, f.start, f.end, f.brk, f.note, nowLocal(), cur.id);
  notifyPlanningChange(collabId, f.date);
  if (collabId !== cur.collaborator_id || f.date !== cur.date) notifyPlanningChange(cur.collaborator_id, cur.date);
  res.json({ shift: get('SELECT * FROM shifts WHERE id = ?', cur.id) });
});

router.delete('/shifts/:id', (req, res) => {
  const cur = get('SELECT * FROM shifts WHERE id = ? AND establishment_id = ?', Number(req.params.id), req.est.id);
  if (!cur) fail(404, 'Créneau introuvable.');
  run('DELETE FROM shifts WHERE id = ?', cur.id);
  notifyPlanningChange(cur.collaborator_id, cur.date);
  res.json({ ok: true });
});

router.post('/planning/copy-previous', (req, res) => {
  const week = mondayOf(isDate(req.body?.week) ? req.body.week : today());
  const prevShifts = all('SELECT s.* FROM shifts s JOIN collaborators c ON c.id = s.collaborator_id WHERE s.establishment_id = ? AND c.active = 1 AND s.date BETWEEN ? AND ?',
    req.est.id, addDays(week, -7), addDays(week, -1));
  if (!prevShifts.length) fail(400, 'La semaine précédente est vide.');
  const existing = get('SELECT COUNT(*) AS n FROM shifts WHERE establishment_id = ? AND date BETWEEN ? AND ?', req.est.id, week, addDays(week, 6)).n;
  if (existing && !req.body?.force) fail(409, 'La semaine contient déjà des créneaux.');
  tx(() => {
    for (const s of prevShifts) {
      insert('INSERT INTO shifts (establishment_id, collaborator_id, date, start_time, end_time, break_minutes, note, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        req.est.id, s.collaborator_id, addDays(s.date, 7), s.start_time, s.end_time, s.break_minutes, s.note, nowLocal(), nowLocal());
    }
  });
  for (const s of prevShifts) notifyPlanningChange(s.collaborator_id, addDays(s.date, 7));
  res.json({ copied: prevShifts.length });
});

// ---- En direct : qui a pointé ----
router.get('/live', (req, res) => {
  const t = today();
  const list = collaborators(req.est.id).map((c) => {
    const ev = workedByDay(collaboratorEvents(c.id, t, t))[t];
    return {
      id: c.id, first_name: c.first_name, last_name: c.last_name, job_title: c.job_title, color: c.color,
      live: liveStatus(c.id),
      shifts: all('SELECT * FROM shifts WHERE collaborator_id = ? AND date = ? ORDER BY start_time', c.id, t),
      events: ev?.events || [],
      worked_minutes: ev?.minutes || 0,
    };
  });
  res.json({ date: t, collaborators: list, labels: EVENT_LABELS });
});

// ---- Validation des heures ----
router.post('/hours/validate', (req, res) => {
  const c = ownCollab(req.est.id, Number(req.body?.collaborator_id));
  const dates = (Array.isArray(req.body?.dates) ? req.body.dates : []).filter(isDate);
  if (!dates.length) fail(400, 'Aucune journée à valider.');
  const sorted = [...dates].sort();
  const summary = hoursSummary(c.id, sorted[0], sorted[sorted.length - 1]);
  const override = num(req.body?.minutes);
  let count = 0;
  tx(() => {
    for (const d of summary.days) {
      if (!dates.includes(d.date)) continue;
      if (d.open) continue; // journée en cours : pas encore validable
      const minutes = dates.length === 1 && override != null ? override : d.worked_minutes;
      run(
        `INSERT INTO hours_validations (collaborator_id, date, validated_minutes, validated_by, validated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(collaborator_id, date) DO UPDATE SET validated_minutes = excluded.validated_minutes, validated_by = excluded.validated_by, validated_at = excluded.validated_at`,
        c.id, d.date, minutes, req.user.id, nowLocal(),
      );
      count++;
    }
  });
  emit(get('SELECT user_id FROM collaborators WHERE id = ?', c.id).user_id, 'heures', {});
  res.json({ validated: count });
});

router.delete('/hours/validate', (req, res) => {
  const c = ownCollab(req.est.id, Number(req.body?.collaborator_id));
  if (!isDate(req.body?.date)) fail(400, 'Date invalide.');
  run('DELETE FROM hours_validations WHERE collaborator_id = ? AND date = ?', c.id, req.body.date);
  res.json({ ok: true });
});

// ---- Demandes de correction de pointage ----
router.get('/corrections', (req, res) => {
  const status = ['en_attente', 'acceptee', 'refusee'].includes(req.query.status) ? req.query.status : null;
  res.json({
    corrections: all(
      `SELECT r.*, u.first_name, u.last_name, e.type AS original_type, e.at AS original_at
       FROM correction_requests r JOIN collaborators c ON c.id = r.collaborator_id JOIN users u ON u.id = c.user_id
       LEFT JOIN clock_events e ON e.id = r.clock_event_id
       WHERE r.establishment_id = ? ${status ? 'AND r.status = ?' : ''} ORDER BY r.status = 'en_attente' DESC, r.created_at DESC LIMIT 200`,
      ...(status ? [req.est.id, status] : [req.est.id]),
    ),
    labels: EVENT_LABELS,
  });
});

router.post('/corrections/:id/decide', (req, res) => {
  const r = get('SELECT * FROM correction_requests WHERE id = ? AND establishment_id = ?', Number(req.params.id), req.est.id);
  if (!r) fail(404, 'Demande introuvable.');
  if (r.status !== 'en_attente') fail(409, 'Cette demande a déjà été traitée.');
  const decision = req.body?.decision === 'acceptee' ? 'acceptee' : req.body?.decision === 'refusee' ? 'refusee' : fail(400, 'Décision invalide.');
  const originalDay = r.clock_event_id ? get('SELECT at FROM clock_events WHERE id = ?', r.clock_event_id)?.at?.slice(0, 10) : null;
  tx(() => {
    if (decision === 'acceptee') {
      if (r.action === 'ajouter') {
        if (!isDateTime(r.requested_at) || !EVENT_LABELS[r.event_type]) fail(400, 'Demande incomplète.');
        insert('INSERT INTO clock_events (collaborator_id, establishment_id, type, at, correction_id, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          r.collaborator_id, r.establishment_id, r.event_type, normDateTime(r.requested_at), r.id, nowLocal());
      } else if (r.action === 'modifier') {
        const e = get('SELECT * FROM clock_events WHERE id = ? AND collaborator_id = ?', r.clock_event_id, r.collaborator_id);
        if (!e) fail(404, 'Pointage introuvable.');
        run('UPDATE clock_events SET at = ?, type = ?, original_at = COALESCE(original_at, ?), correction_id = ? WHERE id = ?',
          normDateTime(r.requested_at), EVENT_LABELS[r.event_type] ? r.event_type : e.type, e.at, r.id, e.id);
      } else if (r.action === 'supprimer') {
        run('DELETE FROM clock_events WHERE id = ? AND collaborator_id = ?', r.clock_event_id, r.collaborator_id);
      }
      // une journée déjà validée doit être revalidée après correction
      for (const day of new Set([originalDay, r.requested_at?.slice(0, 10)].filter(Boolean))) {
        run('DELETE FROM hours_validations WHERE collaborator_id = ? AND date = ?', r.collaborator_id, day);
      }
    }
    run('UPDATE correction_requests SET status = ?, decided_by = ?, decided_at = ?, decision_comment = ? WHERE id = ?',
      decision, req.user.id, nowLocal(), str(req.body?.comment), r.id);
  });
  const c = get('SELECT user_id FROM collaborators WHERE id = ?', r.collaborator_id);
  notify({
    userId: c.user_id, establishmentId: r.establishment_id, type: 'correction',
    severity: decision === 'acceptee' ? 'success' : 'warning',
    title: decision === 'acceptee' ? 'Correction de pointage acceptée' : 'Correction de pointage refusée',
    body: str(req.body?.comment) || '',
    link: '/collaborateur/heures',
  });
  res.json({ ok: true });
});

export default router;
