import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Icon, Modal, PageHeader, PasswordReveal, Spinner, Tabs, useAction, useLoad } from '../../ui.jsx';
import { useRealtime } from '../../realtime.js';
import { date, dateShort, dayName, dayNameLong, hhmm, time, minutes, todayIso, addDays, mondayOf } from '../../format.js';

const TEMPLATES = [
  { label: 'Matin', start_time: '09:00', end_time: '15:00', break_minutes: 30 },
  { label: 'Midi', start_time: '11:30', end_time: '15:00', break_minutes: 0 },
  { label: 'Soir', start_time: '18:00', end_time: '23:30', break_minutes: 0 },
  { label: 'Journée', start_time: '09:30', end_time: '23:00', break_minutes: 90 },
];
const EVENT_LABELS = { arrivee: 'Arrivée', debut_pause: 'Début de pause', fin_pause: 'Fin de pause', depart: 'Départ' };
const STATUS = {
  present: { label: 'Au travail', cls: 'status-present', pulse: true },
  pause: { label: 'En pause', cls: 'status-pause', pulse: true },
  parti: { label: 'Parti', cls: 'status-parti' },
  absent: { label: 'Pas encore pointé', cls: 'status-absent' },
};

function shiftMinutes(s) {
  const [sh, sm] = s.start_time.split(':').map(Number);
  const [eh, em] = s.end_time.split(':').map(Number);
  let m = eh * 60 + em - (sh * 60 + sm);
  if (m <= 0) m += 1440;
  return Math.max(0, m - (s.break_minutes || 0));
}

function Diff({ value }) {
  if (!value) return <span className="diff-zero">0 h 00</span>;
  return <span className={value > 0 ? 'diff-pos' : 'diff-neg'}>{value > 0 ? '+' : ''}{minutes(value)}</span>;
}

