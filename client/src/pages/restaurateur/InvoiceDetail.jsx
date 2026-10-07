import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Confirm, ErrorBox, Field, Icon, Modal, Notice, PageHeader, Spinner, useAction, useLoad, useToast } from '../../ui.jsx';
import { InvoiceStatus } from './Invoices.jsx';
import { eur, date, num, todayIso, UNIT_LABELS, BASE_LABELS } from '../../format.js';

const UNITS = ['kg', 'l', 'piece', 'carton'];
const DEFAULT_BASE = { kg: 'g', l: 'ml', piece: 'piece', carton: 'piece' };
const NUM_FIELDS = ['quantity', 'purchase_price_ht', 'tva_rate', 'conversion'];
const frLine = (l) => ({ ...l, ...Object.fromEntries(NUM_FIELDS.map((k) => [k, l[k] == null ? '' : String(l[k]).replace('.', ',')])) });

function NewIngredientModal({ line, open, onClose, onCreate, allergens }) {
  const [form, setForm] = useState({ name: '', base_unit: 'g', category: '', allergens: [] });
  useEffect(() => {
    if (open) setForm({ name: line.product_name.replace(/\s+x?\d+\s*(g|kg|cl|l|ml)?$/i, '').trim(), base_unit: DEFAULT_BASE[line.unit] || 'g', category: '', allergens: [] });
  }, [open, line]);
  const toggle = (a) => setForm((f) => ({ ...f, allergens: f.allergens.includes(a) ? f.allergens.filter((x) => x !== a) : [...f.allergens, a] }));
  return (
    <Modal open={open} onClose={onClose} title="Créer un ingrédient"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" onClick={() => onCreate(form)}>Créer et relier</Button></>}>
      <div className="stack">
        <p className="small muted">Produit de la facture : « {line.product_name} ». Les prochaines factures contenant ce produit seront reliées automatiquement.</p>
        <Field label="Nom de l'ingrédient"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></Field>
        <div className="form-grid">
          <Field label="Unité utilisée dans les fiches techniques">
            <select value={form.base_unit} onChange={(e) => setForm({ ...form, base_unit: e.target.value })}>
              <option value="g">Grammes (g)</option>
              <option value="ml">Millilitres (ml)</option>
              <option value="piece">Pièces</option>
            </select>
          </Field>
          <Field label="Catégorie"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Ex. : Crèmerie, Boissons…" /></Field>
        </div>
        <Field label="Allergènes">
          <div className="chips">
            {allergens.map((a) => <button type="button" key={a} className={`chip ${form.allergens.includes(a) ? 'is-active' : ''}`} onClick={() => toggle(a)}>{a}</button>)}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

function LineEditor({ line, ingredients, allergens, onSave, onDelete, readOnly }) {
  const [draft, setDraft] = useState(() => frLine(line));
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => setDraft(frLine(line)), [line]);

  // affichage avec virgule décimale ; on n'enregistre que si la valeur a réellement changé
  const commit = (field) => {
    const norm = (v) => String(v ?? '').trim().replace(',', '.');
    if (norm(draft[field]) !== norm(line[field])) onSave({ [field]: draft[field] });
  };
  const unitPrice = draft.quantity > 0 && draft.purchase_price_ht != null && draft.purchase_price_ht !== '' ? Number(String(draft.purchase_price_ht).replace(',', '.')) / Number(String(draft.quantity).replace(',', '.')) : null;
  const unlinked = !line.ingredient_id && !line.not_ingredient;

  if (readOnly) {
    return (
      <tr>
        <td data-label="Produit"><strong>{line.product_name}</strong>{line.ingredient_name ? <div className="tiny muted"><Icon name="link" size={12} /> {line.ingredient_name}</div> : line.not_ingredient ? <div className="tiny muted">Hors food cost</div> : null}</td>
        <td data-label="Quantité" className="num">{num(line.quantity)} {UNIT_LABELS[line.unit]}{line.quantity > 1 ? 's' : ''}</td>
        <td data-label="Prix unitaire HT" className="num">{eur(line.unit_price)} / {UNIT_LABELS[line.unit]}</td>
        <td data-label="Prix d'achat HT" className="num strong">{eur(line.purchase_price_ht)}</td>
        <td data-label="TVA" className="num">{num(line.tva_rate)} %</td>
      </tr>
    );
  }

  return (
    <div className={`line-card ${unlinked ? 'is-unlinked' : ''}`}>
      <div className="line-grid">
        <Field label="Produit"><input value={draft.product_name ?? ''} onChange={(e) => setDraft({ ...draft, product_name: e.target.value })} onBlur={() => commit('product_name')} /></Field>
        <Field label="Quantité"><input inputMode="decimal" value={draft.quantity ?? ''} onChange={(e) => setDraft({ ...draft, quantity: e.target.value })} onBlur={() => commit('quantity')} /></Field>
        <Field label="Unité">
          <select value={draft.unit ?? ''} onChange={(e) => { setDraft({ ...draft, unit: e.target.value }); onSave({ unit: e.target.value }); }}>
            <option value="" disabled>—</option>
            {UNITS.map((u) => <option key={u} value={u}>{UNIT_LABELS[u]}</option>)}
          </select>
        </Field>
        <Field label="Prix d'achat HT"><div className="input-suffix"><input inputMode="decimal" value={draft.purchase_price_ht ?? ''} onChange={(e) => setDraft({ ...draft, purchase_price_ht: e.target.value })} onBlur={() => commit('purchase_price_ht')} /><span>€</span></div></Field>
        <Field label="TVA"><div className="input-suffix"><input inputMode="decimal" value={draft.tva_rate ?? ''} onChange={(e) => setDraft({ ...draft, tva_rate: e.target.value })} onBlur={() => commit('tva_rate')} /><span>%</span></div></Field>
        <Button variant="ghost" icon="trash" aria-label="Supprimer la ligne" onClick={onDelete} />
      </div>
      <div className="row row--between small">
        <span className="muted">Prix unitaire : <strong className="nowrap">{unitPrice != null && Number.isFinite(unitPrice) ? `${eur(unitPrice)} / ${UNIT_LABELS[draft.unit] || 'unité'}` : '—'}</strong></span>
      </div>
      <div className="link-row">
        {line.ingredient_id ? (
          <>
            <Badge tone="success" icon="link">{line.ingredient_name}</Badge>
            {line.needs_conversion && (
              <span className="row" style={{ gap: 6 }}>
                1 {UNIT_LABELS[line.unit]} =
                <input style={{ width: 90 }} inputMode="decimal" value={draft.conversion ?? ''} placeholder="?" onChange={(e) => setDraft({ ...draft, conversion: e.target.value })} onBlur={() => commit('conversion')} />
                {BASE_LABELS[line.base_unit]}
                {!line.conversion && <Badge tone="warning">contenance à indiquer</Badge>}
              </span>
            )}
            <Button size="sm" variant="ghost" onClick={() => setChoosing(true)}>Changer</Button>
          </>
        ) : line.not_ingredient ? (
          <>
            <Badge>Hors food cost (non alimentaire)</Badge>
            <Button size="sm" variant="ghost" onClick={() => onSave({ not_ingredient: false })}>Annuler</Button>
          </>
        ) : (
          <>
            <span className="text-warning strong"><Icon name="link" size={15} /> Nouveau produit : reliez-le à un ingrédient</span>
            {line.suggestions?.map((s) => <button key={s.id} type="button" className="chip" onClick={() => onSave({ ingredient_id: s.id })}>{s.name}</button>)}
            <Button size="sm" variant="soft" onClick={() => setChoosing(true)}>Choisir…</Button>
            <Button size="sm" variant="soft" icon="plus" onClick={() => setCreating(true)}>Créer l'ingrédient</Button>
            <Button size="sm" variant="ghost" onClick={() => onSave({ not_ingredient: true })}>Pas un ingrédient</Button>
          </>
        )}
      </div>
      <Modal open={choosing} onClose={() => setChoosing(false)} title="Relier à un ingrédient" size="sm">
        <IngredientPicker ingredients={ingredients} onPick={(id) => { setChoosing(false); onSave({ ingredient_id: id }); }} onCreate={() => { setChoosing(false); setCreating(true); }} />
      </Modal>
      <NewIngredientModal line={line} open={creating} onClose={() => setCreating(false)} allergens={allergens}
        onCreate={(form) => { setCreating(false); onSave({ new_ingredient: form }); }} />
    </div>
  );
}

function IngredientPicker({ ingredients, onPick, onCreate }) {
  const [q, setQ] = useState('');
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = ingredients.filter((g) => norm(g.name).includes(norm(q)));
  return (
    <div className="stack">
      <input placeholder="Rechercher un ingrédient…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <div className="list" style={{ maxHeight: 320, overflowY: 'auto' }}>
        {list.map((g) => (
          <button key={g.id} type="button" className="list__item" style={{ border: 0, background: 'none', textAlign: 'left', cursor: 'pointer', borderBottom: '1px solid var(--line-2)' }} onClick={() => onPick(g.id)}>
            <span className="grow">{g.name}</span><span className="muted small">{BASE_LABELS[g.base_unit]}</span>
          </button>
        ))}
        {!list.length && <p className="muted small">Aucun ingrédient trouvé.</p>}
      </div>
      <Button icon="plus" onClick={onCreate}>Créer un nouvel ingrédient</Button>
    </div>
  );
}

export default function InvoiceDetail() {
  const { id } = useParams();
  const { path, refreshBadges } = useEst();
  const navigate = useNavigate();
  const toast = useToast();
  const [run, busy] = useAction();
  const [zoom, setZoom] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { data, error, loading, reload, setData } = useLoad(() => api.get(path(`/invoices/${id}`)), [id]);
  const ing = useLoad(() => api.get(path('/ingredients')));
  const [head, setHead] = useState({});
  useEffect(() => { if (data) setHead(data.invoice); }, [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const { invoice, lines } = data;
  const draft = invoice.status === 'brouillon';
  const update = (fn) => run(async () => setData({ ...data, ...(await fn()) }));
  const saveHead = (field) => {
    if ((head[field] ?? '') !== (invoice[field] ?? '')) update(() => api.put(path(`/invoices/${id}`), { [field]: head[field] }));
  };
  const saveLine = (lineId, body) => update(() => api.put(path(`/invoices/${id}/lines/${lineId}`), body)).then(() => body.new_ingredient && ing.reload(true));
  const unlinked = lines.filter((l) => !l.ingredient_id && !l.not_ingredient).length;

  const validate = () => run(async () => {
    const r = await api.post(path(`/invoices/${id}/validate`));
    setData({ ...data, ...r });
    refreshBadges?.();
    toast({ title: 'Facture validée', message: `${r.result.ingredients} ingrédient(s) mis à jour · ${r.result.recomputed} plat(s) recalculé(s).` });
  });

  return (
    <>
      <PageHeader
        back={<Link to="/restaurateur/factures" className="backlink"><Icon name="left" size={16} /> Factures</Link>}
        title={invoice.supplier_name || 'Nouvelle facture'}
        subtitle={<span className="row" style={{ gap: 8 }}><InvoiceStatus inv={invoice} />{invoice.invoice_number && <span>n° {invoice.invoice_number}</span>}</span>}
        actions={draft ? (
          <>
            {invoice.photo_path && data.ai && <Button icon="refresh" loading={busy} onClick={() => update(() => api.post(path(`/invoices/${id}/reread`)))}>Relire la photo</Button>}
            <Button variant="ghost" icon="trash" onClick={() => setConfirmDelete(true)}>Supprimer</Button>
            <Button variant="success" icon="check" loading={busy} onClick={validate}>Valider la facture</Button>
          </>
        ) : (
          invoice.paid_at
            ? <Button icon="x" onClick={() => update(() => api.put(path(`/invoices/${id}`), { paid_at: null }))}>Marquer non payée</Button>
            : <Button variant="primary" icon="check" onClick={() => update(() => api.put(path(`/invoices/${id}`), { paid_at: todayIso() }))}>Marquer comme payée</Button>
        )}
      />

      <div className="invoice-layout">
        <Card className="invoice-photo" title="Photo d'origine" subtitle="Conservée avec la facture">
          {invoice.photo_path ? (
            <img src={`/api/files/${invoice.photo_path}`} alt="Photo de la facture" onClick={() => setZoom(true)} />
          ) : <div className="photo-placeholder"><Icon name="camera" size={28} /><span className="small">Facture saisie sans photo</span></div>}
        </Card>

        <div className="stack">
          {draft && invoice.ai_message && (
            <Notice tone={invoice.ai_status === 'ok' ? 'success' : invoice.ai_status === 'erreur' ? 'warning' : 'info'} icon={invoice.ai_status === 'ok' ? 'sparkles' : 'alert'}>
              {invoice.ai_message}
            </Notice>
          )}
          <Card title="Informations">
            <div className="form-grid">
              <Field label="Fournisseur"><input disabled={!draft} value={head.supplier_name ?? ''} onChange={(e) => setHead({ ...head, supplier_name: e.target.value })} onBlur={() => saveHead('supplier_name')} /></Field>
              <Field label="N° de facture"><input disabled={!draft} value={head.invoice_number ?? ''} onChange={(e) => setHead({ ...head, invoice_number: e.target.value })} onBlur={() => saveHead('invoice_number')} /></Field>
              <Field label="Date de facture"><input type="date" disabled={!draft} value={head.invoice_date ?? ''} onChange={(e) => setHead({ ...head, invoice_date: e.target.value })} onBlur={() => saveHead('invoice_date')} /></Field>
              <Field label="Date de livraison"><input type="date" disabled={!draft} value={head.delivery_date ?? ''} onChange={(e) => setHead({ ...head, delivery_date: e.target.value })} onBlur={() => saveHead('delivery_date')} /></Field>
              <Field label="Échéance de paiement"><input type="date" value={head.due_date ?? ''} onChange={(e) => setHead({ ...head, due_date: e.target.value })} onBlur={() => saveHead('due_date')} /></Field>
              {!draft && <Field label="Classement comptable"><input disabled value={invoice.expense_category || ''} /></Field>}
            </div>
          </Card>

          {draft ? (
            <Card title={`Lignes (${lines.length})`} subtitle="Vérifiez et corrigez chaque ligne avant de valider." actions={unlinked > 0 && <Badge tone="warning">{unlinked} produit(s) à relier</Badge>}>
              <div className="stack">
                {lines.map((l) => (
                  <LineEditor key={l.id} line={l} ingredients={ing.data?.ingredients || []} allergens={ing.data?.allergens || []}
                    onSave={(body) => saveLine(l.id, body)}
                    onDelete={() => update(() => api.del(path(`/invoices/${id}/lines/${l.id}`)))} />
                ))}
                <div><Button icon="plus" onClick={() => update(() => api.post(path(`/invoices/${id}/lines`), {}))}>Ajouter une ligne</Button></div>
              </div>
            </Card>
          ) : (
            <Card title={`Lignes (${lines.length})`} pad={false}>
              <div className="table-wrap">
                <table className="table table--cards">
                  <thead><tr><th>Produit</th><th className="num">Quantité</th><th className="num">Prix unitaire HT</th><th className="num">Prix d'achat HT</th><th className="num">TVA</th></tr></thead>
                  <tbody>{lines.map((l) => <LineEditor key={l.id} line={l} readOnly />)}</tbody>
                </table>
              </div>
            </Card>
          )}

          <Card>
            <dl className="totals">
              <dt>Total HT</dt><dd>{eur(draft ? invoice.computed_ht : invoice.total_ht)}</dd>
              <dt>TVA</dt><dd>{eur(draft ? invoice.computed_tva : invoice.total_tva)}</dd>
              <dt>Total TTC</dt><dd style={{ fontSize: '1.15rem' }}>{eur(draft ? invoice.computed_ttc : invoice.total_ttc)}</dd>
            </dl>
            {draft && invoice.total_ttc != null && Math.abs(invoice.total_ttc - invoice.computed_ttc) > 0.05 && (
              <p className="small text-warning right" style={{ marginTop: 8 }}>Total lu sur la facture : {eur(invoice.total_ttc)} TTC — vérifiez les lignes.</p>
            )}
            {!draft && <p className="small muted right" style={{ marginTop: 8 }}>Validée le {date(invoice.validated_at)} · les prix des ingrédients et le food cost des plats concernés ont été mis à jour.</p>}
          </Card>
        </div>
      </div>
      {zoom && <div className="lightbox" onClick={() => setZoom(false)}><img src={`/api/files/${invoice.photo_path}`} alt="Facture" /></div>}
      <Confirm open={confirmDelete} title="Supprimer ce brouillon ?" onClose={() => setConfirmDelete(false)} busy={busy}
        onConfirm={() => run(async () => { await api.del(path(`/invoices/${id}`)); refreshBadges?.(); navigate('/restaurateur/factures'); }, 'Brouillon supprimé')}>
        La photo et les lignes saisies seront supprimées.
      </Confirm>
    </>
  );
}
