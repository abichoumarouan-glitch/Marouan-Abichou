import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, download } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { useAuth } from '../../auth.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Icon, Modal, Notice, PageHeader, PhotoButton, Segmented, Spinner, Tabs, useAction, useLoad } from '../../ui.jsx';
import { takePendingFile } from '../../pending.js';
import { date, dateTime, time, todayIso, addDays, num, nowLocalInput } from '../../format.js';

const deg = (v) => `${num(v, 1)} °C`;

// ---------------- Températures ----------------
function ReadingModal({ equipment, initial, onClose, onSaved }) {
  const { path } = useEst();
  const { user } = useAuth();
  const [form, setForm] = useState({ equipment_id: initial || equipment[0]?.id || '', value: '', comment: '', taken_by: `${user.first_name} ${user.last_name}`.trim(), taken_at: nowLocalInput() });
  const [run, busy] = useAction();
  const eq = equipment.find((e) => e.id === Number(form.equipment_id));
  const v = Number(String(form.value).replace(',', '.'));
  const out = eq && form.value !== '' && Number.isFinite(v) && (v < eq.min_temp || v > eq.max_temp);
  return (
    <Modal open onClose={onClose} title="Saisir une température"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant={out ? 'danger' : 'primary'} loading={busy} onClick={() => run(async () => {
        const r = await api.post(path('/temperatures'), form);
        onSaved(r);
      }, out ? undefined : 'Relevé enregistré')}>Enregistrer</Button></>}>
      <div className="stack">
        <Field label="Équipement">
          <select value={form.equipment_id} onChange={(e) => setForm({ ...form, equipment_id: e.target.value })}>
            {equipment.map((e) => <option key={e.id} value={e.id}>{e.name} ({deg(e.min_temp)} à {deg(e.max_temp)})</option>)}
          </select>
        </Field>
        <Field label="Température relevée">
          <div className="input-suffix"><input inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value.replace(/[^\d,.-]/g, '') })} autoFocus style={{ fontSize: 22, fontWeight: 600 }} placeholder="3,5" /><span>°C</span></div>
        </Field>
        <div className="row" style={{ gap: 6 }}>
          {['-', '0', '1', '2', '3', '4', '5'].map((k) => <button key={k} type="button" className="chip" onClick={() => setForm((f) => ({ ...f, value: k === '-' ? (f.value.startsWith('-') ? f.value.slice(1) : `-${f.value}`) : f.value + k }))}>{k === '-' ? '±' : k}</button>)}
          <button type="button" className="chip" onClick={() => setForm((f) => ({ ...f, value: f.value.includes(',') ? f.value : `${f.value},` }))}>,</button>
          <button type="button" className="chip" onClick={() => setForm((f) => ({ ...f, value: f.value.slice(0, -1) }))}>⌫</button>
        </div>
        {out && <Notice tone="danger">Hors seuil ({deg(eq.min_temp)} à {deg(eq.max_temp)}). Indiquez l'action corrective réalisée : une alerte sera envoyée.</Notice>}
        <Field label={out ? 'Action corrective (obligatoire)' : 'Commentaire'}><textarea value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} placeholder={out ? 'Ex. : porte refermée, produits contrôlés, nouveau relevé dans 30 min' : ''} /></Field>
        <div className="form-grid">
          <Field label="Relevé par"><input value={form.taken_by} onChange={(e) => setForm({ ...form, taken_by: e.target.value })} /></Field>
          <Field label="Date et heure"><input type="datetime-local" value={form.taken_at} max={nowLocalInput()} onChange={(e) => setForm({ ...form, taken_at: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

function EquipmentModal({ item, onClose, onSaved }) {
  const { path } = useEst();
  const [form, setForm] = useState({ name: item.name || '', kind: item.kind || 'Froid positif', min_temp: item.min_temp ?? 0, max_temp: item.max_temp ?? 4 });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title={item.id ? item.name : 'Nouvel équipement'} size="sm"
      footer={<>
        {item.id && <Button variant="ghost" icon="trash" onClick={() => run(async () => { await api.put(path(`/equipment/${item.id}`), { active: false }); onSaved(); }, 'Équipement retiré')}>Retirer</Button>}
        <Button variant="primary" loading={busy} onClick={() => run(async () => {
          if (item.id) await api.put(path(`/equipment/${item.id}`), form); else await api.post(path('/equipment'), form);
          onSaved();
        }, 'Équipement enregistré')}>Enregistrer</Button>
      </>}>
      <div className="stack">
        <Field label="Nom"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. : Chambre froide" /></Field>
        <Field label="Type">
          <select value={form.kind} onChange={(e) => {
            const kind = e.target.value;
            const preset = { 'Froid positif': [0, 4], 'Froid négatif': [-25, -18], 'Maintien au chaud': [63, 90] }[kind];
            setForm({ ...form, kind, min_temp: preset[0], max_temp: preset[1] });
          }}>
            <option>Froid positif</option><option>Froid négatif</option><option>Maintien au chaud</option>
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Seuil bas"><div className="input-suffix"><input inputMode="decimal" value={form.min_temp} onChange={(e) => setForm({ ...form, min_temp: e.target.value })} /><span>°C</span></div></Field>
          <Field label="Seuil haut"><div className="input-suffix"><input inputMode="decimal" value={form.max_temp} onChange={(e) => setForm({ ...form, max_temp: e.target.value })} /><span>°C</span></div></Field>
        </div>
      </div>
    </Modal>
  );
}

function Temperatures() {
  const { path } = useEst();
  const [params, setParams] = useSearchParams();
  const eq = useLoad(() => api.get(path('/equipment')));
  const [range, setRange] = useState({ from: addDays(todayIso(), -6), to: todayIso(), equipment: '' });
  const hist = useLoad(() => api.get(path(`/temperatures?from=${range.from}&to=${range.to}${range.equipment ? `&equipment=${range.equipment}` : ''}`)), [range.from, range.to, range.equipment]);
  const [entry, setEntry] = useState(params.get('saisie') ? 'new' : null);
  const [editEq, setEditEq] = useState(null);
  const [outOnly, setOutOnly] = useState(false);

  if (eq.loading && !eq.data) return <Spinner />;
  const equipment = eq.data?.equipment || [];
  const readings = (hist.data?.readings || []).filter((r) => !outOnly || r.out_of_range);
  const closeEntry = () => { setEntry(null); if (params.get('saisie')) setParams({}, { replace: true }); };

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <Button variant="primary" size="lg" icon="thermo" onClick={() => setEntry('new')} disabled={!equipment.length}>Saisir une température</Button>
        <Button icon="plus" onClick={() => setEditEq({})}>Ajouter un équipement</Button>
      </div>
      {!equipment.length ? <Card><Empty icon="thermo" title="Aucun équipement">Ajoutez vos frigos, chambres froides et congélateurs avec leurs seuils.</Empty></Card> : (
        <div className="equip-grid">
          {equipment.map((e) => {
            const out = e.last?.out_of_range;
            return (
              <div key={e.id} className={`equip ${out ? 'is-out' : ''}`}>
                <div className="row row--between">
                  <strong>{e.name}</strong>
                  <Button size="sm" variant="ghost" icon="edit" aria-label="Modifier" onClick={() => setEditEq(e)} />
                </div>
                <div className={`equip__temp ${out ? 'text-danger' : ''}`}>{e.last ? deg(e.last.value) : '—'}</div>
                <div className="small muted">Seuils : {deg(e.min_temp)} à {deg(e.max_temp)}</div>
                <div className="row row--between">
                  <span className="tiny muted">{e.last ? `Dernier relevé ${dateTime(e.last.taken_at)}` : 'Aucun relevé'}</span>
                  {e.last && (out ? <Badge tone="danger" icon="alert">Hors seuil</Badge> : <Badge tone="success" icon="check">Conforme</Badge>)}
                </div>
                <Button size="sm" variant="soft" icon="plus" onClick={() => setEntry(e.id)}>Relever</Button>
              </div>
            );
          })}
        </div>
      )}

      <Card title="Historique des relevés" className="section" pad={false}
        actions={<div className="row">
          <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} style={{ width: 'auto' }} aria-label="Du" />
          <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} style={{ width: 'auto' }} aria-label="Au" />
          <select value={range.equipment} onChange={(e) => setRange({ ...range, equipment: e.target.value })} style={{ width: 'auto' }} aria-label="Équipement">
            <option value="">Tous les équipements</option>
            {equipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <label className="check"><input type="checkbox" checked={outOnly} onChange={(e) => setOutOnly(e.target.checked)} /> Hors seuil uniquement</label>
        </div>}>
        <ErrorBox error={hist.error} onRetry={hist.reload} />
        {hist.loading && !hist.data ? <Spinner /> : !readings.length ? <Empty icon="thermo" title="Aucun relevé sur la période" /> : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th>Date</th><th>Équipement</th><th className="num">Relevé</th><th>Seuils</th><th>État</th><th>Par</th><th>Commentaire / action corrective</th></tr></thead>
              <tbody>
                {readings.map((r) => (
                  <tr key={r.id} className={r.out_of_range ? 'row-danger' : ''}>
                    <td data-label="Date" className="nowrap">{dateTime(r.taken_at)}</td>
                    <td data-label="Équipement">{r.equipment_name}</td>
                    <td data-label="Relevé" className={`num strong ${r.out_of_range ? 'text-danger' : ''}`}>{deg(r.value)}</td>
                    <td data-label="Seuils" className="small muted nowrap">{deg(r.min_temp)} à {deg(r.max_temp)}</td>
                    <td data-label="État">{r.out_of_range ? <Badge tone="danger">Hors seuil</Badge> : <Badge tone="success">Conforme</Badge>}</td>
                    <td data-label="Par">{r.taken_by}</td>
                    <td data-label="Commentaire" className="small">{r.comment || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {entry && equipment.length > 0 && (
        <ReadingModal equipment={equipment} initial={entry === 'new' ? null : entry} onClose={closeEntry}
          onSaved={() => { closeEntry(); eq.reload(true); hist.reload(true); }} />
      )}
      {editEq && <EquipmentModal item={editEq} onClose={() => setEditEq(null)} onSaved={() => { setEditEq(null); eq.reload(true); }} />}
    </>
  );
}

// ---------------- Dates limites ----------------
function DlcModal({ initial, onClose, onSaved }) {
  const { path } = useEst();
  const [form, setForm] = useState({ origin: 'livre', product_name: '', dlc_date: '', date_type: 'DLC', lot_number: '', quantity_label: '', photo_path: null, ...initial });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title={form.origin === 'maison' ? 'Préparation maison' : 'Produit livré'}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => run(async () => { await api.post(path('/dlc'), form); onSaved(); }, 'Date limite enregistrée')}>Enregistrer</Button></>}>
      <div className="stack">
        {form.message && <Notice tone={form.dlc_date ? 'success' : 'warning'} icon={form.dlc_date ? 'sparkles' : 'alert'}>{form.message}</Notice>}
        {form.preview && <img src={form.preview} alt="Étiquette photographiée" style={{ maxHeight: 180, objectFit: 'contain', borderRadius: 10, border: '1px solid var(--line)' }} />}
        <Segmented value={form.origin} onChange={(origin) => setForm({ ...form, origin })} options={[{ value: 'livre', label: 'Produit livré' }, { value: 'maison', label: 'Préparation maison' }]} />
        <Field label="Produit"><input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} placeholder={form.origin === 'maison' ? 'Ex. : Sauce tartare maison' : 'Ex. : Crème fraîche'} /></Field>
        <div className="form-grid">
          <Field label="Date limite"><input type="date" value={form.dlc_date} onChange={(e) => setForm({ ...form, dlc_date: e.target.value })} /></Field>
          <Field label="Type de date">
            <select value={form.date_type} onChange={(e) => setForm({ ...form, date_type: e.target.value })}>
              <option value="DLC">DLC — à consommer jusqu'au</option>
              <option value="DDM">DDM — de préférence avant</option>
            </select>
          </Field>
          <Field label="N° de lot"><input value={form.lot_number} onChange={(e) => setForm({ ...form, lot_number: e.target.value })} /></Field>
          <Field label="Quantité"><input value={form.quantity_label} onChange={(e) => setForm({ ...form, quantity_label: e.target.value })} placeholder="Ex. : 2 bacs" /></Field>
        </div>
        {form.origin === 'maison' && (
          <div className="row" style={{ gap: 6 }}>
            <span className="small muted">Raccourcis :</span>
            {[1, 2, 3, 5].map((n) => <button key={n} type="button" className="chip" onClick={() => setForm({ ...form, dlc_date: addDays(todayIso(), n) })}>J+{n}</button>)}
          </div>
        )}
      </div>
    </Modal>
  );
}

function Dates() {
  const { path } = useEst();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('actif');
  const { data, error, loading, reload } = useLoad(() => api.get(path(`/dlc?status=${status}`)), [status]);
  const [modal, setModal] = useState(null);
  const [run, busy] = useAction();

  const readLabel = (file) => run(async () => {
    const fd = new FormData();
    fd.append('photo', file);
    const r = await api.post(path('/dlc/label'), fd);
    setModal({ origin: 'livre', product_name: r.product_name || '', dlc_date: r.dlc_date || '', date_type: r.date_type || 'DLC', lot_number: r.lot_number || '', photo_path: r.photo_path, message: r.message, preview: URL.createObjectURL(file) });
  });

  useEffect(() => {
    if (!params.get('etiquette')) return;
    const f = takePendingFile('label');
    setParams({}, { replace: true });
    if (f) readLabel(f);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const today = data?.today || todayIso();
  const level = (d) => (d < today ? 'expired' : d === today ? 'today' : d <= addDays(today, 2) ? 'soon' : 'ok');
  const items = data?.items || [];

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <PhotoButton size="lg" icon="tag" onFile={readLabel} disabled={busy}>Photographier une étiquette</PhotoButton>
        <Button icon="plus" onClick={() => setModal({ origin: 'maison' })}>Préparation maison</Button>
        <Button variant="ghost" icon="edit" onClick={() => setModal({ origin: 'livre' })}>Saisie manuelle</Button>
      </div>
      {busy && <Notice tone="info" icon="sparkles">Lecture de l'étiquette en cours…</Notice>}
      <Card pad={false} className="section">
        <div className="card__head">
          <Tabs value={status} onChange={setStatus} tabs={[{ value: 'actif', label: 'En stock' }, { value: 'utilise', label: 'Utilisés' }, { value: 'jete', label: 'Jetés' }]} />
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !items.length ? <Empty icon="tag" title="Aucun produit" /> : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th>Date limite</th><th>Produit</th><th>Origine</th><th>Lot</th><th>État</th>{status === 'actif' && <th />}</tr></thead>
              <tbody>
                {items.map((i) => {
                  const l = level(i.dlc_date);
                  return (
                    <tr key={i.id} className={status === 'actif' ? (l === 'expired' || l === 'today' ? 'row-danger' : l === 'soon' ? 'row-warning' : '') : ''}>
                      <td data-label="Date limite"><span className="dlc-date">{date(i.dlc_date)}</span> <span className="tiny muted">{i.date_type}</span></td>
                      <td data-label="Produit"><strong>{i.product_name}</strong>{i.quantity_label && <div className="tiny muted">{i.quantity_label}</div>}</td>
                      <td data-label="Origine">{i.origin === 'maison' ? 'Préparation maison' : 'Livré'}{i.photo_path && <> · <a href={`/api/files/${i.photo_path}`} target="_blank" rel="noreferrer">étiquette</a></>}</td>
                      <td data-label="Lot">{i.lot_number || '—'}</td>
                      <td data-label="État">
                        {status !== 'actif' ? <Badge>{status === 'utilise' ? 'Utilisé' : 'Jeté'}</Badge>
                          : l === 'expired' ? <Badge tone="danger" icon="alert">Dépassée</Badge>
                          : l === 'today' ? <Badge tone="danger">Aujourd'hui</Badge>
                          : l === 'soon' ? <Badge tone="warning">Bientôt</Badge>
                          : <Badge tone="success">OK</Badge>}
                      </td>
                      {status === 'actif' && (
                        <td className="actions">
                          <Button size="sm" variant="ghost" icon="check" onClick={() => run(async () => { await api.put(path(`/dlc/${i.id}`), { status: 'utilise' }); reload(true); })}>Utilisé</Button>
                          <Button size="sm" variant="ghost" icon="trash" onClick={() => run(async () => { await api.put(path(`/dlc/${i.id}`), { status: 'jete' }); reload(true); })}>Jeté</Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="tiny muted section">Une alerte est envoyée 2 jours avant la date limite, la veille, le jour même et en cas de dépassement.</p>
      {modal && <DlcModal initial={modal} onClose={() => setModal(null)} onSaved={() => { setModal(null); setStatus('actif'); reload(true); }} />}
    </>
  );
}

// ---------------- Plan de nettoyage ----------------
const FREQ = { quotidienne: 'Chaque jour', hebdomadaire: 'Chaque semaine', mensuelle: 'Chaque mois' };

function Cleaning() {
  const { path } = useEst();
  const { user } = useAuth();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/cleaning')));
  const [range, setRange] = useState({ from: addDays(todayIso(), -6), to: todayIso() });
  const logs = useLoad(() => api.get(path(`/cleaning/logs?from=${range.from}&to=${range.to}`)), [range.from, range.to]);
  const [who, setWho] = useState(`${user.first_name} ${user.last_name}`.trim());
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ zone: '', name: '', frequency: 'quotidienne' });
  const [run, busy] = useAction();
  if (loading && !data) return <Spinner />;
  const zones = [...new Set((data?.tasks || []).map((t) => t.zone))];
  const doneCount = (data?.tasks || []).filter((t) => t.done).length;

  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <div className="grid grid-main">
        <Card title="Tâches à cocher" subtitle={`${doneCount} / ${data?.tasks.length || 0} réalisées pour la période en cours`}
          actions={<Button size="sm" icon="plus" onClick={() => setAdding(true)}>Ajouter une tâche</Button>}>
          <Field label="Réalisé par" className="section" ><input value={who} onChange={(e) => setWho(e.target.value)} style={{ maxWidth: 280 }} /></Field>
          {zones.map((z) => (
            <div key={z} className="section">
              <h3 className="h3 muted">{z}</h3>
              {data.tasks.filter((t) => t.zone === z).map((t) => (
                <div key={t.id} className={`task ${t.done ? 'is-done' : ''}`}>
                  <button type="button" className="task__check" aria-label={t.done ? 'Réalisée' : 'Cocher la tâche'} disabled={t.done || busy}
                    onClick={() => run(async () => { await api.post(path(`/cleaning/${t.id}/done`), { done_by: who }); reload(true); logs.reload(true); })}>
                    <Icon name="check" size={16} strokeWidth={3} />
                  </button>
                  <div className="grow">
                    <div className="task__name">{t.name}</div>
                    <div className="tiny muted">{FREQ[t.frequency]}{t.last && ` · dernière fois ${dateTime(t.last.done_at)} par ${t.last.done_by}`}</div>
                  </div>
                  <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer la tâche" onClick={() => run(async () => { await api.del(path(`/cleaning/${t.id}`)); reload(true); })} />
                </div>
              ))}
            </div>
          ))}
          {!zones.length && <Empty icon="broom" title="Aucune tâche de nettoyage" />}
        </Card>
        <Card title="Historique" pad={false} actions={<div className="row">
          <input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} style={{ width: 'auto' }} aria-label="Du" />
          <input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} style={{ width: 'auto' }} aria-label="Au" />
        </div>}>
          <div className="list" style={{ padding: '0 20px 10px', maxHeight: 560, overflowY: 'auto' }}>
            {(logs.data?.logs || []).map((l) => (
              <div key={l.id} className="list__item">
                <span className="list__icon list__icon--success"><Icon name="check" size={16} /></span>
                <span className="grow small"><strong>{l.task_name}</strong><div className="muted tiny">{l.zone} · {date(l.done_at)} à {time(l.done_at)} · {l.done_by}</div></span>
              </div>
            ))}
            {!logs.data?.logs.length && <p className="muted small pad">Aucun nettoyage sur la période.</p>}
          </div>
        </Card>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouvelle tâche de nettoyage" size="sm"
        footer={<Button variant="primary" loading={busy} onClick={() => run(async () => { await api.post(path('/cleaning'), form); setAdding(false); setForm({ zone: '', name: '', frequency: 'quotidienne' }); reload(true); }, 'Tâche ajoutée')}>Ajouter</Button>}>
        <div className="stack">
          <Field label="Zone"><input list="zones" value={form.zone} onChange={(e) => setForm({ ...form, zone: e.target.value })} placeholder="Cuisine, Salle, Stockage…" /><datalist id="zones">{zones.map((z) => <option key={z} value={z} />)}</datalist></Field>
          <Field label="Tâche"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Fréquence">
            <select value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              {Object.entries(FREQ).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
        </div>
      </Modal>
    </>
  );
}

// ---------------- Allergènes ----------------
function Allergens() {
  const { path } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/dishes')));
  if (loading && !data) return <Spinner />;
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false} title="Allergènes par plat" subtitle="Calculés automatiquement à partir des fiches techniques (14 allergènes réglementaires)"
        actions={<Button size="sm" icon="file" onClick={() => window.print()}>Imprimer</Button>}>
        <div className="table-wrap">
          <table className="table allergen-grid">
            <thead>
              <tr><th>Plat</th>{data.allergens.map((a) => <th key={a} className="rot">{a}</th>)}</tr>
            </thead>
            <tbody>
              {data.dishes.map((d) => (
                <tr key={d.id}>
                  <td><strong>{d.name}</strong><div className="tiny muted only-mobile">{d.allergens.join(', ') || 'Aucun'}</div></td>
                  {data.allergens.map((a) => <td key={a} className="dot">{d.allergens.includes(a) ? <span className="allergen-dot" title={a} aria-label={a} /> : ''}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

// ---------------- Archive ----------------
function Archive() {
  const { path, est } = useEst();
  const [range, setRange] = useState({ from: addDays(todayIso(), -30), to: todayIso() });
  const [run, busy] = useAction();
  const go = (format) => run(() => download(path(`/haccp/export?from=${range.from}&to=${range.to}&format=${format}`), `controle-haccp.${format}`), 'Export téléchargé');
  return (
    <Card title="Archive pour un contrôle" subtitle="Relevés de température, nettoyages, dates limites, factures fournisseurs et allergènes réunis dans un seul document.">
      <div className="stack">
        <div className="row">
          <Field label="Du"><input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Au"><input type="date" value={range.to} min={range.from} max={todayIso()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></Field>
        </div>
        <div className="row">
          <Button variant="primary" size="lg" icon="download" loading={busy} onClick={() => go('pdf')}>Exporter le dossier (PDF)</Button>
          <Button icon="download" loading={busy} onClick={() => go('xlsx')}>Exporter en tableur</Button>
        </div>
        <p className="small muted">{est.name} · les photos des factures restent consultables dans la section Factures.</p>
      </div>
    </Card>
  );
}

const TABS = [
  { value: 'temperatures', label: 'Températures', icon: 'thermo' },
  { value: 'dates', label: 'Dates limites', icon: 'tag' },
  { value: 'nettoyage', label: 'Plan de nettoyage', icon: 'broom' },
  { value: 'allergenes', label: 'Allergènes', icon: 'wheat' },
  { value: 'archive', label: 'Archive', icon: 'archive' },
];

export default function Haccp() {
  const { tab } = useParams();
  const navigate = useNavigate();
  const current = TABS.some((t) => t.value === tab) ? tab : 'temperatures';
  return (
    <>
      <PageHeader title="HACCP" subtitle="Plan de maîtrise sanitaire, sans aucun matériel." />
      <Tabs value={current} onChange={(v) => navigate(`/restaurateur/haccp/${v}`)} tabs={TABS} />
      {current === 'temperatures' && <Temperatures />}
      {current === 'dates' && <Dates />}
      {current === 'nettoyage' && <Cleaning />}
      {current === 'allergenes' && <Allergens />}
      {current === 'archive' && <Archive />}
    </>
  );
}
