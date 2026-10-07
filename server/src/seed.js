// Données de démonstration. Usage : npm run seed (efface et recrée la base).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.MIZU_DATA_DIR || path.join(here, '..', 'data');
const dbFile = process.env.MIZU_DB || path.join(dataDir, 'mizu.db');
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });

const { run, insert, get, all } = await import('./db.js');
const { createUser } = await import('./auth.js');
const { nowLocal, today, addDays, mondayOf } = await import('./time.js');
const { validateInvoice, snapshotDish, classifyText } = await import('./foodcost.js');

const PASSWORD = 'Mizu-demo-2026';
const T = today();
const NOW = nowLocal();
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// ---------- Comptes ----------
const comptable = createUser({ email: 'comptable@mizu.demo', password: PASSWORD, first_name: 'Hélène', last_name: 'Durand', company: 'Cabinet Durand Expertise', role: 'comptable' });
const resto = createUser({ email: 'restaurateur@mizu.demo', password: PASSWORD, first_name: 'Camille', last_name: 'Martin', company: 'SAS Maison Camille', role: 'restaurateur', accountant_id: comptable });
const resto2 = createUser({ email: 'karim@mizu.demo', password: PASSWORD, first_name: 'Karim', last_name: 'Benali', company: 'Le Petit Zinc SARL', role: 'restaurateur', accountant_id: comptable });
createUser({ email: 'support@mizu.demo', password: PASSWORD, first_name: 'Équipe', last_name: 'Mizu', role: 'support' });

const est1 = insert('INSERT INTO establishments (owner_id, name, address, created_at) VALUES (?, ?, ?, ?)', resto, 'Le Comptoir de Camille', '12 rue Mercière, 69002 Lyon', NOW);
const est2 = insert('INSERT INTO establishments (owner_id, name, address, created_at) VALUES (?, ?, ?, ?)', resto, 'Camille Bistrot', '4 place Sathonay, 69001 Lyon', NOW);
const est3 = insert('INSERT INTO establishments (owner_id, name, address, created_at) VALUES (?, ?, ?, ?)', resto2, 'Le Petit Zinc', '8 rue Oberkampf, 75011 Paris', NOW);

const COLORS = ['#3b82a0', '#7c6fb0', '#c0785a', '#5a9e7c', '#b0627c'];
function collab(estId, owner, email, first, last, job, hours, i) {
  const uid = createUser({ email, password: PASSWORD, first_name: first, last_name: last, role: 'collaborateur', owner_id: owner });
  return insert('INSERT INTO collaborators (user_id, establishment_id, job_title, weekly_hours, color) VALUES (?, ?, ?, ?, ?)', uid, estId, job, hours, COLORS[i % COLORS.length]);
}
const lucas = collab(est1, resto, 'collaborateur@mizu.demo', 'Lucas', 'Petit', 'Chef de partie', 39, 0);
const sarah = collab(est1, resto, 'sarah@mizu.demo', 'Sarah', 'Lemoine', 'Serveuse', 35, 1);
const ines = collab(est1, resto, 'ines@mizu.demo', 'Inès', 'Moreau', 'Commis de cuisine', 35, 2);
const hugo = collab(est1, resto, 'hugo@mizu.demo', 'Hugo', 'Garnier', 'Plongeur', 24, 3);
const tom = collab(est2, resto, 'tom@mizu.demo', 'Tom', 'Rousseau', 'Cuisinier', 39, 0);
const lea = collab(est2, resto, 'lea@mizu.demo', 'Léa', 'Fontaine', 'Serveuse', 30, 1);
const nadia = collab(est3, resto2, 'nadia@mizu.demo', 'Nadia', 'Haddad', 'Cuisinière', 39, 0);

