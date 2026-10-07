import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Empty, ErrorBox, Field, Icon, Modal, PageHeader, Spinner, Tabs, useAction, useLoad } from '../../ui.jsx';
import { useRealtime } from '../../realtime.js';
import { eur, pct, date, dateTime, baseQty, pricePerUnit, BASE_LABELS } from '../../format.js';

export function fcTone(pctValue, target) {
  if (pctValue == null) return '';
  if (pctValue > target) return 'fc-bad';
  if (pctValue > target - 2) return 'fc-warn';
  return 'fc-ok';
}

/** Food cost en euros et en % côte à côte. */
export function FoodCostPair({ dish }) {
  return (
    <span className="fc-pair">
      <span className="fc-pair__eur">{eur(dish.food_cost_eur)}</span>
      <span className={`fc-pair__pct ${fcTone(dish.food_cost_pct, dish.target_food_cost_pct)}`}>{pct(dish.food_cost_pct)}</span>
    </span>
  );
}

function Dishes() {
  const { path } = useEst();
  const navigate = useNavigate();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/dishes')));
  useRealtime('refresh', () => reload(true));
  if (loading && !data) return <Spinner />;
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <Card pad={false}>
        {!data?.dishes.length ? (
          <Empty icon="pie" title="Aucune fiche technique" action={<Button variant="primary" icon="plus" onClick={() => navigate('/restaurateur/food-cost/nouveau')}>Créer un plat</Button>}>
            Créez la fiche technique de vos plats pour suivre leur food cost.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table table--cards">
              <thead><tr><th>Plat</th><th className="num">Prix de vente HT</th><th>Food cost (€ et %)</th><th className="num">Cible</th><th className="num">Prix conseillé HT</th><th>État</th></tr></thead>
              <tbody>
                {data.dishes.map((d) => (
                  <tr key={d.id} className={`is-clickable ${d.food_cost_pct > d.target_food_cost_pct ? 'row-warning' : ''}`} onClick={() => navigate(`/restaurateur/food-cost/${d.id}`)}>
                    <td data-label="Plat"><strong>{d.name}</strong>{d.category && <div className="tiny muted">{d.category}</div>}</td>
                    <td data-label="Prix de vente HT" className="num">{eur(d.sale_price_ht)}</td>
                    <td data-label="Food cost"><FoodCostPair dish={d} /></td>
                    <td data-label="Cible" className="num">{pct(d.target_food_cost_pct, 0)}</td>
                    <td data-label="Prix conseillé HT" className="num">{eur(d.recommended_price_ht)}</td>
                    <td data-label="État">
                      {d.missing_prices > 0 ? <Badge tone="warning">{d.missing_prices} prix manquant(s)</Badge>
                        : d.food_cost_pct > d.target_food_cost_pct ? <Badge tone="danger" icon="alert">Au-dessus de la cible</Badge>
                        : <Badge tone="success" icon="check">Rentable</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="tiny muted section">Calcul : prix unitaire = prix d'achat HT ÷ quantité achetée · coût ingrédient = prix unitaire × quantité dans le plat · food cost % = food cost € ÷ prix de vente HT × 100 · prix conseillé HT = food cost € ÷ cible % × 100. Le dernier prix d'achat connu est toujours utilisé.</p>
    </>
  );
}

function IngredientModal({ ingredient, allergens, onClose, onSaved }) {
  const { path } = useEst();
  const isNew = !ingredient.id;
  const factor = (u) => (u === 'piece' ? 1 : 1000);
  const [form, setForm] = useState(() => ({
    name: ingredient.name || '',
    base_unit: ingredient.base_unit || 'g',
    category: ingredient.category || '',
    allergens: ingredient.allergens || [],
    stock: ingredient.stock != null ? +(ingredient.stock / factor(ingredient.base_unit)).toFixed(3) : '',
    min_stock: ingredient.min_stock != null ? +(ingredient.min_stock / factor(ingredient.base_unit)).toFixed(3) : '',
  }));
  const [run, busy] = useAction();
  const stockUnit = { g: 'kg', ml: 'L', piece: 'pièces' }[form.base_unit];
  const toggle = (a) => setForm((f) => ({ ...f, allergens: f.allergens.includes(a) ? f.allergens.filter((x) => x !== a) : [...f.allergens, a] }));
  const save = () => run(async () => {
    const toBase = (v) => (v === '' ? 0 : Number(String(v).replace(',', '.')) * factor(form.base_unit));
    const body = { ...form, stock: toBase(form.stock), min_stock: toBase(form.min_stock) };
    if (isNew) await api.post(path('/ingredients'), body);
    else await api.put(path(`/ingredients/${ingredient.id}`), body);
    onSaved();
  }, isNew ? 'Ingrédient créé' : 'Ingrédient mis à jour');
  return (
    <Modal open onClose={onClose} title={isNew ? 'Nouvel ingrédient' : ingredient.name}
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={save}>Enregistrer</Button></>}>
      <div className="stack">
        <div className="form-grid">
          <Field label="Nom" className="span-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Unité des fiches techniques">
            <select value={form.base_unit} disabled={!isNew} onChange={(e) => setForm({ ...form, base_unit: e.target.value })}>
              <option value="g">Grammes (g)</option><option value="ml">Millilitres (ml)</option><option value="piece">Pièces</option>
            </select>
          </Field>
          <Field label="Catégorie"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} /></Field>
          <Field label="Stock actuel" hint="Mis à jour à chaque facture validée"><div className="input-suffix"><input inputMode="decimal" value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /><span>{stockUnit}</span></div></Field>
          <Field label="Stock minimum" hint="En dessous : alerte et commande proposée"><div className="input-suffix"><input inputMode="decimal" value={form.min_stock} onChange={(e) => setForm({ ...form, min_stock: e.target.value })} /><span>{stockUnit}</span></div></Field>
        </div>
        <Field label="Allergènes">
          <div className="chips">{allergens.map((a) => <button type="button" key={a} className={`chip ${form.allergens.includes(a) ? 'is-active' : ''}`} onClick={() => toggle(a)}>{a}</button>)}</div>
        </Field>
      </div>
    </Modal>
  );
}

function Ingredients() {
  const { path } = useEst();
  const { data, error, loading, reload } = useLoad(() => api.get(path('/ingredients')));
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  if (loading && !data) return <Spinner />;
  const list = (data?.ingredients || []).filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <ErrorBox error={error} onRetry={reload} />
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="grow" style={{ maxWidth: 320 }} placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Button icon="plus" onClick={() => setEdit({})}>Nouvel ingrédient</Button>
      </div>
      <Card pad={false}>
        <div className="table-wrap">
          <table className="table table--cards">
            <thead><tr><th>Ingrédient</th><th className="num">Dernier prix HT</th><th>Dernier achat</th><th className="num">Stock</th><th>Allergènes</th><th className="num">Plats</th></tr></thead>
            <tbody>
              {list.map((g) => (
                <tr key={g.id} className={`is-clickable ${g.min_stock > 0 && g.stock < g.min_stock ? 'row-warning' : ''}`} onClick={() => setEdit(g)}>
                  <td data-label="Ingrédient"><strong>{g.name}</strong><div className="tiny muted">{g.category || '—'} · fiches en {BASE_LABELS[g.base_unit]}</div></td>
                  <td data-label="Dernier prix" className="num">{pricePerUnit(g.unit_cost_base, g.base_unit)}</td>
                  <td data-label="Dernier achat">{g.price_date ? <>{date(g.price_date)}<div className="tiny muted">{g.supplier_name}</div></> : <span className="muted">Aucune facture</span>}</td>
                  <td data-label="Stock" className="num">
                    {baseQty(g.stock, g.base_unit)}
                    {g.min_stock > 0 && <div className={`tiny ${g.stock < g.min_stock ? 'text-danger' : 'muted'}`}>min. {baseQty(g.min_stock, g.base_unit)}</div>}
                  </td>
                  <td data-label="Allergènes">{g.allergens.length ? <div className="chips">{g.allergens.map((a) => <Badge key={a} tone="warning">{a}</Badge>)}</div> : <span className="muted">—</span>}</td>
                  <td data-label="Plats" className="num">{g.used_in}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {edit && <IngredientModal ingredient={edit} allergens={data.allergens} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(true); }} />}
    </>
  );
}

function CostAlerts() {
  const { est } = useEst();
  const navigate = useNavigate();
  const { data, loading } = useLoad(() => api.get(`/api/alerts?establishment=${est.id}`));
  if (loading && !data) return <Spinner />;
  const list = (data?.alerts || []).filter((a) => a.type === 'food_cost');
  return (
    <Card>
      {!list.length ? <Empty icon="check" title="Aucune alerte de rentabilité" /> : (
        <div className="list">
          {list.map((a) => (
            <button key={a.id} type="button" className="list__item" style={{ border: 0, borderBottom: '1px solid var(--line-2)', background: 'none', textAlign: 'left', cursor: 'pointer', width: '100%' }} onClick={() => a.link && navigate(a.link)}>
              <span className={`list__icon list__icon--${a.severity === 'danger' ? 'danger' : 'warning'}`}><Icon name="trend" size={18} /></span>
              <span className="grow"><strong>{a.title}</strong><div className="small muted">{a.body}</div></span>
              <span className="tiny muted nowrap">{dateTime(a.created_at)}</span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

export default function FoodCost({ tab: initial = 'dishes' }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState(initial);
  return (
    <>
      <PageHeader title="Food cost" subtitle="Fiches techniques chiffrées au dernier prix d'achat, recalculées à chaque facture."
        actions={<Button variant="primary" icon="plus" onClick={() => navigate('/restaurateur/food-cost/nouveau')}>Nouveau plat</Button>} />
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: 'dishes', label: 'Plats et fiches techniques', icon: 'pie' },
        { value: 'ingredients', label: 'Ingrédients', icon: 'wheat' },
        { value: 'alerts', label: 'Alertes de rentabilité', icon: 'trend' },
      ]} />
      {tab === 'dishes' && <Dishes />}
      {tab === 'ingredients' && <Ingredients />}
      {tab === 'alerts' && <CostAlerts />}
    </>
  );
}
