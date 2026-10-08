import { useState } from 'react';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Icon, Modal, Notice, PageHeader, Spinner, Tabs, useAction, useLoad, useToast } from '../../ui.jsx';
import { date, todayIso } from '../../format.js';

const STATUS = {
  a_valider: { label: 'À valider', tone: 'warning' },
  validee: { label: 'Validé — à publier', tone: 'accent' },
  refusee: { label: 'Refusé', tone: 'neutral' },
  publiee: { label: 'Publié', tone: 'success' },
};

function ContentCard({ c, onChange }) {
  const { path, refreshBadges } = useEst();
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState({ title: c.title, body: c.body, planned_for: c.planned_for || '' });
  const [run, busy] = useAction();
  const act = (url, msg) => run(async () => { await api.post(path(url), url.endsWith('decide') ? undefined : {}); refreshBadges?.(); onChange(); }, msg);
  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Badge tone="info">{c.channel}</Badge>{c.title}</span>}
      subtitle={`${c.source === 'ia' ? 'Proposé par l’IA' : 'Proposé par Mizu'} · ${c.planned_for ? `publication suggérée le ${date(c.planned_for)}` : 'date libre'}`}
      actions={<Badge tone={STATUS[c.status].tone}>{STATUS[c.status].label}</Badge>}>
      {edit ? (
        <div className="stack">
          <Field label="Titre"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Texte"><textarea rows={6} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <Field label="Date de publication prévue"><input type="date" value={form.planned_for} onChange={(e) => setForm({ ...form, planned_for: e.target.value })} /></Field>
          <div className="row"><Button variant="ghost" onClick={() => setEdit(false)}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => run(async () => { await api.put(path(`/marketing/contents/${c.id}`), form); setEdit(false); onChange(); }, 'Contenu modifié')}>Enregistrer</Button></div>
        </div>
      ) : <p style={{ whiteSpace: 'pre-wrap' }}>{c.body}</p>}
      {!edit && (
        <div className="row section">
          {c.status === 'a_valider' && <>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(true)}>Modifier</Button>
            <Button size="sm" variant="ghost" icon="x" loading={busy} onClick={() => run(async () => { await api.post(path(`/marketing/contents/${c.id}/decide`), { decision: 'refusee' }); refreshBadges?.(); onChange(); }, 'Contenu refusé')}>Refuser</Button>
            <Button size="sm" variant="success" icon="check" loading={busy} onClick={() => run(async () => { await api.post(path(`/marketing/contents/${c.id}/decide`), { decision: 'validee' }); refreshBadges?.(); onChange(); }, 'Contenu validé')}>Valider</Button>
          </>}
          {c.status === 'validee' && <>
            <Button size="sm" variant="ghost" icon="copy" onClick={() => navigator.clipboard?.writeText(c.body).then(() => toast('Texte copié : collez-le sur le réseau social'))}>Copier le texte</Button>
            <Button size="sm" variant="ghost" icon="edit" onClick={() => setEdit(true)}>Modifier</Button>
            <Button size="sm" variant="primary" icon="check" loading={busy} onClick={() => act(`/marketing/contents/${c.id}/published`, 'Marqué comme publié')}>J’ai publié ce contenu</Button>
          </>}
          {c.status === 'publiee' && <span className="small muted">Publié le {date(c.published_at)}</span>}
        </div>
      )}
    </Card>
  );
}

