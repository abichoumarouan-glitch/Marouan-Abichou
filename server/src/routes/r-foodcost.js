import express from 'express';
import { all, get, run, insert, tx } from '../db.js';
import { fail } from '../auth.js';
import { nowLocal } from '../time.js';
import { num, str, ownRow } from '../util.js';
import { computeDish, dishesForEstablishment, latestPrice, snapshotDish, ALLERGENS } from '../foodcost.js';
import { checkLowStock } from '../jobs.js';

const router = express.Router({ mergeParams: true });

router.get('/dishes', (req, res) => {
  res.json({ dishes: dishesForEstablishment(req.est.id), allergens: ALLERGENS });
});

router.get('/dishes/:id', (req, res) => {
  const dish = ownRow('dishes', Number(req.params.id), req.est.id, 'Plat');
  const history = all('SELECT * FROM dish_cost_history WHERE dish_id = ? ORDER BY id DESC LIMIT 30', dish.id);
  res.json({ dish: computeDish(dish), history });
});

function saveLines(estId, dishId, lines) {
  if (!Array.isArray(lines)) return;
  run('DELETE FROM recipe_lines WHERE dish_id = ?', dishId);
  for (const l of lines) {
    const ing = ownRow('ingredients', Number(l.ingredient_id), estId, 'Ingrédient');
    const q = num(l.quantity);
    if (!(q > 0)) fail(400, `Quantité invalide pour ${ing.name}.`);
    // la quantité est toujours exprimée dans l'unité de base de l'ingrédient (g, ml ou pièce)
    insert('INSERT INTO recipe_lines (dish_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?)', dishId, ing.id, q, ing.base_unit);
  }
}

function dishFields(b, current = {}) {
  const name = 'name' in b ? str(b.name) : current.name;
  if (!name) fail(400, 'Le nom du plat est obligatoire.');
  const price = 'sale_price_ht' in b ? num(b.sale_price_ht) : current.sale_price_ht;
  if (price == null || price < 0) fail(400, 'Prix de vente HT invalide.');
  const target = 'target_food_cost_pct' in b ? num(b.target_food_cost_pct) : current.target_food_cost_pct;
  if (!(target > 0 && target < 100)) fail(400, 'Le food cost cible doit être compris entre 0 et 100 %.');
  return { name, price, target, category: 'category' in b ? str(b.category) : current.category, notes: 'notes' in b ? str(b.notes) : current.notes };
}

router.post('/dishes', (req, res) => {
  const f = dishFields(req.body || {});
  const id = tx(() => {
    const id = insert(
      'INSERT INTO dishes (establishment_id, name, category, sale_price_ht, target_food_cost_pct, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      req.est.id, f.name, f.category, f.price, f.target, f.notes, nowLocal(),
    );
    saveLines(req.est.id, id, req.body.lines || []);
    return id;
  });
  const dish = get('SELECT * FROM dishes WHERE id = ?', id);
  snapshotDish(dish, { cause: 'création', alert: false });
  res.status(201).json({ dish: computeDish(dish) });
});

router.put('/dishes/:id', (req, res) => {
  const current = ownRow('dishes', Number(req.params.id), req.est.id, 'Plat');
  const f = dishFields(req.body || {}, current);
  tx(() => {
    run('UPDATE dishes SET name = ?, category = ?, sale_price_ht = ?, target_food_cost_pct = ?, notes = ? WHERE id = ?',
      f.name, f.category, f.price, f.target, f.notes, current.id);
    if ('lines' in req.body) saveLines(req.est.id, current.id, req.body.lines);
  });
  const dish = get('SELECT * FROM dishes WHERE id = ?', current.id);
  snapshotDish(dish, { cause: 'fiche modifiée', alert: false });
  res.json({ dish: computeDish(dish) });
});

router.delete('/dishes/:id', (req, res) => {
  const dish = ownRow('dishes', Number(req.params.id), req.est.id, 'Plat');
  run('UPDATE dishes SET active = 0 WHERE id = ?', dish.id);
  res.json({ ok: true });
});

// ---- Ingrédients ----
function ingredientView(g) {
  const p = latestPrice(g.id);
  return {
    ...g,
    allergens: JSON.parse(g.allergens || '[]'),
    unit_cost_base: p?.unit_cost_base ?? null,
    unit_price: p && p.quantity ? p.purchase_price_ht / p.quantity : null,
    purchase_unit: p?.unit ?? null,
    price_date: p?.delivery_date ?? null,
    supplier_name: p?.supplier_name ?? null,
    used_in: get('SELECT COUNT(DISTINCT r.dish_id) AS n FROM recipe_lines r JOIN dishes d ON d.id = r.dish_id WHERE r.ingredient_id = ? AND d.active = 1', g.id).n,
  };
}

router.get('/ingredients', (req, res) => {
  res.json({
    ingredients: all('SELECT * FROM ingredients WHERE establishment_id = ? ORDER BY name COLLATE NOCASE', req.est.id).map(ingredientView),
    allergens: ALLERGENS,
  });
});

function cleanAllergens(list) {
  return JSON.stringify((Array.isArray(list) ? list : []).filter((a) => ALLERGENS.includes(a)));
}

router.post('/ingredients', (req, res) => {
  const b = req.body || {};
  const name = str(b.name);
  if (!name) fail(400, "Le nom de l'ingrédient est obligatoire.");
  const base = ['g', 'ml', 'piece'].includes(b.base_unit) ? b.base_unit : fail(400, 'Unité de base invalide (g, ml ou pièce).');
  const id = insert(
    'INSERT INTO ingredients (establishment_id, name, base_unit, category, allergens, stock, min_stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    req.est.id, name, base, str(b.category), cleanAllergens(b.allergens), num(b.stock) ?? 0, num(b.min_stock) ?? 0, nowLocal(),
  );
  res.status(201).json({ ingredient: ingredientView(get('SELECT * FROM ingredients WHERE id = ?', id)) });
});

router.put('/ingredients/:id', (req, res) => {
  const g = ownRow('ingredients', Number(req.params.id), req.est.id, 'Ingrédient');
  const b = req.body || {};
  const stock = 'stock' in b ? num(b.stock) : g.stock;
  const min = 'min_stock' in b ? num(b.min_stock) : g.min_stock;
  if (stock == null || min == null || min < 0) fail(400, 'Stock invalide.');
  run('UPDATE ingredients SET name = ?, category = ?, allergens = ?, stock = ?, min_stock = ? WHERE id = ?',
    str(b.name) || g.name, 'category' in b ? str(b.category) : g.category,
    'allergens' in b ? cleanAllergens(b.allergens) : g.allergens, stock, min, g.id);
  if ('stock' in b || 'min_stock' in b) checkLowStock(req.est.id);
  res.json({ ingredient: ingredientView(get('SELECT * FROM ingredients WHERE id = ?', g.id)) });
});

export default router;
