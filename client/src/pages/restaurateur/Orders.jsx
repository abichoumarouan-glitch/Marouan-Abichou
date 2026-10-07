import { useEffect, useState } from 'react';
import { api, download } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Confirm, Empty, ErrorBox, Field, Icon, Modal, Notice, PageHeader, Spinner, useAction, useLoad } from '../../ui.jsx';
import { dateTime, baseQty, UNIT_LABELS, num } from '../../format.js';

function mailto(order) {
  const body = [
    'Bonjour,',
    '',
    'Merci de bien vouloir nous livrer la commande suivante :',
    '',
    ...order.lines.map((l) => `- ${l.label} : ${num(l.quantity)} ${UNIT_LABELS[l.unit] || l.unit}${l.quantity > 1 ? 's' : ''}`),
    '',
    order.note && order.note !== 'Proposée automatiquement : stock sous le minimum.' ? order.note : '',
    'Cordialement,',
  ].filter((x) => x !== '').join('\n');
  return `mailto:${order.supplier?.email || ''}?subject=${encodeURIComponent(`Commande n° ${order.id}`)}&body=${encodeURIComponent(body)}`;
}

function OrderEditor({ order, ingredients, onSaved }) {
  const { path, refreshBadges } = useEst();
  const [lines, setLines] = useState(order.lines);
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [run, busy] = useAction();
  useEffect(() => { setLines(order.lines); setDirty(false); }, [order]);
  const set = (i, patch) => { setLines((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x))); setDirty(true); };
  const save = () => api.put(path(`/orders/${order.id}`), { lines });

  return (
    <Card title={<span className="row" style={{ gap: 8 }}><Icon name="truck" size={18} />{order.supplier_name}</span>}
      subtitle={`Proposée le ${dateTime(order.created_at)} · ${order.note || ''}`}
      actions={<Badge tone="warning">À valider</Badge>}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Produit</th><th className="num">Stock / minimum</th><th className="num">Quantité</th><th>Unité</th><th /></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.id || `n${i}`}>
                <td>
                  {l.id ? <strong>{l.label}</strong> : (
                    <select value={l.ingredient_id || ''} onChange={(e) => { const g = ingredients.find((x) => x.id === Number(e.target.value)); set(i, { ingredient_id: g?.id, label: g?.name, unit: { g: 'kg', ml: 'l', piece: 'piece' }[g?.base_unit] || 'piece' }); }}>
                      <option value="">Choisir un produit…</option>
                      {ingredients.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  )}
                </td>
                <td className="num small">{l.stock != null ? <span className={l.stock < l.min_stock ? 'text-danger' : ''}>{baseQty(l.stock, l.base_unit)}</span> : '—'}{l.min_stock ? <span className="muted"> / {baseQty(l.min_stock, l.base_unit)}</span> : ''}</td>
                <td className="num"><input style={{ width: 90, textAlign: 'right' }} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></td>
                <td>
                  <select value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} style={{ width: 110 }}>
                    {Object.entries(UNIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </td>
                <td className="actions"><Button size="sm" variant="ghost" icon="trash" aria-label="Retirer" onClick={() => { setLines((x) => x.filter((_, j) => j !== i)); setDirty(true); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row row--between section">
        <Button size="sm" icon="plus" onClick={() => { setLines((l) => [...l, { label: '', quantity: 1, unit: 'kg' }]); setDirty(true); }}>Ajouter un produit</Button>
        <div className="row">
          <Button variant="ghost" onClick={() => setCancel(true)}>Refuser la proposition</Button>
          {dirty && <Button loading={busy} onClick={() => run(async () => { await save(); onSaved(); }, 'Commande mise à jour')}>Enregistrer</Button>}
          <Button variant="success" icon="check" loading={busy} onClick={() => setConfirm(true)}>Valider la commande</Button>
        </div>
      </div>
      <Confirm open={confirm} tone="success" confirmLabel="Valider" title={`Valider la commande ${order.supplier_name} ?`} busy={busy} onClose={() => setConfirm(false)}
        onConfirm={() => run(async () => {
          if (dirty) await save();
          const { order: o } = await api.post(path(`/orders/${order.id}/validate`));
          setConfirm(false);
          refreshBadges?.();
          onSaved();
          window.location.href = mailto(o);
        }, 'Commande validée')}>
        <p className="small">Après validation, un email de commande pré-rempli s'ouvre pour l'envoyer au fournisseur{order.supplier?.email ? ` (${order.supplier.email})` : ''}. Le bon de commande PDF reste téléchargeable.</p>
      </Confirm>
      <Confirm open={cancel} title="Refuser cette proposition ?" confirmLabel="Refuser" busy={busy} onClose={() => setCancel(false)}
        onConfirm={() => run(async () => { await api.post(path(`/orders/${order.id}/cancel`)); setCancel(false); refreshBadges?.(); onSaved(); }, 'Proposition refusée')}>
        <p className="small">Rien ne sera commandé.</p>
      </Confirm>
    </Card>
  );
}

function SupplierModal({ supplier, onClose, onSaved }) {
  const { path } = useEst();
  const [form, setForm] = useState({ email: supplier.email || '', phone: supplier.phone || '' });
  const [run, busy] = useAction();
  return (
    <Modal open onClose={onClose} title={supplier.name} size="sm"
      footer={<Button variant="primary" loading={busy} onClick={() => run(async () => { await api.put(path(`/suppliers/${supplier.id}`), form); onSaved(); }, 'Fournisseur mis à jour')}>Enregistrer</Button>}>
      <div className="stack">
        <Field label="Email de commande"><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Téléphone"><input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function Orders() {
  const { path } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/orders')));
  const [supplier, setSupplier] = useState(null);
  const [run, busy] = useAction();
  if (loading && !data) return <Spinner />;
  const proposed = data?.orders.filter((o) => o.status === 'proposee') || [];
  const history = data?.orders.filter((o) => o.status !== 'proposee') || [];
  return (
    <>
      <PageHeader title="Commandes fournisseurs" subtitle="Des commandes sont proposées automatiquement quand un produit passe sous son stock minimum. Rien n'est envoyé sans votre validation."
        actions={<Button icon="refresh" loading={busy} onClick={() => run(async () => { const r = await api.post(path('/orders/propose')); await reload(true); return r; }, 'Propositions mises à jour')}>Vérifier les stocks</Button>} />
      <ErrorBox error={error} onRetry={reload} />
      <div className="grid grid-main">
        <div className="stack">
          {!proposed.length ? <Card><Empty icon="truck" title="Aucune commande à valider">Les stocks sont au-dessus des minimums.</Empty></Card>
            : proposed.map((o) => <OrderEditor key={o.id} order={o} ingredients={data.ingredients} onSaved={() => reload(true)} />)}
          <Card title="Historique" pad={false}>
            {!history.length ? <p className="muted small pad">Aucune commande passée.</p> : (
              <div className="table-wrap">
                <table className="table table--cards">
                  <thead><tr><th>Date</th><th>Fournisseur</th><th>Produits</th><th>Statut</th><th /></tr></thead>
                  <tbody>
                    {history.map((o) => (
                      <tr key={o.id}>
                        <td data-label="Date">{dateTime(o.validated_at || o.created_at)}</td>
                        <td data-label="Fournisseur" className="strong">{o.supplier_name}</td>
                        <td data-label="Produits" className="small">{o.lines.map((l) => `${l.label} (${num(l.quantity)} ${UNIT_LABELS[l.unit]})`).join(', ')}</td>
                        <td data-label="Statut">{o.status === 'validee' ? <Badge tone="success">Validée</Badge> : <Badge>Refusée</Badge>}</td>
                        <td className="actions">{o.status === 'validee' && <>
                          <Button size="sm" variant="ghost" icon="download" onClick={() => run(() => download(path(`/orders/${o.id}/pdf`), `bon-de-commande-${o.id}.pdf`))}>PDF</Button>
                          <a className="btn btn--ghost btn--sm" href={mailto(o)}><Icon name="send" size={16} />Email</a>
                        </>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
        <div className="stack">
          <Card title="Stocks sous le minimum">
            {!data.low_stock.length ? <p className="small"><Icon name="check" size={16} className="text-success" /> Aucun produit sous le minimum.</p> : (
              <div className="list">
                {data.low_stock.map((g) => (
                  <div key={g.id} className="list__item">
                    <span className="list__icon list__icon--warning"><Icon name="alert" size={16} /></span>
                    <span className="grow small"><strong>{g.name}</strong><div className="muted tiny">{baseQty(g.stock, g.base_unit)} en stock · minimum {baseQty(g.min_stock, g.base_unit)}</div></span>
                  </div>
                ))}
              </div>
            )}
            <p className="tiny muted section">Les stocks minimums se règlent dans Food cost › Ingrédients.</p>
          </Card>
          <Card title="Fournisseurs">
            <div className="list">
              {data.suppliers.map((s) => (
                <button key={s.id} type="button" className="list__item" style={{ border: 0, borderBottom: '1px solid var(--line-2)', background: 'none', cursor: 'pointer', textAlign: 'left', width: '100%' }} onClick={() => setSupplier(s)}>
                  <span className="grow small"><strong>{s.name}</strong><div className="muted tiny">{s.email || 'Email à renseigner'}</div></span>
                  <Icon name="edit" size={16} className="muted" />
                </button>
              ))}
            </div>
            {!data.suppliers.length && <Notice>Les fournisseurs sont créés automatiquement à partir des factures.</Notice>}
          </Card>
        </div>
      </div>
      {supplier && <SupplierModal supplier={supplier} onClose={() => setSupplier(null)} onSaved={() => { setSupplier(null); reload(true); }} />}
    </>
  );
}