export default function Marketing() {
  const { path, refreshBadges } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/marketing')));
  const [tab, setTab] = useState('contents');
  const [filter, setFilter] = useState('a_valider');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', due_date: '' });
  const [run, busy] = useAction();
  if (loading && !data) return <Spinner />;
  const contents = (data?.contents || []).filter((c) => filter === 'all' || c.status === filter);
  const todo = (data?.tasks || []).filter((t) => t.status === 'a_faire');
  const done = (data?.tasks || []).filter((t) => t.status === 'faite');
  const counts = Object.fromEntries(Object.keys(STATUS).map((k) => [k, (data?.contents || []).filter((c) => c.status === k).length]));

  return (
    <>
      <PageHeader title="Marketing" subtitle="Vos tâches marketing et les contenus proposés. Rien n’est jamais publié automatiquement."
        actions={tab === 'contents'
          ? <Button variant="primary" icon="sparkles" loading={busy} onClick={() => run(async () => { await api.post(path('/marketing/propose')); refreshBadges?.(); setFilter('a_valider'); await reload(true); }, 'Nouveaux contenus proposés')}>Proposer des contenus</Button>
          : <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Nouvelle tâche</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'contents', label: 'Contenus', icon: 'megaphone', count: counts.a_valider },
        { value: 'tasks', label: 'Tâches', icon: 'list', count: todo.length },
      ]} />
      {tab === 'contents' ? (
        <>
          <div className="chips" style={{ marginBottom: 14 }}>
            {[['a_valider', 'À valider'], ['validee', 'À publier'], ['publiee', 'Publiés'], ['refusee', 'Refusés'], ['all', 'Tous']].map(([k, l]) => (
              <button key={k} type="button" className={`chip ${filter === k ? 'is-active' : ''}`} onClick={() => setFilter(k)}>{l}{k !== 'all' && counts[k] ? ` (${counts[k]})` : ''}</button>
            ))}
          </div>
          {!data.ai && <Notice tone="info" icon="sparkles">Propositions générées à partir de modèles : configurez la clé IA sur le serveur pour des contenus personnalisés.</Notice>}
          <div className="grid grid-2 section">
            {contents.map((c) => <ContentCard key={c.id} c={c} onChange={() => reload(true)} />)}
          </div>
          {!contents.length && <Card><Empty icon="megaphone" title="Aucun contenu ici" /></Card>}
        </>
      ) : (
        <div className="grid grid-2">
          <Card title={`À faire (${todo.length})`}>
            {!todo.length && <p className="muted small">Aucune tâche à faire.</p>}
            {todo.map((t) => (
              <div key={t.id} className="task">
                <button type="button" className="task__check" aria-label="Marquer comme faite" onClick={() => run(async () => { await api.put(path(`/marketing/tasks/${t.id}`), { status: 'faite' }); reload(true); })}><Icon name="check" size={16} strokeWidth={3} /></button>
                <div className="grow">
                  <div className="task__name">{t.title}</div>
                  <div className="tiny muted">{t.description}{t.due_date && <> · <span className={t.due_date < todayIso() ? 'text-danger' : ''}>échéance {date(t.due_date)}</span></>}</div>
                </div>
                <Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" onClick={() => run(async () => { await api.del(path(`/marketing/tasks/${t.id}`)); reload(true); })} />
              </div>
            ))}
          </Card>
          <Card title={`Déjà faites (${done.length})`}>
            {!done.length && <p className="muted small">Rien pour le moment.</p>}
            {done.map((t) => (
              <div key={t.id} className="task is-done">
                <button type="button" className="task__check" aria-label="Remettre à faire" onClick={() => run(async () => { await api.put(path(`/marketing/tasks/${t.id}`), { status: 'a_faire' }); reload(true); })} style={{ cursor: 'pointer' }}><Icon name="check" size={16} strokeWidth={3} /></button>
                <div className="grow"><div className="task__name">{t.title}</div><div className="tiny muted">Faite le {date(t.done_at)}</div></div>
              </div>
            ))}
          </Card>
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title="Nouvelle tâche marketing" size="sm"
        footer={<Button variant="primary" loading={busy} onClick={() => run(async () => { await api.post(path('/marketing/tasks'), form); setAdding(false); setForm({ title: '', description: '', due_date: '' }); reload(true); }, 'Tâche ajoutée')}>Ajouter</Button>}>
        <div className="stack">
          <Field label="Tâche"><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Détails"><textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="Échéance"><input type="date" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
