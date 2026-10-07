import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, Confirm, ErrorBox, Field, Icon, PageHeader, Spinner, useAction, useLoad } from '../../ui.jsx';
import { fcTone } from './FoodCost.jsx';
import { eur, pct, num, dateTime, pricePerUnit, BASE_LABELS } from '../../format.js';

const toNum = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

/** Même formule que le serveur, en précision complète (aperçu pendant la saisie). */
function preview(form, ingredients) {
  const byId = Object.fromEntries(ingredients.map((g) => [g.id, g]));
  let total = 0;
  let missing = 0;
  const lines = form.lines.map((l) => {
    const g = byId[l.ingredient_id];
    const q = toNum(l.quantity);
    const cost = g?.unit_cost_base != null && q != null ? g.unit_cost_base * q : null;
    if (cost == null) missing++;
    else total += cost;
    return { ...l, ingredient: g, cost };
  });
  const sale = toNum(form.sale_price_ht) || 0;
  const target = toNum(form.target_food_cost_pct) || 0;
  const allergens = new Set(lines.flatMap((l) => l.ingredient?.allergens || []));
  return {
    lines, missing,
    food_cost_eur: total,
    food_cost_pct: sale > 0 ? (total / sale) * 100 : null,
    recommended_price_ht: target > 0 ? (total / target) * 100 : null,
    target, sale, allergens: [...allergens],
  };
}

