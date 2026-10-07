import { all } from './db.js';
import { today, addDays } from './time.js';
import { hoursSummary } from './hours.js';

const placeholders = (arr) => arr.map(() => '?').join(',');

/** Données comptables d'un restaurateur sur une période (lecture seule). */
export function accountingData(establishments, from, to) {
  const ids = establishments.map((e) => e.id);
  if (!ids.length) {
    return { from, to, establishments: [], expenses: [], by_category: [], vat: { collected: 0, deductible: 0, due: 0, revenue_ht: 0 }, hours: [], due_payments: [] };
  }
  const estName = Object.fromEntries(establishments.map((e) => [e.id, e.name]));
  const invoices = all(
    `SELECT * FROM invoices WHERE establishment_id IN (${placeholders(ids)}) AND status = 'validee'
     AND COALESCE(invoice_date, delivery_date) BETWEEN ? AND ? ORDER BY COALESCE(invoice_date, delivery_date)`,
    ...ids, from, to,
  );
  const reports = all(
    `SELECT * FROM expense_reports WHERE establishment_id IN (${placeholders(ids)}) AND date BETWEEN ? AND ? ORDER BY date`,
    ...ids, from, to,
  );
  const expenses = [
    ...invoices.map((i) => ({
      kind: 'Facture fournisseur', id: i.id, date: i.invoice_date || i.delivery_date, establishment: estName[i.establishment_id],
      label: `${i.supplier_name || 'Fournisseur'}${i.invoice_number ? ` · n° ${i.invoice_number}` : ''}`,
      category: i.expense_category || 'Autres', ht: i.total_ht || 0, tva: i.total_tva || 0, ttc: i.total_ttc || 0,
      photo_path: i.photo_path, due_date: i.due_date, paid_at: i.paid_at,
    })),
    ...reports.map((r) => ({
      kind: 'Note de frais', id: r.id, date: r.date, establishment: estName[r.establishment_id], label: r.label,
      category: r.category || 'Autres', ht: r.amount_ttc - r.vat_amount, tva: r.vat_amount, ttc: r.amount_ttc,
      photo_path: r.photo_path, due_date: null, paid_at: r.date,
    })),
  ].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  const cats = new Map();
  for (const e of expenses) {
    const c = cats.get(e.category) || { category: e.category, count: 0, ht: 0, tva: 0, ttc: 0 };
    c.count++; c.ht += e.ht; c.tva += e.tva; c.ttc += e.ttc;
    cats.set(e.category, c);
  }

  const sales = all(
    `SELECT SUM(revenue_ht) AS revenue, SUM(vat_collected) AS vat FROM daily_sales
     WHERE establishment_id IN (${placeholders(ids)}) AND date BETWEEN ? AND ?`,
    ...ids, from, to,
  )[0];
  const deductible = expenses.reduce((s, e) => s + e.tva, 0);
  const collected = sales?.vat || 0;

  const collabs = all(
    `SELECT c.*, u.first_name, u.last_name FROM collaborators c JOIN users u ON u.id = c.user_id
     WHERE c.establishment_id IN (${placeholders(ids)}) ORDER BY u.last_name, u.first_name`,
    ...ids,
  );
  const hours = collabs.map((c) => {
    const s = hoursSummary(c.id, from, to);
    return {
      id: c.id, name: `${c.first_name} ${c.last_name}`.trim(), job_title: c.job_title, establishment: estName[c.establishment_id],
      planned_minutes: s.planned_minutes, worked_minutes: s.worked_minutes, validated_minutes: s.validated_minutes,
      days_worked: s.days.filter((d) => d.worked_minutes > 0).length,
    };
  }).filter((h) => h.planned_minutes || h.worked_minutes);

  const t = today();
  const due = all(
    `SELECT * FROM invoices WHERE establishment_id IN (${placeholders(ids)}) AND status = 'validee' AND paid_at IS NULL
     AND due_date IS NOT NULL ORDER BY due_date`,
    ...ids,
  ).map((i) => ({
    id: i.id, establishment: estName[i.establishment_id], supplier: i.supplier_name, invoice_number: i.invoice_number,
    due_date: i.due_date, ttc: i.total_ttc || 0, overdue: i.due_date < t, soon: i.due_date >= t && i.due_date <= addDays(t, 15),
  }));

  return {
    from, to,
    establishments,
    expenses,
    by_category: [...cats.values()].sort((a, b) => b.ht - a.ht),
    totals: {
      ht: expenses.reduce((s, e) => s + e.ht, 0),
      tva: deductible,
      ttc: expenses.reduce((s, e) => s + e.ttc, 0),
    },
    vat: { revenue_ht: sales?.revenue || 0, collected, deductible, due: collected - deductible },
    hours,
    due_payments: due,
  };
}