// ---------- Ingrédients ----------
function ingredient(estId, name, base, category, allergens = [], min = 0) {
  return insert('INSERT INTO ingredients (establishment_id, name, base_unit, category, allergens, min_stock, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    estId, name, base, category, JSON.stringify(allergens), min, NOW);
}
const I = {};
function ingredients(estId) {
  const m = {};
  m.boeuf = ingredient(estId, 'Bœuf haché 15 %', 'g', 'Viande', [], 5000);
  m.pain = ingredient(estId, 'Pain burger brioché', 'piece', 'Boulangerie', ['Gluten', 'Œufs', 'Lait', 'Sésame'], 40);
  m.cheddar = ingredient(estId, 'Cheddar affiné', 'g', 'Crèmerie', ['Lait'], 1000);
  m.tomate = ingredient(estId, 'Tomates grappe', 'g', 'Fruits et légumes', [], 3000);
  m.salade = ingredient(estId, 'Laitue batavia', 'piece', 'Fruits et légumes', [], 6);
  m.pdt = ingredient(estId, 'Pommes de terre Agria', 'g', 'Fruits et légumes', [], 10000);
  m.huile = ingredient(estId, 'Huile de friture', 'ml', 'Épicerie', [], 5000);
  m.saumon = ingredient(estId, "Pavé de saumon d'Écosse", 'g', 'Poissonnerie', ['Poissons'], 2000);
  m.pates = ingredient(estId, 'Tagliatelles fraîches', 'g', 'Épicerie', ['Gluten', 'Œufs'], 2000);
  m.creme = ingredient(estId, 'Crème liquide 35 %', 'ml', 'Crèmerie', ['Lait'], 2000);
  m.parmesan = ingredient(estId, 'Parmigiano Reggiano', 'g', 'Crèmerie', ['Lait'], 500);
  m.citron = ingredient(estId, 'Citron jaune', 'piece', 'Fruits et légumes', [], 10);
  m.chocolat = ingredient(estId, 'Chocolat noir 70 %', 'g', 'Épicerie', ['Lait', 'Soja'], 1000);
  m.beurre = ingredient(estId, 'Beurre doux', 'g', 'Crèmerie', ['Lait'], 2000);
  m.oeufs = ingredient(estId, 'Œufs plein air', 'piece', 'Crèmerie', ['Œufs'], 60);
  m.sucre = ingredient(estId, 'Sucre semoule', 'g', 'Épicerie', [], 2000);
  m.farine = ingredient(estId, 'Farine T55', 'g', 'Épicerie', ['Gluten'], 2000);
  m.moutarde = ingredient(estId, 'Moutarde de Dijon', 'g', 'Épicerie', ['Moutarde'], 500);
  m.biere = ingredient(estId, 'Bière blonde pression', 'ml', 'Boissons', ['Gluten'], 20000);
  m.vin = ingredient(estId, 'Côtes-du-Rhône rouge', 'ml', 'Boissons', ['Sulfites'], 9000);
  return m;
}
I[est1] = ingredients(est1);
I[est2] = ingredients(est2);
I[est3] = ingredients(est3);

// ---------- Factures (validées via la vraie logique : prix, stocks, food cost) ----------
const due = (d, days = 30) => addDays(d, days);
function invoice(estId, supplier, number, date, lines, { validate = true, paid = false } = {}) {
  const id = insert(
    `INSERT INTO invoices (establishment_id, supplier_name, invoice_number, invoice_date, delivery_date, due_date, status, ai_status, ai_message, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'brouillon', 'manuel', 'Données de démonstration.', ?, ?)`,
    estId, supplier, number, date, date, due(date), get('SELECT owner_id FROM establishments WHERE id = ?', estId).owner_id, `${date}T10:00:00`,
  );
  if (!get('SELECT id FROM suppliers WHERE establishment_id = ? AND name = ?', estId, supplier)) {
    insert('INSERT INTO suppliers (establishment_id, name, email) VALUES (?, ?, ?)', estId, supplier, `commandes@${supplier.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '')}.fr`);
  }
  const sid = get('SELECT id FROM suppliers WHERE establishment_id = ? AND name = ?', estId, supplier).id;
  run('UPDATE invoices SET supplier_id = ? WHERE id = ?', sid, id);
  lines.forEach(([name, qty, unit, price, ing, conv, tva = 5.5], i) => {
    insert('INSERT INTO invoice_lines (invoice_id, position, product_name, quantity, unit, purchase_price_ht, tva_rate, ingredient_id, not_ingredient, conversion) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, i, name, qty, unit, price, tva, ing ?? null, ing === undefined ? 1 : 0, conv ?? null);
  });
  if (validate) {
    validateInvoice(id, null);
    run('UPDATE invoices SET validated_at = ? WHERE id = ?', `${date}T18:00:00`, id);
    run('UPDATE dish_cost_history SET created_at = ? WHERE invoice_id = ?', `${date}T18:00:00`, id);
    run("UPDATE alerts SET created_at = ? WHERE created_at > ? AND type = 'food_cost' AND establishment_id = ?", `${date}T18:00:00`, `${date}T23:59:59`, estId);
    if (paid) run('UPDATE invoices SET paid_at = ? WHERE id = ?', addDays(date, 20), id);
  }
  return id;
}

function purchases(estId, scale = 1, early = true, offset = 0, tag = '') {
  const g = I[estId];
  const d = (n) => addDays(T, -n - offset);
  if (early) {
    invoice(estId, 'Boucherie Laurent', `BL-${estId}-0412${tag}`, d(5), [
      ['Bœuf haché 15% MG', 10 * scale, 'kg', 118.0 * scale, g.boeuf],
    ], { paid: true });
    invoice(estId, 'Metro Lyon', `MET-${estId}-88120${tag}`, d(4), [
      ['Pain burger brioché x12', 6 * scale, 'carton', 46.8 * scale, g.pain, 12],
      ['Cheddar affiné tranches', 2 * scale, 'kg', 27.6 * scale, g.cheddar],
      ['Huile de friture tournesol', 10 * scale, 'l', 23.9 * scale, g.huile],
      ['Tagliatelles fraîches', 4 * scale, 'kg', 25.2 * scale, g.pates],
      ['Crème liquide 35% UHT', 6 * scale, 'l', 31.8 * scale, g.creme],
      ['Parmigiano Reggiano 24 mois', 1 * scale, 'kg', 21.9 * scale, g.parmesan],
      ['Chocolat noir 70% pistoles', 2.5 * scale, 'kg', 34.5 * scale, g.chocolat],
      ['Beurre doux 82%', 5 * scale, 'kg', 42.5 * scale, g.beurre],
      ['Œufs plein air calibre M x30', 4 * scale, 'carton', 39.6 * scale, g.oeufs, 30],
      ['Sucre semoule', 5 * scale, 'kg', 6.25 * scale, g.sucre],
      ['Farine T55', 5 * scale, 'kg', 4.9 * scale, g.farine],
      ['Moutarde de Dijon seau', 1 * scale, 'kg', 5.4 * scale, g.moutarde],
      ['Sacs kraft à emporter x250', 1, 'carton', 18.5, undefined, null, 20],
    ], { paid: true });
    invoice(estId, 'Primeurs Bellecour', `PB-${estId}-2291${tag}`, d(3), [
      ['Tomates grappe cat. 1', 5 * scale, 'kg', 14.75 * scale, g.tomate],
      ['Batavia', 12 * scale, 'piece', 10.8 * scale, g.salade],
      ['Pommes de terre Agria', 25 * scale, 'kg', 22.5 * scale, g.pdt],
      ['Citrons jaunes', 20 * scale, 'piece', 6.0 * scale, g.citron],
    ], { paid: true });
    invoice(estId, 'Marée du Rhône', `MR-${estId}-771${tag}`, d(2), [
      ["Pavé saumon d'Écosse sans peau", 4 * scale, 'kg', 99.6 * scale, g.saumon],
    ], { paid: true });
    invoice(estId, 'Brasserie du Rhône', `BDR-${estId}-1203${tag}`, d(1), [
      ['Fût bière blonde 30 L', 2 * scale, 'piece', 168.0 * scale, g.biere, 30000, 20],
      ['Côtes-du-Rhône AOP 75 cl x6', 3 * scale, 'carton', 81.0 * scale, g.vin, 4500, 20],
    ], { paid: true });
  } else {
    // Hausses récentes : déclenchent le recalcul et les alertes de rentabilité
    invoice(estId, 'Boucherie Laurent', `BL-${estId}-0498`, d(9), [
      ['Bœuf haché 15% MG', 10 * scale, 'kg', 134.0 * scale, g.boeuf],
    ], { paid: true });
    invoice(estId, 'Marée du Rhône', `MR-${estId}-802`, d(6), [
      ["Pavé saumon d'Écosse sans peau", 4 * scale, 'kg', 112.4 * scale, g.saumon],
    ]);
    invoice(estId, 'Primeurs Bellecour', `PB-${estId}-2350`, d(4), [
      ['Tomates grappe cat. 1', 5 * scale, 'kg', 16.25 * scale, g.tomate],
      ['Batavia', 12 * scale, 'piece', 10.8 * scale, g.salade],
      ['Pommes de terre Agria', 25 * scale, 'kg', 21.25 * scale, g.pdt],
    ]);
    invoice(estId, 'Metro Lyon', `MET-${estId}-89377`, d(2), [
      ['Cheddar affiné tranches', 2 * scale, 'kg', 29.8 * scale, g.cheddar],
      ['Crème liquide 35% UHT', 6 * scale, 'l', 32.4 * scale, g.creme],
      ['Produit dégraissant cuisine 5 L', 2, 'piece', 23.8, undefined, null, 20],
    ]);
  }
}

function dishes(estId) {
  const g = I[estId];
  const dish = (name, category, price, target, lines) => {
    const id = insert('INSERT INTO dishes (establishment_id, name, category, sale_price_ht, target_food_cost_pct, created_at) VALUES (?, ?, ?, ?, ?, ?)', estId, name, category, price, target, NOW);
    for (const [ing, q] of lines) {
      const base = get('SELECT base_unit FROM ingredients WHERE id = ?', ing).base_unit;
      insert('INSERT INTO recipe_lines (dish_id, ingredient_id, quantity, unit) VALUES (?, ?, ?, ?)', id, ing, q, base);
    }
    snapshotDish(get('SELECT * FROM dishes WHERE id = ?', id), { cause: 'création', alert: false });
    run('UPDATE dish_cost_history SET created_at = ? WHERE dish_id = ?', `${addDays(T, -12)}T10:00:00`, id);
    return id;
  };
  dish('Burger du Comptoir et frites maison', 'Plats', 16.36, 28, [[g.boeuf, 160], [g.pain, 1], [g.cheddar, 35], [g.tomate, 40], [g.salade, 0.1], [g.moutarde, 8], [g.pdt, 220], [g.huile, 35]]);
  dish('Tagliatelles au saumon et citron', 'Plats', 17.27, 30, [[g.pates, 140], [g.saumon, 110], [g.creme, 80], [g.parmesan, 15], [g.citron, 0.25]]);
  dish('Fondant au chocolat', 'Desserts', 7.27, 22, [[g.chocolat, 60], [g.beurre, 45], [g.oeufs, 1.5], [g.sucre, 40], [g.farine, 20]]);
  dish('Frites maison', 'Accompagnements', 4.55, 18, [[g.pdt, 250], [g.huile, 40]]);
  dish('Pinte de blonde', 'Boissons', 6.36, 22, [[g.biere, 500]]);
  dish('Verre de Côtes-du-Rhône', 'Boissons', 5.0, 25, [[g.vin, 120]]);
}

for (const [estId, scale, weekly] of [[est1, 1, 3], [est2, 1, 2], [est3, 1, 2]]) {
  // approvisionnement hebdomadaire régulier sur 10 semaines
  for (let w = 10; w >= 2; w--) purchases(estId, weekly, true, w * 7 + 1, `-S${w}`);
  dishes(estId);
  purchases(estId, scale, false);
}
// stocks réalistes (certains sous le minimum pour illustrer les commandes)
for (const estId of [est1, est2, est3]) {
  const g = I[estId];
  run('UPDATE ingredients SET stock = min_stock * 1.6 WHERE establishment_id = ?', estId);
  run('UPDATE ingredients SET stock = ? WHERE id = ?', 3200, g.boeuf);
  run('UPDATE ingredients SET stock = ? WHERE id = ?', 18, g.pain);
  run('UPDATE ingredients SET stock = ? WHERE id = ?', 600, g.parmesan);
}

// Facture en brouillon à compléter : produit jamais vu, à relier à un ingrédient
const draft = insert(
  `INSERT INTO invoices (establishment_id, supplier_name, invoice_number, invoice_date, delivery_date, due_date, status, ai_status, ai_message, created_by, created_at)
   VALUES (?, 'Metro Lyon', ?, ?, ?, ?, 'brouillon', 'manuel', 'Saisie manuelle.', ?, ?)`,
  est1, `MET-${est1}-89510`, T, T, due(T), resto, NOW,
);
run('UPDATE invoices SET supplier_id = (SELECT id FROM suppliers WHERE establishment_id = ? AND name = ?) WHERE id = ?', est1, 'Metro Lyon', draft);
[
  ['Mozzarella di bufala 125 g x8', 3, 'carton', 38.4, 5.5],
  ['Beurre doux 82%', 5, 'kg', 43.5, 5.5],
  ['Tagliatelles fraîches', 4, 'kg', 25.8, 5.5],
].forEach(([n, q, u, p, t], i) => insert('INSERT INTO invoice_lines (invoice_id, position, product_name, quantity, unit, purchase_price_ht, tva_rate) VALUES (?, ?, ?, ?, ?, ?, ?)', draft, i, n, q, u, p, t));
const { autoLinkLines } = await import('./foodcost.js');
autoLinkLines(draft);

// échéances : quelques factures à payer bientôt / en retard
run("UPDATE invoices SET due_date = ? WHERE invoice_number = ?", addDays(T, -3), `MR-${est1}-802`);
run("UPDATE invoices SET due_date = ? WHERE invoice_number = ?", addDays(T, 12), `PB-${est1}-2350`);

// ---------- Chiffre d'affaires quotidien ----------
for (const [estId, base] of [[est1, 1350], [est2, 950], [est3, 950]]) {
  for (let i = 75; i >= 1; i--) {
    const d = addDays(T, -i);
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow === 1) continue; // fermé le lundi
    const factor = dow === 5 || dow === 6 ? 1.35 : dow === 0 ? 0.8 : 1;
    const revenue = Math.round(base * factor * (0.85 + rnd() * 0.3) * 100) / 100;
    const covers = Math.round(revenue / (24 + rnd() * 6));
    insert('INSERT INTO daily_sales (establishment_id, date, revenue_ht, vat_collected, covers) VALUES (?, ?, ?, ?, ?)', estId, d, revenue, Math.round(revenue * 0.112 * 100) / 100, covers);
  }
}

// ---------- HACCP ----------
for (const estId of [est1, est2, est3]) {
  const eqs = [
    ['Chambre froide positive', 'Froid positif', 0, 4],
    ['Réfrigérateur cuisine', 'Froid positif', 0, 4],
    ['Congélateur', 'Froid négatif', -25, -18],
    ['Vitrine desserts', 'Froid positif', 2, 6],
  ].map(([n, k, a, b]) => insert('INSERT INTO equipment (establishment_id, name, kind, min_temp, max_temp) VALUES (?, ?, ?, ?, ?)', estId, n, k, a, b));
  for (let i = 14; i >= 0; i--) {
    const d = addDays(T, -i);
    for (const time of ['09:05:00', '17:40:00']) {
      if (i === 0 && time > NOW.slice(11)) continue;
      for (const eq of eqs) {
        const e = get('SELECT * FROM equipment WHERE id = ?', eq);
        let v = Math.round((e.min_temp + (e.max_temp - e.min_temp) * (0.25 + rnd() * 0.5)) * 10) / 10;
        let comment = null;
        if (estId === est1 && i === 3 && time === '17:40:00' && e.name === 'Réfrigérateur cuisine') {
          v = 6.4; comment = 'Porte mal fermée après le service. Produits contrôlés, porte refermée, nouveau relevé à 3,2 °C 30 min plus tard.';
        }
        insert('INSERT INTO temperature_readings (equipment_id, establishment_id, value, min_temp, max_temp, out_of_range, taken_at, taken_by, comment) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          eq, estId, v, e.min_temp, e.max_temp, v < e.min_temp || v > e.max_temp ? 1 : 0, `${d}T${time}`, pick(['Lucas Petit', 'Inès Moreau', 'Camille Martin']), comment);
      }
    }
  }
  const dlc = [
    ['Crème liquide 35 % (lot ouvert)', 'livre', 'DLC', -1, 'L2304A'],
    ['Pavés de saumon', 'livre', 'DLC', 1, 'SC-7781'],
    ['Mozzarella di bufala', 'livre', 'DLC', 2, '24-118'],
    ['Sauce burger maison', 'maison', 'DLC', 0, null],
    ['Fond de veau maison', 'maison', 'DLC', 3, null],
    ['Cheddar en tranches', 'livre', 'DLC', 9, 'CH0921'],
    ['Pâte à fondant (portions)', 'maison', 'DLC', 2, null],
    ['Moutarde de Dijon', 'livre', 'DDM', 120, 'MD55'],
  ];
  for (const [name, origin, type, offset, lot] of dlc) {
    insert('INSERT INTO dlc_items (establishment_id, product_name, origin, date_type, dlc_date, lot_number, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      estId, name, origin, type, addDays(T, offset), lot, NOW);
  }
  const tasks = [
    ['Cuisine', 'Plans de travail et planches : nettoyage et désinfection', 'quotidienne'],
    ['Cuisine', 'Sols cuisine : lavage', 'quotidienne'],
    ['Cuisine', 'Hotte et filtres : dégraissage', 'hebdomadaire'],
    ['Plonge', 'Lave-vaisselle : vidange et détartrage', 'hebdomadaire'],
    ['Stockage', 'Chambre froide : nettoyage complet', 'hebdomadaire'],
    ['Stockage', 'Congélateur : dégivrage', 'mensuelle'],
    ['Salle', 'Tables, chaises et menus : désinfection', 'quotidienne'],
    ['Sanitaires', 'Sanitaires clients : nettoyage', 'quotidienne'],
  ].map(([z, n, f]) => [insert('INSERT INTO cleaning_tasks (establishment_id, zone, name, frequency) VALUES (?, ?, ?, ?)', estId, z, n, f), f]);
  for (let i = 20; i >= 1; i--) {
    const d = addDays(T, -i);
    for (const [task, f] of tasks) {
      if (f === 'hebdomadaire' && i % 7 !== 2) continue;
      if (f === 'mensuelle' && i !== 12) continue;
      insert('INSERT INTO cleaning_logs (task_id, establishment_id, done_at, done_by) VALUES (?, ?, ?, ?)', task, estId, `${d}T${f === 'quotidienne' ? '23:10:00' : '15:30:00'}`, pick(['Hugo Garnier', 'Inès Moreau', 'Lucas Petit']));
    }
  }
}

// ---------- Plannings et pointages ----------
const week = mondayOf(T);
const patterns = {
  [lucas]: [null, ['09:30', '15:00', 30], ['09:30', '15:00', 30], ['09:30', '23:00', 90], ['09:30', '23:00', 90], ['09:30', '23:00', 90], ['10:00', '16:00', 30]],
  [sarah]: [null, ['11:30', '15:00', 0], ['18:30', '23:30', 0], ['11:30', '15:00', 0], ['11:00', '23:30', 90], ['11:00', '23:30', 90], ['11:30', '16:00', 0]],
  [ines]: [null, ['09:00', '15:00', 30], null, ['09:00', '15:00', 30], ['17:00', '23:30', 30], ['09:00', '23:00', 120], ['09:30', '16:00', 30]],
  [hugo]: [null, null, ['18:00', '23:30', 0], ['18:00', '23:30', 0], ['18:00', '00:30', 0], ['18:00', '00:30', 0], null],
  [tom]: [null, ['09:30', '22:30', 120], ['09:30', '22:30', 120], ['09:30', '15:00', 0], ['09:30', '22:30', 120], ['09:30', '22:30', 120], null],
  [lea]: [null, ['11:30', '15:00', 0], ['11:30', '22:30', 90], null, ['11:30', '22:30', 90], ['11:30', '22:30', 90], ['11:30', '15:30', 0]],
  [nadia]: [['09:00', '15:00', 30], ['09:00', '15:00', 30], null, ['09:00', '22:00', 120], ['09:00', '22:00', 120], ['09:00', '22:00', 120], null],
};
const estOf = (c) => get('SELECT establishment_id FROM collaborators WHERE id = ?', c).establishment_id;
const plus = (time, min) => {
  const [h, m] = time.split(':').map(Number);
  const t = h * 60 + m + min;
  const dayShift = Math.floor(t / 1440);
  const r = ((t % 1440) + 1440) % 1440;
  return [`${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}:00`, dayShift];
};
for (const [cid, pat] of Object.entries(patterns)) {
  const c = Number(cid);
  for (const wk of [addDays(week, -14), addDays(week, -7), week, addDays(week, 7)]) {
    pat.forEach((p, i) => {
      if (!p) return;
      const d = addDays(wk, i);
      insert('INSERT INTO shifts (establishment_id, collaborator_id, date, start_time, end_time, break_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        estOf(c), c, d, p[0], p[1], p[2], NOW, NOW);
      if (d >= T) return;
      // pointages réalistes autour du planning (quelques minutes d'écart)
      const ev = (type, time, dayOffset = 0) => insert('INSERT INTO clock_events (collaborator_id, establishment_id, type, at, created_at) VALUES (?, ?, ?, ?, ?)', c, estOf(c), type, `${addDays(d, dayOffset)}T${time}`, NOW);
      const [a] = plus(p[0], Math.round(rnd() * 12) - 6);
      ev('arrivee', a);
      if (p[2] > 0) {
        const [s] = plus(p[0], 150 + Math.round(rnd() * 20));
        const [e] = plus(p[0], 150 + p[2] + Math.round(rnd() * 10));
        ev('debut_pause', s);
        ev('fin_pause', e);
      }
      if (c === sarah && d === addDays(T, -2)) return; // oubli de pointage au départ
      const [end, off] = plus(p[1], Math.round(rnd() * 25) - 5);
      ev('depart', end, off);
    });
  }
}
// En direct : Lucas et Inès sont arrivés aujourd'hui
const nowTime = NOW.slice(11, 16);
if (nowTime > '09:40') {
  insert('INSERT INTO clock_events (collaborator_id, establishment_id, type, at, created_at) VALUES (?, ?, ?, ?, ?)', lucas, est1, 'arrivee', `${T}T09:27:00`, NOW);
  insert('INSERT INTO clock_events (collaborator_id, establishment_id, type, at, created_at) VALUES (?, ?, ?, ?, ?)', ines, est1, 'arrivee', `${T}T09:04:00`, NOW);
}
// heures de la semaine dernière validées
const { hoursSummary } = await import('./hours.js');
for (const c of [lucas, sarah, ines, hugo, tom, lea]) {
  for (const day of hoursSummary(c, addDays(week, -14), addDays(week, -1)).days) {
    if (day.worked_minutes > 0) insert('INSERT INTO hours_validations (collaborator_id, date, validated_minutes, validated_by, validated_at) VALUES (?, ?, ?, ?, ?)', c, day.date, day.worked_minutes, resto, NOW);
  }
}
// demande de correction en attente (Sarah a oublié de pointer son départ)
run('DELETE FROM hours_validations WHERE collaborator_id = ? AND date = ?', sarah, addDays(T, -2));
insert(`INSERT INTO correction_requests (collaborator_id, establishment_id, action, event_type, requested_at, reason, created_at) VALUES (?, ?, 'ajouter', 'depart', ?, ?, ?)`,
  sarah, est1, `${addDays(T, -2)}T23:35:00`, "J'ai oublié de pointer mon départ après la fermeture.", NOW);

// ---------- Commandes, marketing, messagerie, notes de frais ----------
const mk = (estId, title, desc, dueIn, done) => insert('INSERT INTO marketing_tasks (establishment_id, title, description, due_date, status, done_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  estId, title, desc, dueIn == null ? null : addDays(T, dueIn), done ? 'faite' : 'a_faire', done ? addDays(T, -2) : null, NOW);
mk(est1, 'Mettre à jour les horaires sur la fiche Google', "Ajouter la fermeture exceptionnelle du 1er novembre.", 3, false);
mk(est1, 'Photographier la nouvelle carte d’automne', 'Lumière naturelle, en fin de matinée.', 7, false);
mk(est1, 'Répondre aux avis de la semaine', null, -1, true);
mk(est1, 'Créer la page Instagram du restaurant', null, null, true);
const content = (estId, channel, title, body, status) => insert('INSERT INTO marketing_contents (establishment_id, channel, title, body, planned_for, status, source, created_at, decided_at, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  estId, channel, title, body, addDays(T, 2), status, 'modele', NOW, status !== 'a_valider' ? NOW : null, status === 'publiee' ? NOW : null);
content(est1, 'Instagram', 'Le burger du Comptoir', "Pain brioché, bœuf haché le matin même par la boucherie Laurent, cheddar affiné et frites coupées à la main. Notre burger, c'est tout ça. À découvrir midi et soir, rue Mercière.", 'a_valider');
content(est1, 'Facebook', 'Nouvelle carte d’automne', "La carte change avec la saison : tagliatelles fraîches au saumon et citron, et un fondant au chocolat qui fait déjà des adeptes. On vous attend !", 'a_valider');
content(est1, 'Google', 'Réponse aux avis', "Merci pour votre visite et votre gentil message ! Toute l'équipe du Comptoir est ravie que le burger vous ait plu. À très vite.", 'publiee');

insert('INSERT INTO messages (restaurateur_id, author_id, from_mizu, body, created_at) VALUES (?, ?, 0, ?, ?)', resto, resto, "Bonjour, est-il possible d'ajouter un deuxième utilisateur pour mon second de cuisine sur l'établissement Bistrot ?", `${addDays(T, -3)}T10:12:00`);
insert('INSERT INTO messages (restaurateur_id, author_id, from_mizu, body, created_at, read_at) VALUES (?, ?, 1, ?, ?, ?)', resto, get("SELECT id FROM users WHERE role = 'support'").id,
  "Bonjour Camille, oui bien sûr : depuis Plannings et équipe > Équipe, choisissez l'établissement Camille Bistrot puis « Ajouter un collaborateur ». Il recevra ses identifiants de connexion. Belle journée !", `${addDays(T, -3)}T11:02:00`, NOW);

for (const [estId, items] of [[est1, [['Péage A7 — salon Sirha', 12.4, 2.07, -20], ['Repas fournisseur — dégustation vins', 46.0, 4.18, -12], ['Carburant livraison traiteur', 58.3, 9.72, -6]]], [est3, [['Fournitures de bureau', 23.9, 3.98, -8]]]]) {
  for (const [label, ttc, tva, off] of items) {
    insert('INSERT INTO expense_reports (establishment_id, date, label, amount_ttc, vat_amount, category, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      estId, addDays(T, off), label, ttc, tva, classifyText(label), resto, NOW);
  }
}

// commandes proposées automatiquement pour les stocks bas
const { proposeOrders } = await import('./jobs.js');
for (const estId of [est1, est2, est3]) proposeOrders(estId);

console.log(`Base de démonstration créée (${all('SELECT id FROM users').length} comptes).`);
console.log(`Mot de passe de tous les comptes : ${PASSWORD}`);
console.log('  comptable@mizu.demo · restaurateur@mizu.demo · collaborateur@mizu.demo · support@mizu.demo');
process.exit(0);