export default function DishDetail() {
  const { id } = useParams();
  const isNew = id === 'nouveau';
  const { path } = useEst();
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const dish = useLoad(() => (isNew ? Promise.resolve(null) : api.get(path(`/dishes/${id}`))), [id]);
  const ing = useLoad(() => api.get(path('/ingredients')));
  const [editing, setEditing] = useState(isNew);
  const [form, setForm] = useState({ name: '', category: '', sale_price_ht: '', target_food_cost_pct: 30, notes: '', lines: [] });
  const [del, setDel] = useState(false);

  const reset = (d) => setForm({
    name: d.name, category: d.category || '', sale_price_ht: d.sale_price_ht, target_food_cost_pct: d.target_food_cost_pct, notes: d.notes || '',
    lines: d.lines.map((l) => ({ ingredient_id: l.ingredient_id, quantity: l.quantity })),
  });
  useEffect(() => { if (dish.data?.dish) reset(dish.data.dish); }, [dish.data]);

  const ingredients = ing.data?.ingredients || [];
  const calc = useMemo(() => preview(form, ingredients), [form, ingredients]);

  if ((dish.loading && !dish.data && !isNew) || (ing.loading && !ing.data)) return <Spinner />;
  if (dish.error) return <ErrorBox error={dish.error} onRetry={dish.reload} />;
  const d = dish.data?.dish;
  // en lecture : valeurs calculées par le serveur ; en édition : aperçu local
  const view = editing ? calc : d;
  const target = editing ? calc.target : d.target_food_cost_pct;
  const sale = editing ? calc.sale : d.sale_price_ht;
  const tone = fcTone(view.food_cost_pct, target);

  const save = () => run(async () => {
    const body = { ...form, lines: form.lines.filter((l) => l.ingredient_id && l.quantity !== '') };
    const r = isNew ? await api.post(path('/dishes'), body) : await api.put(path(`/dishes/${id}`), body);
    if (isNew) navigate(`/restaurateur/food-cost/${r.dish.id}`, { replace: true });
    else { setEditing(false); dish.reload(true); }
  }, 'Fiche technique enregistrée');

  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const used = new Set(form.lines.map((l) => Number(l.ingredient_id)));

  return (
    <>
      <PageHeader
        back={<Link to="/restaurateur/food-cost" className="backlink"><Icon name="left" size={16} /> Food cost</Link>}
        title={isNew ? 'Nouveau plat' : d.name}
        subtitle={!isNew && d.category}
        actions={editing ? (
          <>
            {!isNew && <Button variant="ghost" onClick={() => { reset(d); setEditing(false); }}>Annuler</Button>}
            <Button variant="primary" icon="check" loading={busy} onClick={save}>Enregistrer la fiche</Button>
          </>
        ) : (
          <>
            <Button variant="ghost" icon="trash" onClick={() => setDel(true)}>Retirer de la carte</Button>
            <Button variant="primary" icon="edit" onClick={() => setEditing(true)}>Modifier la fiche</Button>
          </>
        )}
      />

      <div className="grid grid-main">
        <div className="stack">
          {editing && (
            <Card title="Plat">
              <div className="form-grid">
                <Field label="Nom du plat" className="span-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={isNew} /></Field>
                <Field label="Catégorie"><input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Entrées, Plats, Desserts…" /></Field>
                <Field label="Prix de vente HT"><div className="input-suffix"><input inputMode="decimal" value={form.sale_price_ht} onChange={(e) => setForm({ ...form, sale_price_ht: e.target.value })} /><span>€</span></div></Field>
                <Field label="Food cost cible"><div className="input-suffix"><input inputMode="decimal" value={form.target_food_cost_pct} onChange={(e) => setForm({ ...form, target_food_cost_pct: e.target.value })} /><span>%</span></div></Field>
              </div>
            </Card>
          )}

          <Card title="Fiche technique" subtitle="Quantités pour une portion" pad={false}>
            <div className="table-wrap">
              <table className="table table--cards">
                <thead><tr><th>Ingrédient</th><th className="num">Quantité</th><th className="num">Prix unitaire HT</th><th className="num">Coût</th>{editing && <th />}</tr></thead>
                <tbody>
                  {editing ? calc.lines.map((l, i) => (
                    <tr key={i}>
                      <td data-label="Ingrédient">
                        <select value={l.ingredient_id || ''} onChange={(e) => setLine(i, { ingredient_id: Number(e.target.value) })}>
                          <option value="">Choisir…</option>
                          {ingredients.map((g) => <option key={g.id} value={g.id} disabled={used.has(g.id) && g.id !== Number(l.ingredient_id)}>{g.name}</option>)}
                        </select>
                      </td>
                      <td data-label="Quantité" className="num">
                        <div className="input-suffix" style={{ minWidth: 130 }}>
                          <input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                          <span>{l.ingredient ? BASE_LABELS[l.ingredient.base_unit] : '—'}</span>
                        </div>
                      </td>
                      <td data-label="Prix unitaire" className="num">{l.ingredient ? pricePerUnit(l.ingredient.unit_cost_base, l.ingredient.base_unit) : '—'}</td>
                      <td data-label="Coût" className="num strong">{l.cost != null ? eur(l.cost) : l.ingredient ? <Badge tone="warning">pas de prix</Badge> : '—'}</td>
                      <td className="actions"><Button size="sm" variant="ghost" icon="trash" aria-label="Retirer" onClick={() => setForm((f) => ({ ...f, lines: f.lines.filter((_, j) => j !== i) }))} /></td>
                    </tr>
                  )) : d.lines.map((l) => (
                    <tr key={l.id}>
                      <td data-label="Ingrédient"><strong>{l.ingredient_name}</strong></td>
                      <td data-label="Quantité" className="num">{num(l.quantity)} {BASE_LABELS[l.unit]}</td>
                      <td data-label="Prix unitaire" className="num">{pricePerUnit(l.unit_cost_base, l.unit)}</td>
                      <td data-label="Coût" className="num strong">{l.cost != null ? eur(l.cost) : <Badge tone="warning">pas de prix</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Food cost</td><td /><td /><td className="num">{eur(view.food_cost_eur)}</td>{editing && <td />}</tr></tfoot>
              </table>
            </div>
            {editing && <div className="pad"><Button icon="plus" onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, { ingredient_id: '', quantity: '' }] }))}>Ajouter un ingrédient</Button></div>}
          </Card>
          {!editing && dish.data?.history?.length > 0 && (
            <Card title="Historique du food cost">
              <div className="list">
                {dish.data.history.slice(0, 10).map((h) => (
                  <div key={h.id} className="list__item">
                    <span className="grow small">{dateTime(h.created_at)} <span className="muted">· {h.cause}</span></span>
                    <span className="num small">{eur(h.food_cost_eur)}</span>
                    <span className="num small strong" style={{ minWidth: 70 }}>{pct(h.food_cost_pct)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="stack">
          <Card title="Rentabilité">
            <div className="fc-big">
              <div className="stat"><div className="stat__label">Food cost €</div><div className="stat__value">{eur(view.food_cost_eur)}</div></div>
              <div className="stat"><div className="stat__label">Food cost %</div><div className={`stat__value ${tone === 'fc-bad' ? 'text-danger' : tone === 'fc-ok' ? 'text-success' : 'text-warning'}`}>{pct(view.food_cost_pct)}</div></div>
            </div>
            <div className="meter" title={`Cible ${pct(target, 0)}`}>
              <div className={`meter__bar ${tone}`} style={{ width: `${Math.min(100, (view.food_cost_pct || 0) * 2)}%`, background: 'currentColor' }} />
              <div className="meter__target" style={{ left: `${Math.min(100, target * 2)}%` }} />
            </div>
            <div className="vat-box" style={{ marginTop: 14 }}>
              <div className="vat-line"><span className="muted">Prix de vente HT</span><strong>{eur(sale)}</strong></div>
              <div className="vat-line"><span className="muted">Food cost cible</span><strong>{pct(target, 1)}</strong></div>
              <div className="vat-line"><span className="muted">Prix de vente conseillé HT</span><strong>{eur(view.recommended_price_ht)}</strong></div>
              <div className="vat-line"><span className="muted">Marge brute par portion</span><strong>{eur(sale - view.food_cost_eur)}</strong></div>
            </div>
            {(editing ? calc.missing : d.missing_prices) > 0 && <p className="small text-warning" style={{ marginTop: 8 }}>Certains ingrédients n'ont pas encore de prix (aucune facture validée) : le food cost est incomplet.</p>}
          </Card>
          <Card title="Allergènes">
            {(view.allergens || []).length ? <div className="chips">{view.allergens.map((a) => <Badge key={a} tone="warning">{a}</Badge>)}</div> : <p className="muted small">Aucun allergène déclaré dans les ingrédients.</p>}
            <p className="tiny muted" style={{ marginTop: 8 }}>Déduits des ingrédients de la fiche technique.</p>
          </Card>
        </div>
      </div>
      <Confirm open={del} title="Retirer ce plat de la carte ?" onClose={() => setDel(false)} busy={busy} confirmLabel="Retirer"
        onConfirm={() => run(async () => { await api.del(path(`/dishes/${id}`)); navigate('/restaurateur/food-cost'); }, 'Plat retiré')}>
        La fiche technique ne sera plus suivie dans le food cost.
      </Confirm>
    </>
  );
}
