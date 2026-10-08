import { useState } from 'react';
import { Link, Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import AppShell from '../../AppShell.jsx';
import { api, download } from '../../api.js';
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Icon, Modal, PageHeader, PasswordReveal, PeriodPicker, Spinner, Stat, Tabs, periodRange, useAction, useLoad } from '../../ui.jsx';
import { eur, date, minutes, todayIso, addDays } from '../../format.js';

// ---------------- Liste des clients ----------------
function Clients() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.get('/api/comptable/clients'));
  const [adding, setAdding] = useState(false);
  const [created, setCreated] = useState(null);
  const [remove, setRemove] = useState(null);
  const empty = { company: '', first_name: '', last_name: '', email: '', phone: '', establishment_name: '', address: '' };
  const [form, setForm] = useState(empty);
  const [q, setQ] = useState('');
  const [run, busy] = useAction();
  if (loading && !data) return <Spinner />;
  const clients = (data?.clients || []).filter((c) => `${c.company} ${c.first_name} ${c.last_name}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader title="Mes clients restaurateurs" subtitle={`${data?.clients.length || 0} client(s) suivi(s)`}
        actions={<Button variant="primary" icon="plus" onClick={() => { setCreated(null); setAdding(true); }}>Ajouter un client</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      {data?.clients.length > 4 && <input placeholder="Rechercher un client…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 320, marginBottom: 16 }} />}
      {!clients.length ? <Card><Empty icon="users" title="Aucun client">Ajoutez votre premier client restaurateur : il recevra ses identifiants de connexion.</Empty></Card> : (
        <div className="grid grid-3">
          {clients.map((c) => (
            <Card key={c.id} className="client-card">
              <div onClick={() => navigate(`/comptable/clients/${c.id}`)} role="link" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && navigate(`/comptable/clients/${c.id}`)} className="stack-sm">
                <div className="row row--between">
                  <strong>{c.company}</strong>
                  <Icon name="right" size={18} className="muted" />
                </div>
                <div className="small muted">{c.first_name} {c.last_name} · {c.email}</div>
                <div className="chips">{c.establishments.map((e) => <Badge key={e.id} icon="building">{e.name}</Badge>)}</div>
                <div className="tiny muted">{c.last_invoice ? `Dernière facture traitée le ${date(c.last_invoice)}` : 'Aucune facture pour le moment'}</div>
              </div>
              <div className="row row--between">
                {c.invoices_to_check > 0 ? <Badge tone="warning">{c.invoices_to_check} facture(s) à payer</Badge> : <span />}
                <Button size="sm" variant="ghost" onClick={() => setRemove(c)}>Retirer</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Modal open={adding} onClose={() => setAdding(false)} title={created ? 'Compte créé' : 'Nouveau client restaurateur'}
        footer={created ? <Button variant="primary" onClick={() => setAdding(false)}>Terminé</Button> : <><Button variant="ghost" onClick={() => setAdding(false)}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => run(async () => {
          const r = await api.post('/api/comptable/clients', form);
          setCreated({ email: r.client.email, password: r.password });
          setForm(empty);
          reload(true);
        }, 'Client ajouté')}>Créer le compte</Button></>}>
        {created ? <PasswordReveal {...created} /> : (
          <div className="form-grid">
            <Field label="Entreprise (raison sociale)" className="span-2"><input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></Field>
            <Field label="Prénom du gérant"><input value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} /></Field>
            <Field label="Nom"><input value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} /></Field>
            <Field label="Email (identifiant de connexion)"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Téléphone"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            <Field label="Premier établissement" hint="Vide : nom de l'entreprise"><input value={form.establishment_name} onChange={(e) => setForm({ ...form, establishment_name: e.target.value })} /></Field>
            <Field label="Adresse"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Confirm open={!!remove} title={`Retirer ${remove?.company} ?`} confirmLabel="Retirer le client" busy={busy} onClose={() => setRemove(null)}
        onConfirm={() => run(async () => { await api.del(`/api/comptable/clients/${remove.id}`); setRemove(null); reload(true); }, 'Client retiré')}>
        <p className="small">Le compte du restaurateur et ceux de ses collaborateurs seront désactivés : ils ne pourront plus se connecter. Les données sont conservées pour les obligations légales d'archivage.</p>
      </Confirm>
    </>
  );
}

// ---------------- Fiche client (lecture seule) ----------------
function Expenses({ data }) {
  const [cat, setCat] = useState(null);
  const list = data.expenses.filter((e) => !cat || e.category === cat);
  return (
    <div className="stack">
      <Card title="Dépenses classées par catégorie" pad={false}>
        <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th>Catégorie</th><th className="num">Pièces</th><th className="num">HT</th><th className="num">TVA</th><th className="num">TTC</th></tr></thead>
            <tbody>
              {data.by_category.map((c) => (
                <tr key={c.category} className={`is-clickable ${cat === c.category ? 'row-warning' : ''}`} onClick={() => setCat(cat === c.category ? null : c.category)}>
                  <td data-label="Catégorie" className="strong">{c.category}</td>
                  <td data-label="Pièces" className="num">{c.count}</td>
                  <td data-label="HT" className="num">{eur(c.ht)}</td>
                  <td data-label="TVA" className="num">{eur(c.tva)}</td>
                  <td data-label="TTC" className="num">{eur(c.ttc)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="num">{data.expenses.length}</td><td className="num">{eur(data.totals.ht)}</td><td className="num">{eur(data.totals.tva)}</td><td className="num">{eur(data.totals.ttc)}</td></tr></tfoot>
          </table>
        </div>
      </Card>
      <Card title={cat ? `Détail : ${cat}` : 'Détail des pièces'} pad={false} actions={cat && <Button size="sm" variant="ghost" onClick={() => setCat(null)}>Tout afficher</Button>}>
        {!list.length ? <Empty icon="receipt" title="Aucune dépense sur la période" /> : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th>Date</th><th>Type</th><th>Libellé</th><th>Catégorie</th><th className="num">HT</th><th className="num">TVA</th><th className="num">TTC</th><th>Pièce</th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={`${e.kind}${e.id}`}>
                    <td data-label="Date">{date(e.date)}</td>
                    <td data-label="Type"><Badge tone={e.kind === 'Note de frais' ? 'info' : 'neutral'}>{e.kind}</Badge></td>
                    <td data-label="Libellé">{e.label}<div className="tiny muted">{e.establishment}</div></td>
                    <td data-label="Catégorie">{e.category}</td>
                    <td data-label="HT" className="num">{eur(e.ht)}</td>
                    <td data-label="TVA" className="num">{eur(e.tva)}</td>
                    <td data-label="TTC" className="num strong">{eur(e.ttc)}</td>
                    <td data-label="Pièce">{e.photo_path ? <a href={`/api/files/${e.photo_path}`} target="_blank" rel="noreferrer">Photo</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Vat({ data }) {
  const v = data.vat;
  return (
    <div className="grid grid-2">
      <Card title="TVA à reverser — pré-calcul" subtitle="Indicatif, à vérifier avant déclaration">
        <div className="vat-box">
          <div className="vat-line"><span className="muted">Chiffre d'affaires HT déclaré</span><span>{eur(v.revenue_ht)}</span></div>
          <div className="vat-line"><span>TVA collectée (ventes)</span><strong>{eur(v.collected)}</strong></div>
          <div className="vat-line"><span>TVA déductible (factures et notes de frais)</span><strong>− {eur(v.deductible)}</strong></div>
          <div className={`vat-line vat-line--total ${v.due < 0 ? 'text-success' : ''}`}><span>{v.due >= 0 ? 'TVA à reverser' : 'Crédit de TVA'}</span><span>{eur(Math.abs(v.due))}</span></div>
        </div>
      </Card>
      <Card title="TVA déductible par catégorie">
        <div className="vat-box">
          {data.by_category.filter((c) => c.tva).map((c) => (
            <div key={c.category} className="vat-line"><span>{c.category}</span><span>{eur(c.tva)}</span></div>
          ))}
          {!data.by_category.some((c) => c.tva) && <p className="muted small">Aucune TVA déductible sur la période.</p>}
        </div>
      </Card>
    </div>
  );
}

function Hours({ data }) {
  return (
    <Card title="Heures effectuées par collaborateur" subtitle="Heures pointées et validées par le restaurateur (sans calcul de salaire ni de charges)" pad={false}>
      {!data.hours.length ? <Empty icon="clock" title="Aucune heure sur la période" /> : (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th>Collaborateur</th><th>Établissement</th><th className="num">Jours</th><th className="num">Prévues</th><th className="num">Pointées</th><th className="num">Validées</th></tr></thead>
            <tbody>
              {data.hours.map((h) => (
                <tr key={h.id}>
                  <td data-label="Collaborateur"><strong>{h.name}</strong><div className="tiny muted">{h.job_title}</div></td>
                  <td data-label="Établissement">{h.establishment}</td>
                  <td data-label="Jours" className="num">{h.days_worked}</td>
                  <td data-label="Prévues" className="num">{minutes(h.planned_minutes)}</td>
                  <td data-label="Pointées" className="num">{minutes(h.worked_minutes)}</td>
                  <td data-label="Validées" className="num strong">{minutes(h.validated_minutes)}{h.validated_minutes < h.worked_minutes - 1 && <div className="tiny text-warning">validation incomplète</div>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td /><td className="num">{minutes(data.hours.reduce((s, h) => s + h.planned_minutes, 0))}</td><td className="num">{minutes(data.hours.reduce((s, h) => s + h.worked_minutes, 0))}</td><td className="num">{minutes(data.hours.reduce((s, h) => s + h.validated_minutes, 0))}</td></tr></tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function Due({ data }) {
  return (
    <Card title="Échéances de paiement à venir" subtitle="Factures fournisseurs validées non encore payées" pad={false}>
      {!data.due_payments.length ? <Empty icon="check" title="Aucune échéance en attente" /> : (
        <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th>Échéance</th><th>Fournisseur</th><th>N° facture</th><th>Établissement</th><th className="num">Montant TTC</th><th>Statut</th></tr></thead>
            <tbody>
              {data.due_payments.map((d) => (
                <tr key={d.id} className={d.overdue ? 'row-danger' : d.soon ? 'row-warning' : ''}>
                  <td data-label="Échéance" className="strong">{date(d.due_date)}</td>
                  <td data-label="Fournisseur">{d.supplier}</td>
                  <td data-label="N°">{d.invoice_number || '—'}</td>
                  <td data-label="Établissement">{d.establishment}</td>
                  <td data-label="Montant" className="num strong">{eur(d.ttc)}</td>
                  <td data-label="Statut">{d.overdue ? <Badge tone="danger">En retard</Badge> : d.soon ? <Badge tone="warning">Sous 15 jours</Badge> : <Badge>À venir</Badge>}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td /><td /><td className="num">{eur(data.due_payments.reduce((s, d) => s + d.ttc, 0))}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function ClientDetail() {
  const { id } = useParams();
  const [period, setPeriod] = useState({ kind: 'month', ...periodRange('month', addDays(`${todayIso().slice(0, 7)}-01`, -1)) });
  const [estId, setEstId] = useState('');
  const [tab, setTab] = useState('depenses');
  const [run, busy] = useAction();
  const q = `from=${period.from}&to=${period.to}${estId ? `&establishment=${estId}` : ''}`;
  const { data, error, loading, reload } = useLoad(() => api.get(`/api/comptable/clients/${id}?${q}`), [id, q]);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const exp = (format) => run(() => download(`/api/comptable/clients/${id}/export?${q}&format=${format}`, `export.${format}`), 'Export téléchargé');

  return (
    <>
      <PageHeader
        back={<Link to="/comptable" className="backlink"><Icon name="left" size={16} /> Mes clients</Link>}
        title={data.client.company}
        subtitle={<span className="row" style={{ gap: 8 }}>{data.client.first_name} {data.client.last_name} · {data.client.email} <span className="readonly-banner"><Icon name="eye" size={14} /> Consultation seule</span></span>}
        actions={<>
          <Button icon="download" loading={busy} onClick={() => exp('pdf')}>Export PDF</Button>
          <Button icon="download" loading={busy} onClick={() => exp('xlsx')}>Export tableur</Button>
        </>}
      />
      <div className="row" style={{ marginBottom: 18 }}>
        <PeriodPicker value={period} onChange={setPeriod} kinds={['month', 'week', 'custom']} />
        {data.all_establishments.length > 1 && (
          <select value={estId} onChange={(e) => setEstId(e.target.value)} style={{ width: 'auto' }} aria-label="Établissement">
            <option value="">Tous les établissements</option>
            {data.all_establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
        <span className="small muted">Du {date(period.from)} au {date(period.to)}</span>
      </div>
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <Stat label="Dépenses HT" value={eur(data.totals.ht)} sub={`${data.expenses.length} pièce(s)`} icon="receipt" />
        <Stat label={data.vat.due >= 0 ? 'TVA à reverser' : 'Crédit de TVA'} value={eur(Math.abs(data.vat.due))} sub="pré-calcul" icon="pie" />
        <Stat label="Heures pointées" value={minutes(data.hours.reduce((s, h) => s + h.worked_minutes, 0))} sub={`${data.hours.length} collaborateur(s)`} icon="clock" />
        <Stat label="Échéances à payer" value={eur(data.due_payments.reduce((s, d) => s + d.ttc, 0))} sub={`${data.due_payments.filter((d) => d.overdue).length} en retard`} tone={data.due_payments.some((d) => d.overdue) ? 'danger' : undefined} icon="calendar" />
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'depenses', label: 'Dépenses', icon: 'receipt' },
        { value: 'tva', label: 'TVA', icon: 'pie' },
        { value: 'heures', label: 'Heures', icon: 'clock' },
        { value: 'echeances', label: 'Échéances', icon: 'calendar', count: data.due_payments.filter((d) => d.overdue).length },
      ]} />
      {tab === 'depenses' && <Expenses data={data} />}
      {tab === 'tva' && <Vat data={data} />}
      {tab === 'heures' && <Hours data={data} />}
      {tab === 'echeances' && <Due data={data} />}
    </>
  );
}

export default function ComptableApp() {
  const nav = [{ to: '/comptable', end: true, label: 'Mes clients', icon: 'users' }];
  return (
    <AppShell nav={nav} mobileNav={nav} spaceLabel="Espace comptable">
      <Routes>
        <Route index element={<Clients />} />
        <Route path="clients/:id" element={<ClientDetail />} />
        <Route path="*" element={<Navigate to="/comptable" replace />} />
      </Routes>
    </AppShell>
  );
}