// ---------------- Planning (glisser-déposer) ----------------
function ShiftModal({ shift, collaborators, onClose, onSave, onDelete, busy }) {
  const [form, setForm] = useState({ break_minutes: 0, note: '', ...shift });
  return (
    <Modal open onClose={onClose} title={shift.id ? 'Modifier le créneau' : 'Nouveau créneau'} size="sm"
      footer={<>
        {shift.id && <Button variant="ghost" icon="trash" onClick={onDelete}>Supprimer</Button>}
        <Button variant="primary" loading={busy} onClick={() => onSave(form)}>Enregistrer</Button>
      </>}>
      <div className="stack">
        <Field label="Collaborateur">
          <select value={form.collaborator_id} onChange={(e) => setForm({ ...form, collaborator_id: Number(e.target.value) })}>
            {collaborators.map((c) => <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
          </select>
        </Field>
        <Field label="Jour"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
        <div className="chips">
          {TEMPLATES.map((t) => <button key={t.label} type="button" className="chip" onClick={() => setForm({ ...form, ...t, label: undefined })}>{t.label} {hhmm(t.start_time)}–{hhmm(t.end_time)}</button>)}
        </div>
        <div className="form-grid">
          <Field label="Début"><input type="time" value={form.start_time || ''} onChange={(e) => setForm({ ...form, start_time: e.target.value })} /></Field>
          <Field label="Fin"><input type="time" value={form.end_time || ''} onChange={(e) => setForm({ ...form, end_time: e.target.value })} /></Field>
          <Field label="Pause"><div className="input-suffix"><input inputMode="numeric" value={form.break_minutes} onChange={(e) => setForm({ ...form, break_minutes: e.target.value })} /><span>min</span></div></Field>
          <Field label="Note"><input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Ex. : poste plonge" /></Field>
        </div>
      </div>
    </Modal>
  );
}

function Planning() {
  const { path } = useEst();
  const [week, setWeek] = useState(mondayOf(todayIso()));
  const { data, error, loading, reload, setData } = useLoad(() => api.get(path(`/planning?week=${week}`)), [week]);
  const [over, setOver] = useState(null);
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction();
  const today = todayIso();
  useRealtime('pointage', () => reload(true));

  const save = (body, id) => run(async () => {
    if (id) await api.put(path(`/shifts/${id}`), body);
    else await api.post(path('/shifts'), body);
    await reload(true);
  });

  const onDrop = (e, collaboratorId, day) => {
    e.preventDefault();
    setOver(null);
    let payload;
    try { payload = JSON.parse(e.dataTransfer.getData('application/json')); } catch { return; }
    if (payload.template) {
      save({ collaborator_id: collaboratorId, date: day, ...payload.template });
    } else if (payload.shiftId) {
      const s = data.shifts.find((x) => x.id === payload.shiftId);
      if (!s || (s.collaborator_id === collaboratorId && s.date === day)) return;
      // déplacement immédiat à l'écran, puis enregistrement
      setData((d) => ({ ...d, shifts: d.shifts.map((x) => (x.id === s.id ? { ...x, collaborator_id: collaboratorId, date: day } : x)) }));
      save({ collaborator_id: collaboratorId, date: day }, s.id);
    }
  };

  if (loading && !data) return <Spinner />;
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <div className="row row--between" style={{ marginBottom: 14 }}>
        <div className="row">
          <Button variant="ghost" icon="left" onClick={() => setWeek(addDays(week, -7))} aria-label="Semaine précédente" />
          <strong>Semaine du {dateShort(week)} au {dateShort(addDays(week, 6))}</strong>
          <Button variant="ghost" icon="right" onClick={() => setWeek(addDays(week, 7))} aria-label="Semaine suivante" />
          {week !== mondayOf(today) && <Button size="sm" variant="ghost" onClick={() => setWeek(mondayOf(today))}>Cette semaine</Button>}
        </div>
        <Button icon="copy" loading={busy} onClick={() => run(async () => {
          try {
            await api.post(path('/planning/copy-previous'), { week });
          } catch (e) {
            if (e.status !== 409 || !window.confirm('Cette semaine contient déjà des créneaux. Ajouter quand même ceux de la semaine précédente ?')) throw e;
            await api.post(path('/planning/copy-previous'), { week, force: true });
          }
          await reload(true);
        }, 'Semaine précédente copiée')}>Copier la semaine précédente</Button>
      </div>
      <Card className="section hide-mobile">
        <div className="shift-palette">
          <span className="small muted">Glissez un créneau sur le planning :</span>
          {TEMPLATES.map((t) => (
            <span key={t.label} className="shift-template" draggable onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ template: { start_time: t.start_time, end_time: t.end_time, break_minutes: t.break_minutes } })); e.dataTransfer.effectAllowed = 'copy'; }}>
              <Icon name="drag" size={14} />{t.label} · {hhmm(t.start_time)}–{hhmm(t.end_time)}
            </span>
          ))}
          <span className="tiny muted">Déplacez un créneau existant pour le changer de jour ou de personne. Cliquez dessus pour le modifier.</span>
        </div>
      </Card>
      {!data.collaborators.length ? <Card className="section"><Empty icon="users" title="Aucun collaborateur">Ajoutez votre équipe dans l'onglet Collaborateurs.</Empty></Card> : (
        <Card pad={false} className="section planning">
          <div className="planning__grid">
            <div className="planning__head">Équipe</div>
            {data.days.map((d) => <div key={d} className={`planning__head ${d === today ? 'is-today' : ''}`}>{dayName(d)} {dateShort(d)}</div>)}
            {data.collaborators.map((c) => {
              const planned = data.shifts.filter((s) => s.collaborator_id === c.id).reduce((n, s) => n + shiftMinutes(s), 0);
              return [
                <div key={`p${c.id}`} className="planning__person">
                  <span className="row" style={{ gap: 7 }}><span className="dot" style={{ background: c.color }} /><strong className="small">{c.first_name} {c.last_name}</strong></span>
                  <span className="tiny muted">{c.job_title || '—'}</span>
                  <span className={`tiny ${c.weekly_hours && planned > c.weekly_hours * 60 ? 'text-warning' : 'muted'}`}>{minutes(planned)}{c.weekly_hours ? ` / ${c.weekly_hours} h` : ''}</span>
                </div>,
                ...data.days.map((d) => {
                  const key = `${c.id}-${d}`;
                  return (
                    <div key={key} className={`planning__cell ${over === key ? 'is-over' : ''} ${d === today ? 'is-today' : ''}`}
                      onDragOver={(e) => { e.preventDefault(); setOver(key); }}
                      onDragLeave={() => setOver((o) => (o === key ? null : o))}
                      onDrop={(e) => onDrop(e, c.id, d)}>
                      {data.shifts.filter((s) => s.collaborator_id === c.id && s.date === d).map((s) => (
                        <div key={s.id} className="shift" style={{ background: c.color }} draggable
                          onDragStart={(e) => { e.dataTransfer.setData('application/json', JSON.stringify({ shiftId: s.id })); e.dataTransfer.effectAllowed = 'move'; }}
                          onClick={() => setModal(s)} title="Cliquer pour modifier">
                          {hhmm(s.start_time)}–{hhmm(s.end_time)}
                          <small>{s.break_minutes ? `pause ${s.break_minutes} min` : ''}{s.note ? ` ${s.note}` : ''}</small>
                        </div>
                      ))}
                      <button type="button" className="planning__add" onClick={() => setModal({ collaborator_id: c.id, date: d, start_time: '09:00', end_time: '15:00', break_minutes: 30 })}>+ créneau</button>
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </Card>
      )}
      <p className="tiny muted section">Chaque modification est envoyée en temps réel au collaborateur concerné, avec une notification.</p>
      {modal && (
        <ShiftModal shift={modal} collaborators={data.collaborators} busy={busy} onClose={() => setModal(null)}
          onSave={(form) => save({ collaborator_id: form.collaborator_id, date: form.date, start_time: form.start_time, end_time: form.end_time, break_minutes: form.break_minutes, note: form.note }, modal.id).then(() => setModal(null))}
          onDelete={() => run(async () => { await api.del(path(`/shifts/${modal.id}`)); setModal(null); await reload(true); })} />
      )}
    </>
  );
}

// ---------------- En direct ----------------
function Live() {
  const { path } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/live')));
  useRealtime('pointage', () => reload(true));
  if (loading && !data) return <Spinner />;
  const order = { present: 0, pause: 1, parti: 2, absent: 3 };
  const list = [...(data?.collaborators || [])].sort((a, b) => order[a.live.status] - order[b.live.status]);
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <p className="small muted" style={{ marginBottom: 12 }}><span className="status-pill status-present"><span className="pulse" />En direct</span> {dayNameLong(data.date)} {date(data.date)} · mis à jour à chaque pointage</p>
      <div className="grid grid-2">
        {list.map((c) => {
          const st = STATUS[c.live.status];
          return (
            <div key={c.id} className="live-card">
              <span className="avatar" style={{ background: `${c.color}22`, color: c.color }}>{c.first_name[0]}{c.last_name[0]}</span>
              <div className="grow">
                <div className="row row--between">
                  <strong>{c.first_name} {c.last_name}</strong>
                  <span className={`status-pill ${st.cls}`}>{st.pulse && <span className="pulse" />}{st.label}</span>
                </div>
                <div className="small muted">
                  {c.shifts.length ? `Prévu ${c.shifts.map((s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`).join(', ')}` : 'Pas de créneau prévu aujourd’hui'}
                  {c.live.since && ` · ${EVENT_LABELS[c.live.last.type].toLowerCase()} à ${time(c.live.since)}`}
                </div>
                {c.worked_minutes > 0 && <div className="tiny muted">Temps de travail aujourd’hui : {minutes(c.worked_minutes)}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ---------------- Heures : prévu / pointé / validation ----------------
function Hours() {
  const { path } = useEst();
  const [week, setWeek] = useState(mondayOf(addDays(todayIso(), -7)));
  const { data, error, loading, reload } = useLoad(() => api.get(path(`/planning?week=${week}`)), [week]);
  const [detail, setDetail] = useState(null);
  const [run, busy] = useAction();
  const today = todayIso();
  useRealtime('pointage', () => reload(true));
  if (loading && !data) return <Spinner />;
  const validate = (c, dates) => run(async () => { await api.post(path('/hours/validate'), { collaborator_id: c.id, dates }); await reload(true); }, 'Heures validées');

  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <div className="row" style={{ marginBottom: 14 }}>
        <Button variant="ghost" icon="left" onClick={() => setWeek(addDays(week, -7))} aria-label="Semaine précédente" />
        <strong>Semaine du {dateShort(week)} au {dateShort(addDays(week, 6))}</strong>
        <Button variant="ghost" icon="right" onClick={() => setWeek(addDays(week, 7))} aria-label="Semaine suivante" />
      </div>
      <div className="stack">
        {data.collaborators.map((c) => {
          const s = c.summary;
          const toValidate = s.days.filter((d) => d.date < today && !d.validated && (d.worked_minutes > 0 || d.planned_minutes > 0)).map((d) => d.date);
          return (
            <Card key={c.id} pad={false} title={<span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: c.color }} />{c.first_name} {c.last_name}</span>}
              subtitle={`Prévu ${minutes(s.planned_minutes)} · pointé ${minutes(s.worked_minutes)} · validé ${minutes(s.validated_minutes)}`}
              actions={toValidate.length
                ? <Button size="sm" variant="success" icon="check" loading={busy} onClick={() => validate(c, toValidate)}>Valider la semaine ({toValidate.length} j)</Button>
                : <Badge tone="success" icon="check">À jour</Badge>}>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th />{s.days.map((d) => <th key={d.date} className="num">{dayName(d.date)} {d.date.slice(8)}</th>)}<th className="num">Total</th></tr></thead>
                  <tbody>
                    <tr><td className="muted small">Prévu</td>{s.days.map((d) => <td key={d.date} className="num small">{d.planned_minutes ? minutes(d.planned_minutes) : '—'}</td>)}<td className="num strong">{minutes(s.planned_minutes)}</td></tr>
                    <tr><td className="muted small">Pointé</td>{s.days.map((d) => (
                      <td key={d.date} className="num small">
                        <button type="button" className="btn btn--ghost btn--sm" style={{ padding: '2px 6px', minHeight: 0 }} onClick={() => setDetail({ c, d })}>
                          {d.worked_minutes ? minutes(d.worked_minutes) : '—'}{d.incomplete && <Icon name="alert" size={13} className="text-warning" />}
                        </button>
                      </td>
                    ))}<td className="num strong">{minutes(s.worked_minutes)}</td></tr>
                    <tr><td className="muted small">Écart</td>{s.days.map((d) => <td key={d.date} className="num small">{d.planned_minutes || d.worked_minutes ? <Diff value={d.worked_minutes - d.planned_minutes} /> : ''}</td>)}<td className="num"><Diff value={s.worked_minutes - s.planned_minutes} /></td></tr>
                    <tr><td className="muted small">Validé</td>{s.days.map((d) => (
                      <td key={d.date} className="num small">
                        {d.validated ? <Icon name="check" size={16} className="text-success" title={`Validé : ${minutes(d.validated.validated_minutes)}`} />
                          : d.date < today && (d.worked_minutes || d.planned_minutes) ? <Button size="sm" variant="ghost" onClick={() => validate(c, [d.date])}>Valider</Button> : ''}
                      </td>
                    ))}<td className="num strong">{minutes(s.validated_minutes)}</td></tr>
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
      {detail && (
        <Modal open onClose={() => setDetail(null)} title={`${detail.c.first_name} · ${dayNameLong(detail.d.date)} ${date(detail.d.date)}`} size="sm">
          <div className="stack">
            <div className="small">Prévu : {detail.d.shifts.map((s) => `${hhmm(s.start_time)}–${hhmm(s.end_time)}`).join(', ') || 'aucun créneau'}</div>
            <div className="timeline">
              {detail.d.events.map((e) => (
                <div key={e.id} className="timeline__item"><span className="timeline__dot" /><span className="grow">{EVENT_LABELS[e.type]}</span><strong>{time(e.at)}</strong>{e.original_at && <Badge tone="info">corrigé</Badge>}</div>
              ))}
              {!detail.d.events.length && <p className="muted small">Aucun pointage.</p>}
            </div>
            {detail.d.incomplete && <p className="small text-warning">Pointage incomplet (départ ou arrivée manquant).</p>}
            <div className="small">Temps pointé : <strong>{minutes(detail.d.worked_minutes)}</strong> (pauses : {minutes(detail.d.pause_minutes)})</div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------------- Demandes de correction ----------------
function Corrections() {
  const { path, refreshBadges } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/corrections')));
  const [decide, setDecide] = useState(null);
  const [comment, setComment] = useState('');
  const [run, busy] = useAction();
  if (loading && !data) return <Spinner />;
  const pending = data.corrections.filter((c) => c.status === 'en_attente');
  const done = data.corrections.filter((c) => c.status !== 'en_attente');
  const describe = (c) => {
    if (c.action === 'ajouter') return <>Ajouter « {EVENT_LABELS[c.event_type]} » le {date(c.requested_at)} à {time(c.requested_at)}</>;
    if (c.action === 'supprimer') return <>Supprimer « {EVENT_LABELS[c.original_type] || ''} » du {date(c.original_at)} à {time(c.original_at)}</>;
    return <>« {EVENT_LABELS[c.original_type] || EVENT_LABELS[c.event_type]} » du {date(c.original_at)} : {time(c.original_at)} → <strong>{time(c.requested_at)}</strong>{c.requested_at?.slice(0, 10) !== c.original_at?.slice(0, 10) && ` (${date(c.requested_at)})`}</>;
  };
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <Card title="En attente">
        {!pending.length ? <p className="muted small">Aucune demande en attente.</p> : (
          <div className="list">
            {pending.map((c) => (
              <div key={c.id} className="list__item row--top">
                <span className="list__icon list__icon--accent"><Icon name="clock" size={18} /></span>
                <div className="grow">
                  <strong>{c.first_name} {c.last_name}</strong>
                  <div className="small">{describe(c)}</div>
                  <div className="small muted">« {c.reason} » · demandé le {date(c.created_at)}</div>
                </div>
                <div className="row">
                  <Button size="sm" variant="ghost" icon="x" onClick={() => { setComment(''); setDecide({ c, decision: 'refusee' }); }}>Refuser</Button>
                  <Button size="sm" variant="success" icon="check" onClick={() => { setComment(''); setDecide({ c, decision: 'acceptee' }); }}>Accepter</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Card title="Historique" className="section">
        {!done.length ? <p className="muted small">Aucune demande traitée.</p> : (
          <div className="list">
            {done.map((c) => (
              <div key={c.id} className="list__item">
                <div className="grow small"><strong>{c.first_name} {c.last_name}</strong> · {describe(c)}<div className="muted tiny">{c.reason}{c.decision_comment ? ` — réponse : ${c.decision_comment}` : ''}</div></div>
                <Badge tone={c.status === 'acceptee' ? 'success' : 'neutral'}>{c.status === 'acceptee' ? 'Acceptée' : 'Refusée'}</Badge>
              </div>
            ))}
          </div>
        )}
      </Card>
      <Confirm open={!!decide} title={decide?.decision === 'acceptee' ? 'Accepter la correction ?' : 'Refuser la correction ?'} tone={decide?.decision === 'acceptee' ? 'success' : 'danger'}
        confirmLabel={decide?.decision === 'acceptee' ? 'Accepter' : 'Refuser'} busy={busy} onClose={() => setDecide(null)}
        onConfirm={() => run(async () => { await api.post(path(`/corrections/${decide.c.id}/decide`), { decision: decide.decision, comment }); setDecide(null); refreshBadges?.(); await reload(true); }, 'Réponse envoyée au collaborateur')}>
        <div className="stack">
          {decide && <p className="small">{describe(decide.c)}</p>}
          {decide?.decision === 'acceptee' && <p className="small muted">Le pointage sera corrigé ; la journée concernée devra être revalidée.</p>}
          <Field label="Message au collaborateur (facultatif)"><textarea value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        </div>
      </Confirm>
    </>
  );
}

// ---------------- Collaborateurs ----------------
function Members() {
  const { path, est } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/team')));
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', job_title: '', weekly_hours: '' });
  const [toggle, setToggle] = useState(null);
  const [run, busy] = useAction();
  if (loading && !data) return <Spinner />;
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <div className="row" style={{ marginBottom: 14 }}>
        <Button variant="primary" icon="plus" onClick={() => { setCreated(null); setAdding(true); }}>Ajouter un collaborateur</Button>
      </div>
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th>Collaborateur</th><th>Poste</th><th>Email de connexion</th><th className="num">Contrat</th><th>Statut</th><th /></tr></thead>
            <tbody>
              {data.collaborators.map((c) => (
                <tr key={c.id}>
                  <td data-label="Nom"><span className="row" style={{ gap: 8 }}><span className="dot" style={{ background: c.color }} /><strong>{c.first_name} {c.last_name}</strong></span></td>
                  <td data-label="Poste">{c.job_title || '—'}</td>
                  <td data-label="Email">{c.email}</td>
                  <td data-label="Contrat" className="num">{c.weekly_hours ? `${c.weekly_hours} h / sem.` : '—'}</td>
                  <td data-label="Statut">{c.active ? <Badge tone="success">Actif</Badge> : <Badge>Désactivé</Badge>}</td>
                  <td className="actions">
                    {c.active ? <>
                      <Button size="sm" variant="ghost" icon="key" onClick={() => run(async () => { const r = await api.post(path(`/team/${c.id}/reset-password`)); setCreated({ email: c.email, password: r.password }); setAdding(true); })}>Nouveau mot de passe</Button>
                      <Button size="sm" variant="ghost" onClick={() => setToggle(c)}>Désactiver</Button>
                    </> : <Button size="sm" variant="ghost" onClick={() => run(async () => { await api.put(path(`/team/${c.id}`), { active: true }); reload(true); }, 'Compte réactivé')}>Réactiver</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.collaborators.length && <Empty icon="users" title="Aucun collaborateur" />}
        </div>
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={created ? 'Identifiants de connexion' : `Nouveau collaborateur · ${est.name}`}
        footer={created ? <Button variant="primary" onClick={() => setAdding(false)}>Terminé</Button> : <><Button variant="ghost" onClick={() => setAdding(false)}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => run(async () => {
          const r = await api.post(path('/team'), form);
          setCreated({ email: form.email, password: r.password });
          setForm({ first_name: '', last_name: '', email: '', job_title: '', weekly_hours: '' });
          reload(true);
        }, 'Compte créé')}>Créer le compte</Button></>}>
        {created ? <PasswordReveal {...created} /> : (
          <div className="form-grid">
            <Field label="Prénom"><input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Nom"><input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
            <Field label="Email (identifiant de connexion)" className="span-2"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Poste"><input value={form.job_title} onChange={(e) => setForm({ ...form, job_title: e.target.value })} placeholder="Ex. : Serveur" /></Field>
            <Field label="Heures par semaine"><input inputMode="decimal" value={form.weekly_hours} onChange={(e) => setForm({ ...form, weekly_hours: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Confirm open={!!toggle} title="Désactiver ce compte ?" busy={busy} onClose={() => setToggle(null)} confirmLabel="Désactiver"
        onConfirm={() => run(async () => { await api.put(path(`/team/${toggle.id}`), { active: false }); setToggle(null); reload(true); }, 'Compte désactivé')}>
        {toggle?.first_name} ne pourra plus se connecter. Son historique de pointages est conservé.
      </Confirm>
    </>
  );
}

const TABS = [
  { value: 'planning', label: 'Planning', icon: 'calendar' },
  { value: 'direct', label: 'En direct', icon: 'clock' },
  { value: 'heures', label: 'Heures', icon: 'list' },
  { value: 'corrections', label: 'Corrections', icon: 'edit' },
  { value: 'collaborateurs', label: 'Collaborateurs', icon: 'users' },
];

export default function Team() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const current = TABS.some((t) => t.value === tab) ? tab : 'planning';
  return (
    <>
      <PageHeader title="Plannings et équipe" subtitle="Planning de la semaine, pointages en direct et validation des heures." />
      <Tabs value={current} onChange={(v) => navigate(`/restaurateur/equipe/${v}`)} tabs={TABS} />
      {current === 'planning' && <Planning />}
      {current === 'direct' && <Live />}
      {current === 'heures' && <Hours />}
      {current === 'corrections' && <Corrections />}
      {current === 'collaborateurs' && <Members />}
    </>
  );
}
