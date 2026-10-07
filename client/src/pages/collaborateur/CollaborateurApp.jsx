import { useEffect, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../../AppShell.jsx';
import { api } from '../../api.js';
import { useAuth } from '../../auth.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Icon, Modal, Notice, Segmented, Spinner, useAction, useLoad, useToast } from '../../ui.jsx';
import { useRealtime } from '../../realtime.js';
import { date, dateLong, dateShort, dayName, hhmm, time, minutes, monthLabel, addDays, todayIso } from '../../format.js';

const LABELS = { arrivee: 'Arrivée', debut_pause: 'Début de pause', fin_pause: 'Fin de pause', depart: 'Départ' };
const ICONS = { arrivee: 'play', debut_pause: 'coffee', fin_pause: 'play', depart: 'door' };
const STATUS = { present: 'Vous êtes au travail', pause: 'Vous êtes en pause', parti: 'Journée terminée', absent: 'Pas encore pointé aujourd’hui' };

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  return now;
}

// ---------------- Pointer ----------------
function Pointer() {
  const { user } = useAuth();
  const toast = useToast();
  const now = useClock();
  const { data, error, loading, reload } = useLoad(() => api.get('/api/c/me'));
  const [run, busy] = useAction();
  useRealtime('planning', () => reload(true));

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const actions = data.next_actions;
  // quand on est au travail : « départ » devient l'action principale à l'approche de la fin prévue
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const lastEnd = data.today_shifts.length ? data.today_shifts[data.today_shifts.length - 1].end_time : null;
  const nearEnd = lastEnd && lastEnd > '04:00' && hm >= addMinutes(lastEnd, -30);
  const primary = actions.length > 1 && nearEnd ? 'depart' : actions[0];
  const secondary = actions.filter((a) => a !== primary);

  const clock = (type) => run(async () => {
    const { event } = await api.post('/api/c/clock', { type });
    navigator.vibrate?.(60);
    toast({ title: `${LABELS[type]} enregistrée`, message: `à ${time(event.at)}` });
    await reload(true);
  });

  return (
    <div className="stack">
      <div>
        <h1>Bonjour {user.first_name}</h1>
        <p className="muted">{data.collaborator.establishment_name} · {dateLong(data.today)}</p>
      </div>
      <Card>
        <div className="clock">
          <div className="clock__time" aria-label="Heure actuelle">{now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</div>
          <span className={`status-pill status-${data.live.status}`}>{(data.live.status === 'present' || data.live.status === 'pause') && <span className="pulse" />}{STATUS[data.live.status]}{data.live.since && ` depuis ${time(data.live.since)}`}</span>
          <button type="button" className={`clock__btn clock__btn--${primary}`} onClick={() => clock(primary)} disabled={busy}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : <Icon name={ICONS[primary]} size={40} strokeWidth={2} />}
            <span>{LABELS[primary]}</span>
            <small>Toucher pour pointer</small>
          </button>
          {secondary.map((a) => (
            <Button key={a} size="lg" className="clock__secondary" icon={ICONS[a]} onClick={() => clock(a)} disabled={busy}>{LABELS[a]}</Button>
          ))}
          <p className="tiny muted center">L’heure est enregistrée automatiquement par Mizu.</p>
        </div>
      </Card>
      <Card title="Aujourd’hui">
        <div className="small" style={{ marginBottom: 8 }}>
          <Icon name="calendar" size={16} /> Prévu : {data.today_shifts.length ? data.today_shifts.map((s) => `${hhmm(s.start_time)} – ${hhmm(s.end_time)}${s.break_minutes ? ` (pause ${s.break_minutes} min)` : ''}`).join(', ') : 'pas de créneau prévu'}
        </div>
        <div className="timeline">
          {data.today_events.map((e) => (
            <div key={e.id} className="timeline__item"><span className="timeline__dot" /><span className="grow">{LABELS[e.type]}</span><strong>{time(e.at)}</strong></div>
          ))}
          {!data.today_events.length && <p className="muted small">Aucun pointage aujourd’hui.</p>}
        </div>
      </Card>
    </div>
  );
}

