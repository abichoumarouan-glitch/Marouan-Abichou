import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Modal, Notice, PageHeader, PhotoButton, Spinner, Tabs, useAction, useLoad } from '../../ui.jsx';
import { eur, date, todayIso } from '../../format.js';

export function InvoiceStatus({ inv }) {
  if (inv.status === 'brouillon') return <Badge tone="warning" icon="edit">À vérifier</Badge>;
  if (inv.paid_at) return <Badge tone="success" icon="check">Payée</Badge>;
  if (inv.due_date && inv.due_date < todayIso()) return <Badge tone="danger">Échue le {date(inv.due_date)}</Badge>;
  return <Badge tone="accent">Validée</Badge>;
}

function InvoiceList() {
  const { path } = useEst();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [filter, setFilter] = useState('all');
  const [run] = useAction();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/invoices')));

  const create = (file) => run(async () => {
    const fd = new FormData();
    if (file) fd.append('photo', file);
    const { invoice } = await api.post(path('/invoices'), fd);
    navigate(`/restaurateur/factures/${invoice.id}`);
  });

  const list = (data?.invoices || []).filter((i) => filter === 'all' || i.status === filter);
  const drafts = (data?.invoices || []).filter((i) => i.status === 'brouillon').length;

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <PhotoButton onFile={create} size="lg" className={params.get('photo') ? 'pulse-ring' : ''}>Photographier une facture</PhotoButton>
        <PhotoButton onFile={create} variant="secondary" icon="upload" capture={undefined}>Importer une photo</PhotoButton>
        <Button variant="ghost" icon="edit" onClick={() => create(null)}>Saisie manuelle</Button>
      </div>
      {data && !data.ai && (
        <Notice tone="info" icon="sparkles">
          La lecture automatique des photos n'est pas configurée sur ce serveur (clé <code>ANTHROPIC_API_KEY</code>). Les photos sont conservées et les lignes se saisissent à la main.
        </Notice>
      )}
      <Card pad={false} className="section">
        <div className="card__head">
          <Tabs value={filter} onChange={setFilter} tabs={[
            { value: 'all', label: 'Toutes' },
            { value: 'brouillon', label: 'À vérifier', count: drafts },
            { value: 'validee', label: 'Validées' },
          ]} />
        </div>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !list.length ? (
          <Empty icon="receipt" title="Aucune facture">Prenez en photo votre première facture fournisseur.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th>Livraison</th><th>Fournisseur</th><th>N°</th><th className="num">Lignes</th><th className="num">Total HT</th><th>Statut</th><th>Échéance</th></tr></thead>
              <tbody>
                {list.map((i) => (
                  <tr key={i.id} className="is-clickable" onClick={() => navigate(`/restaurateur/factures/${i.id}`)}>
                    <td data-label="Livraison">{date(i.delivery_date || i.invoice_date || i.created_at)}</td>
                    <td data-label="Fournisseur" className="strong">{i.supplier_name || <span className="muted">Fournisseur à préciser</span>}</td>
                    <td data-label="N°">{i.invoice_number || '—'}</td>
                    <td data-label="Lignes" className="num">{i.line_count}</td>
                    <td data-label="Total HT" className="num">{i.status === 'validee' ? eur(i.total_ht) : '—'}</td>
                    <td data-label="Statut"><InvoiceStatus inv={i} /></td>
                    <td data-label="Échéance">{i.due_date ? date(i.due_date) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

function ExpenseReports() {
  const { path } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/expenses')));
  const [open, setOpen] = useState(false);
  const [del, setDel] = useState(null);
  const [form, setForm] = useState({ date: todayIso(), label: '', amount_ttc: '', vat_amount: '', category: '' });
  const [photo, setPhoto] = useState(null);
  const [run, busy] = useAction();

  const submit = () => run(async () => {
    const fd = new FormData();
    Object.entries(form).forEach(([k, v]) => fd.append(k, v));
    if (photo) fd.append('photo', photo);
    await api.post(path('/expenses'), fd);
    setOpen(false);
    setForm({ date: todayIso(), label: '', amount_ttc: '', vat_amount: '', category: '' });
    setPhoto(null);
    reload(true);
  }, 'Note de frais enregistrée');

  return (
    <>
      <div className="row" style={{ marginBottom: 16 }}>
        <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>Ajouter une note de frais</Button>
      </div>
      <Card pad={false}>
        <ErrorBox error={error} onRetry={reload} />
        {loading && !data ? <Spinner /> : !data?.expenses.length ? (
          <Empty icon="file" title="Aucune note de frais" />
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th>Date</th><th>Libellé</th><th>Catégorie</th><th className="num">TTC</th><th className="num">TVA</th><th>Justificatif</th><th /></tr></thead>
              <tbody>
                {data.expenses.map((e) => (
                  <tr key={e.id}>
                    <td data-label="Date">{date(e.date)}</td>
                    <td data-label="Libellé" className="strong">{e.label}</td>
                    <td data-label="Catégorie"><Badge>{e.category}</Badge></td>
                    <td data-label="TTC" className="num">{eur(e.amount_ttc)}</td>
                    <td data-label="TVA" className="num">{eur(e.vat_amount)}</td>
                    <td data-label="Justificatif">{e.photo_path ? <a href={`/api/files/${e.photo_path}`} target="_blank" rel="noreferrer">Voir</a> : '—'}</td>
                    <td className="actions"><Button size="sm" variant="ghost" icon="trash" aria-label="Supprimer" onClick={() => setDel(e)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Modal open={open} onClose={() => setOpen(false)} title="Nouvelle note de frais"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Annuler</Button><Button variant="primary" loading={busy} onClick={submit}>Enregistrer</Button></>}>
        <div className="form-grid">
          <Field label="Date"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
          <Field label="Catégorie" hint="Vide : classement automatique">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Automatique</option>
              {(data?.categories || []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Libellé" className="span-2"><input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Ex. : Carburant livraison traiteur" /></Field>
          <Field label="Montant TTC"><div className="input-suffix"><input inputMode="decimal" value={form.amount_ttc} onChange={(e) => setForm({ ...form, amount_ttc: e.target.value })} /><span>€</span></div></Field>
          <Field label="Dont TVA"><div className="input-suffix"><input inputMode="decimal" value={form.vat_amount} onChange={(e) => setForm({ ...form, vat_amount: e.target.value })} /><span>€</span></div></Field>
          <div className="span-2 row">
            <PhotoButton variant="secondary" onFile={async (f) => setPhoto(f)}>{photo ? 'Changer le justificatif' : 'Photographier le justificatif'}</PhotoButton>
            {photo && <span className="small muted">Photo ajoutée</span>}
          </div>
        </div>
      </Modal>
      <Confirm open={!!del} title="Supprimer la note de frais ?" onClose={() => setDel(null)} busy={busy}
        onConfirm={() => run(async () => { await api.del(path(`/expenses/${del.id}`)); setDel(null); reload(true); }, 'Note de frais supprimée')}>
        {del?.label} — {eur(del?.amount_ttc)}
      </Confirm>
    </>
  );
}

export default function Invoices() {
  const [tab, setTab] = useState('invoices');
  return (
    <>
      <PageHeader title="Factures" subtitle="Photographiez vos factures fournisseurs : chaque ligne est lue, vérifiée puis reliée à vos ingrédients." />
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'invoices', label: 'Factures fournisseurs', icon: 'receipt' }, { value: 'expenses', label: 'Notes de frais', icon: 'file' }]} />
      {tab === 'invoices' ? <InvoiceList /> : <ExpenseReports />}
    </>
  );
}