function addMinutes(hhmmStr, delta) {
  const [h, m] = hhmmStr.split(':').map(Number);
  const t = Math.max(0, h * 60 + m + delta);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// ---------------- Mon planning ----------------
function MyPlanning() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api.get('/api/c/planning'));
  const [flash, setFlash] = useState(null);
  const [week, setWeek] = useState(0);
  useRealtime('planning', async (d) => {
    await reload(true);
    setFlash(d.date);
    toast({ tone: 'info', title: 'Planning mis à jour', message: d.date ? `Modification le ${date(d.date)}` : '' });
    setTimeout(() => setFlash(null), 2500);
  });
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const w = data.weeks[week];
  return (
    <div className="stack">
      <div>
        <h1>Mon planning</h1>
        <p className="muted small"><span className="status-pill status-present"><span className="pulse" />Mis à jour en temps réel</span></p>
      </div>
      <Segmented value={week} onChange={setWeek} options={[{ value: 0, label: 'Cette semaine' }, { value: 1, label: 'Semaine prochaine' }]} />
      <div className="row row--between small">
        <span className="muted">Du {dateShort(w.start)} au {dateShort(w.end)}</span>
        <strong>{minutes(w.planned_minutes)} prévues</strong>
      </div>
      {w.days.map((d) => (
        <div key={d.date} className={`day-card ${d.date === data.today ? 'is-today' : ''} ${d.date < data.today ? 'is-past' : ''} ${flash === d.date ? 'updated-flash' : ''}`}>
          <div className="day-card__date"><span>{dayName(d.date)}</span><strong>{d.date.slice(8)}</strong></div>
          <div className="grow">
            {d.shifts.length ? d.shifts.map((s) => (
              <div key={s.id}>
                <strong>{hhmm(s.start_time)} – {hhmm(s.end_time)}</strong>
                <div className="small muted">{s.break_minutes ? `Pause ${s.break_minutes} min` : 'Sans pause'}{s.note ? ` · ${s.note}` : ''}</div>
              </div>
            )) : <span className="muted">Repos</span>}
          </div>
          {d.date === data.today && <Badge tone="accent">Aujourd’hui</Badge>}
        </div>
      ))}
    </div>
  );
}

// ---------------- Mes heures ----------------
function CorrectionModal({ target, onClose, onSent }) {
  const [form, setForm] = useState(() => ({
    action: target.event ? 'modifier' : 'ajouter',
    event_type: target.event?.type || 'depart',
    requested_at: target.event ? target.event.at.slice(0, 16) : `${target.date}T${target.date === todayIso() ? '12:00' : '18:00'}`,
    reason: '',
  }));
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title="Demander une correction"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => run(async () => {
        await api.post('/api/c/corrections', { ...form, clock_event_id: target.event?.id });
        onSent();
      }, 'Demande envoyée à votre responsable')}>Envoyer la demande</Button></>}>
      <div className="stack">
        <Notice tone="info">Un pointage passé ne peut pas être modifié directement : votre responsable acceptera ou refusera la correction.</Notice>
        {target.event ? (
          <>
            <p className="small">Pointage concerné : <strong>{LABELS[target.event.type]}</strong> le {date(target.event.at)} à {time(target.event.at)}</p>
            <Segmented value={form.action} onChange={(action) => setForm({ ...form, action })} options={[{ value: 'modifier', label: 'Corriger l’heure' }, { value: 'supprimer', label: 'Supprimer' }]} />
          </>
        ) : (
          <Field label="Pointage oublié">
            <select value={form.event_type} onChange={(e) => setForm({ ...form, event_type: e.target.value })}>
              {Object.entries(LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        )}
        {form.action !== 'supprimer' && (
          <Field label="Date et heure correctes"><input type="datetime-local" value={form.requested_at} onChange={(e) => setForm({ ...form, requested_at: e.target.value })} /></Field>
        )}
        <Field label="Raison"><textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="Ex. : j'ai oublié de pointer en partant" /></Field>
      </div>
    </Modal>
  );
}

function Diff({ v }) {
  if (!v) return <span className="diff-zero">=</span>;
  return <span className={v > 0 ? 'diff-pos' : 'diff-neg'}>{v > 0 ? '+' : ''}{minutes(v)}</span>;
}

function MyHours() {
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/c/hours?month=${month}`), [month]);
  const [target, setTarget] = useState(null);
  useRealtime('heures', () => reload(true));
  useRealtime('alerte', (a) => a.type === 'correction' && reload(true));
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const w = data.week;
  const m = data.month_summary;
  const days = [...m.days].reverse().filter((d) => d.worked_minutes || d.planned_minutes || d.events.length);
  const pending = data.corrections.filter((c) => c.status === 'en_attente');
  const prevMonth = addDays(`${month}-01`, -1).slice(0, 7);
  const nextMonth = addDays(`${month}-28`, 5).slice(0, 7);

  return (
    <div className="stack">
      <h1>Mes heures</h1>
      <div className="grid grid-2" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <div className="stat">
          <div className="stat__label">Cette semaine</div>
          <div className="stat__value">{minutes(w.worked_minutes)}</div>
          <div className="stat__sub">prévu à ce jour {minutes(w.planned_to_date)} · <Diff v={w.worked_minutes - w.planned_to_date} /><br />semaine complète {minutes(w.planned_minutes)}</div>
        </div>
        <div className="stat">
          <div className="stat__label">{monthLabel(month)}</div>
          <div className="stat__value">{minutes(m.worked_minutes)}</div>
          <div className="stat__sub">prévu {minutes(m.planned_minutes)} · validé {minutes(m.validated_minutes)}</div>
        </div>
      </div>
      {pending.length > 0 && <Notice tone="info" icon="clock">{pending.length} demande(s) de correction en attente de réponse.</Notice>}
      <div className="row row--between">
        <Button variant="ghost" icon="left" onClick={() => setMonth(prevMonth)} aria-label="Mois précédent" />
        <strong>{monthLabel(month)}</strong>
        <Button variant="ghost" icon="right" onClick={() => setMonth(nextMonth)} disabled={month >= todayIso().slice(0, 7)} aria-label="Mois suivant" />
      </div>
      {!days.length ? <Card><Empty icon="clock" title="Aucun pointage ce mois-ci" /></Card> : days.map((d) => (
        <Card key={d.date}>
          <div className="row row--between">
            <strong>{dayName(d.date)} {date(d.date)}</strong>
            <span className="row" style={{ gap: 6 }}>
              {d.validated ? <Badge tone="success" icon="check">Validé</Badge> : d.open ? <Badge tone="accent">En cours</Badge> : d.incomplete ? <Badge tone="warning">Incomplet</Badge> : null}
            </span>
          </div>
          <div className="row small" style={{ gap: 16, margin: '6px 0' }}>
            <span><span className="muted">Prévu</span> {d.planned_minutes ? minutes(d.planned_minutes) : '—'}</span>
            <span><span className="muted">Pointé</span> <strong>{minutes(d.worked_minutes)}</strong></span>
            <span><span className="muted">Écart</span> <Diff v={d.worked_minutes - d.planned_minutes} /></span>
          </div>
          <div className="timeline">
            {d.events.map((e) => (
              <div key={e.id} className="timeline__item">
                <span className="timeline__dot" />
                <span className="grow small">{LABELS[e.type]} {e.original_at && <Badge tone="info">corrigé</Badge>}</span>
                <strong className="small">{time(e.at)}</strong>
                <Button size="sm" variant="ghost" icon="edit" aria-label="Demander une correction" onClick={() => setTarget({ event: e, date: d.date })} />
              </div>
            ))}
          </div>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => setTarget({ date: d.date })}>Signaler un pointage oublié</Button>
        </Card>
      ))}
      {data.corrections.length > 0 && (
        <Card title="Mes demandes de correction">
          <div className="list">
            {data.corrections.map((c) => (
              <div key={c.id} className="list__item">
                <div className="grow small">
                  {c.action === 'ajouter' ? `Ajout : ${LABELS[c.event_type]} le ${date(c.requested_at)} à ${time(c.requested_at)}`
                    : c.action === 'supprimer' ? `Suppression : ${LABELS[c.original_type] || ''} du ${date(c.original_at)}`
                    : `${LABELS[c.original_type] || LABELS[c.event_type]} : ${time(c.original_at)} → ${time(c.requested_at)}`}
                  {c.decision_comment && <div className="muted tiny">Réponse : {c.decision_comment}</div>}
                </div>
                <Badge tone={c.status === 'acceptee' ? 'success' : c.status === 'refusee' ? 'neutral' : 'warning'}>{c.status === 'acceptee' ? 'Acceptée' : c.status === 'refusee' ? 'Refusée' : 'En attente'}</Badge>
              </div>
            ))}
          </div>
        </Card>
      )}
      {target && <CorrectionModal target={target} onClose={() => setTarget(null)} onSent={() => { setTarget(null); reload(true); }} />}
    </div>
  );
}

export default function CollaborateurApp() {
  const nav = [
    { to: '/collaborateur', end: true, label: 'Pointer', icon: 'clock' },
    { to: '/collaborateur/planning', label: 'Mon planning', short: 'Planning', icon: 'calendar' },
    { to: '/collaborateur/heures', label: 'Mes heures', short: 'Heures', icon: 'list' },
  ];
  return (
    <AppShell nav={nav} mobileNav={nav} mobileFirst spaceLabel="Espace collaborateur">
      <Routes>
        <Route index element={<Pointer />} />
        <Route path="planning" element={<MyPlanning />} />
        <Route path="heures" element={<MyHours />} />
        <Route path="*" element={<Navigate to="/collaborateur" replace />} />
      </Routes>
    </AppShell>
  );
}
