import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { all } from './db.js';
import { nowLocal } from './time.js';
import { dishesForEstablishment, UNIT_LABELS } from './foodcost.js';
import { EVENT_LABELS } from './hours.js';

// ---------- mise en forme ----------
// Les polices PDF standard ne connaissent pas l'espace fine insécable de fr-FR : on la remplace.
const clean = (s) => String(s ?? '').replace(/[  ]/g, ' ');
const eur = (n) => (n == null ? '' : clean(new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n)));
const frDate = (d) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '');
const frDateTime = (d) => (d ? `${frDate(d)} ${d.slice(11, 16)}` : '');
const hm = (min) => {
  const m = Math.round(min || 0);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

const INK = '#1d2b36';
const MUTED = '#6b7a86';
const ACCENT = '#2f6f8f';
const LINE = '#d9e1e7';

function pdfStart(res, filename, title, subtitle) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: title } });
  doc.pipe(res);
  doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(20).text('Mizu', { continued: true })
    .fillColor(MUTED).font('Helvetica').fontSize(10).text(`   ${clean(subtitle)}`);
  doc.moveDown(0.3).fillColor(INK).font('Helvetica-Bold').fontSize(15).text(clean(title));
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Document généré le ${frDateTime(nowLocal())}`);
  doc.moveDown(0.8);
  return doc;
}

function pdfEnd(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(8).fillColor(MUTED)
      .text(`Page ${i + 1} / ${range.count}`, 40, doc.page.height - 28, { align: 'right', width: doc.page.width - 80 });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}

function section(doc, title) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor(ACCENT).text(clean(title), 40);
  doc.moveDown(0.3);
}

/** Tableau simple : columns = [{ label, width, align, get }] */
function table(doc, columns, rows, { empty = 'Aucune donnée sur la période.' } = {}) {
  const x0 = 40;
  const total = columns.reduce((s, c) => s + c.width, 0);
  const scale = (doc.page.width - 80) / total;
  const cols = columns.map((c) => ({ ...c, w: c.width * scale }));
  const header = () => {
    let x = x0;
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(MUTED);
    for (const c of cols) {
      doc.text(clean(c.label), x + 3, y, { width: c.w - 6, align: c.align || 'left' });
      x += c.w;
    }
    doc.y = y + 13;
    doc.moveTo(x0, doc.y).lineTo(x0 + (doc.page.width - 80), doc.y).strokeColor(LINE).lineWidth(0.8).stroke();
    doc.y += 3;
  };
  header();
  if (!rows.length) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(empty, x0 + 3);
    doc.moveDown(0.5);
    return;
  }
  doc.font('Helvetica').fontSize(8.5);
  for (const r of rows) {
    const cells = cols.map((c) => clean(c.get(r)));
    const h = Math.max(...cells.map((t, i) => doc.heightOfString(t, { width: cols[i].w - 6 }))) + 5;
    if (doc.y + h > doc.page.height - 50) {
      doc.addPage();
      header();
      doc.font('Helvetica').fontSize(8.5);
    }
    let x = x0;
    const y = doc.y;
    cells.forEach((t, i) => {
      doc.fillColor(r._danger ? '#b42318' : INK).text(t, x + 3, y, { width: cols[i].w - 6, align: cols[i].align || 'left' });
      x += cols[i].w;
    });
    doc.y = y + h;
    doc.moveTo(x0, doc.y - 2).lineTo(x0 + (doc.page.width - 80), doc.y - 2).strokeColor('#eef2f5').lineWidth(0.5).stroke();
  }
  doc.moveDown(0.4);
}

function sheet(wb, name, columns, rows) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.xw || 16, style: c.numFmt ? { numFmt: c.numFmt } : undefined }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F6F8F' } };
  for (const r of rows) ws.addRow(Object.fromEntries(columns.map((c) => [c.key, c.xget ? c.xget(r) : c.get(r)])));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

async function sendWorkbook(res, wb, filename) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const EUR_FMT = '#,##0.00 "€"';

// ---------- Archive HACCP ----------
function haccpData(est, from, to) {
  return {
    readings: all(
      `SELECT t.*, e.name AS equipment FROM temperature_readings t JOIN equipment e ON e.id = t.equipment_id
       WHERE t.establishment_id = ? AND substr(t.taken_at,1,10) BETWEEN ? AND ? ORDER BY t.taken_at`, est.id, from, to,
    ),
    cleaning: all(
      `SELECT l.*, t.zone, t.name AS task, t.frequency FROM cleaning_logs l JOIN cleaning_tasks t ON t.id = l.task_id
       WHERE l.establishment_id = ? AND substr(l.done_at,1,10) BETWEEN ? AND ? ORDER BY l.done_at`, est.id, from, to,
    ),
    dlc: all(
      `SELECT * FROM dlc_items WHERE establishment_id = ? AND (substr(created_at,1,10) BETWEEN ? AND ? OR (status = 'actif'))
       ORDER BY dlc_date`, est.id, from, to,
    ),
    invoices: all(
      `SELECT * FROM invoices WHERE establishment_id = ? AND status = 'validee' AND COALESCE(delivery_date, invoice_date) BETWEEN ? AND ?
       ORDER BY COALESCE(delivery_date, invoice_date)`, est.id, from, to,
    ),
    dishes: dishesForEstablishment(est.id),
  };
}

const READING_COLS = [
  { label: 'Date et heure', key: 'taken_at', width: 18, get: (r) => frDateTime(r.taken_at), xw: 18 },
  { label: 'Équipement', key: 'equipment', width: 22, get: (r) => r.equipment, xw: 24 },
  { label: 'Relevé', key: 'value', width: 10, align: 'right', get: (r) => `${String(r.value).replace('.', ',')} °C`, xget: (r) => r.value },
  { label: 'Seuils', key: 'range', width: 14, get: (r) => `${r.min_temp} à ${r.max_temp} °C` },
  { label: 'Conforme', key: 'ok', width: 10, get: (r) => (r.out_of_range ? 'NON' : 'oui') },
  { label: 'Par', key: 'taken_by', width: 14, get: (r) => r.taken_by || '' },
  { label: 'Action corrective', key: 'comment', width: 24, get: (r) => r.comment || '', xw: 40 },
];
const CLEANING_COLS = [
  { label: 'Date et heure', key: 'done_at', width: 18, get: (r) => frDateTime(r.done_at), xw: 18 },
  { label: 'Zone', key: 'zone', width: 18, get: (r) => r.zone, xw: 20 },
  { label: 'Tâche', key: 'task', width: 30, get: (r) => r.task, xw: 34 },
  { label: 'Fréquence', key: 'frequency', width: 14, get: (r) => r.frequency },
  { label: 'Réalisée par', key: 'done_by', width: 16, get: (r) => r.done_by, xw: 20 },
];
const DLC_COLS = [
  { label: 'Produit', key: 'product_name', width: 30, get: (r) => r.product_name, xw: 30 },
  { label: 'Origine', key: 'origin', width: 12, get: (r) => (r.origin === 'maison' ? 'Préparation maison' : 'Livré') , xw: 18 },
  { label: 'Type', key: 'date_type', width: 8, get: (r) => r.date_type },
  { label: 'Date limite', key: 'dlc_date', width: 13, get: (r) => frDate(r.dlc_date) },
  { label: 'Lot', key: 'lot_number', width: 14, get: (r) => r.lot_number || '' },
  { label: 'Statut', key: 'status', width: 12, get: (r) => ({ actif: 'En stock', utilise: 'Utilisé', jete: 'Jeté' })[r.status] },
  { label: 'Enregistré le', key: 'created_at', width: 14, get: (r) => frDate(r.created_at) },
];
const INVOICE_COLS = [
  { label: 'Livraison', key: 'delivery_date', width: 12, get: (r) => frDate(r.delivery_date || r.invoice_date) },
  { label: 'Fournisseur', key: 'supplier_name', width: 26, get: (r) => r.supplier_name || '', xw: 26 },
  { label: 'N° facture', key: 'invoice_number', width: 16, get: (r) => r.invoice_number || '' },
  { label: 'Total HT', key: 'total_ht', width: 14, align: 'right', get: (r) => eur(r.total_ht), xget: (r) => r.total_ht, numFmt: EUR_FMT },
  { label: 'Total TTC', key: 'total_ttc', width: 14, align: 'right', get: (r) => eur(r.total_ttc), xget: (r) => r.total_ttc, numFmt: EUR_FMT },
  { label: 'Photo conservée', key: 'photo', width: 12, get: (r) => (r.photo_path ? 'oui' : 'non') },
];

export async function haccpExport(res, est, from, to, format) {
  const d = haccpData(est, from, to);
  const name = `controle-haccp-${slug(est.name)}-${from}-au-${to}`;
  const allergenRows = d.dishes.map((x) => ({ dish: x.name, allergens: x.allergens.join(', ') || 'Aucun allergène déclaré' }));
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Mizu';
    sheet(wb, 'Températures', READING_COLS, d.readings.map((r) => ({ ...r })));
    sheet(wb, 'Nettoyage', CLEANING_COLS, d.cleaning);
    sheet(wb, 'Dates limites', DLC_COLS, d.dlc);
    sheet(wb, 'Factures', INVOICE_COLS, d.invoices);
    sheet(wb, 'Allergènes', [{ label: 'Plat', key: 'dish', get: (r) => r.dish, xw: 30 }, { label: 'Allergènes', key: 'allergens', get: (r) => r.allergens, xw: 80 }], allergenRows);
    return sendWorkbook(res, wb, `${name}.xlsx`);
  }
  const doc = pdfStart(res, `${name}.pdf`, `Dossier de contrôle HACCP — ${est.name}`, `Période du ${frDate(from)} au ${frDate(to)}`);
  const outCount = d.readings.filter((r) => r.out_of_range).length;
  doc.font('Helvetica').fontSize(9.5).fillColor(INK)
    .text(`${d.readings.length} relevé(s) de température dont ${outCount} hors seuil · ${d.cleaning.length} nettoyage(s) réalisé(s) · ${d.dlc.length} produit(s) suivis en date limite · ${d.invoices.length} facture(s) fournisseur.`);
  section(doc, 'Relevés de température');
  table(doc, READING_COLS, d.readings.map((r) => ({ ...r, _danger: r.out_of_range })));
  section(doc, 'Plan de nettoyage — tâches réalisées');
  table(doc, CLEANING_COLS, d.cleaning);
  section(doc, 'Traçabilité des dates limites');
  table(doc, DLC_COLS, d.dlc);
  section(doc, 'Factures fournisseurs (traçabilité des livraisons)');
  table(doc, INVOICE_COLS, d.invoices);
  section(doc, 'Allergènes par plat');
  table(doc, [{ label: 'Plat', width: 30, get: (r) => r.dish }, { label: 'Allergènes (règlement UE 1169/2011)', width: 70, get: (r) => r.allergens }], allergenRows, { empty: 'Aucune fiche technique.' });
  pdfEnd(doc);
}

// ---------- Export comptable ----------
const EXPENSE_COLS = [
  { label: 'Date', key: 'date', width: 11, get: (r) => frDate(r.date) },
  { label: 'Type', key: 'kind', width: 14, get: (r) => r.kind, xw: 18 },
  { label: 'Établissement', key: 'establishment', width: 14, get: (r) => r.establishment, xw: 20 },
  { label: 'Libellé', key: 'label', width: 26, get: (r) => r.label, xw: 34 },
  { label: 'Catégorie', key: 'category', width: 18, get: (r) => r.category, xw: 26 },
  { label: 'HT', key: 'ht', width: 11, align: 'right', get: (r) => eur(r.ht), xget: (r) => r.ht, numFmt: EUR_FMT },
  { label: 'TVA', key: 'tva', width: 10, align: 'right', get: (r) => eur(r.tva), xget: (r) => r.tva, numFmt: EUR_FMT },
  { label: 'TTC', key: 'ttc', width: 11, align: 'right', get: (r) => eur(r.ttc), xget: (r) => r.ttc, numFmt: EUR_FMT },
];
const CATEGORY_COLS = [
  { label: 'Catégorie', key: 'category', width: 40, get: (r) => r.category, xw: 30 },
  { label: 'Pièces', key: 'count', width: 10, align: 'right', get: (r) => String(r.count), xget: (r) => r.count },
  { label: 'HT', key: 'ht', width: 16, align: 'right', get: (r) => eur(r.ht), xget: (r) => r.ht, numFmt: EUR_FMT },
  { label: 'TVA déductible', key: 'tva', width: 16, align: 'right', get: (r) => eur(r.tva), xget: (r) => r.tva, numFmt: EUR_FMT },
  { label: 'TTC', key: 'ttc', width: 16, align: 'right', get: (r) => eur(r.ttc), xget: (r) => r.ttc, numFmt: EUR_FMT },
];
const HOURS_COLS = [
  { label: 'Collaborateur', key: 'name', width: 24, get: (r) => r.name, xw: 24 },
  { label: 'Poste', key: 'job_title', width: 16, get: (r) => r.job_title || '', xw: 18 },
  { label: 'Établissement', key: 'establishment', width: 18, get: (r) => r.establishment, xw: 20 },
  { label: 'Jours', key: 'days_worked', width: 8, align: 'right', get: (r) => String(r.days_worked), xget: (r) => r.days_worked },
  { label: 'Prévues', key: 'planned', width: 11, align: 'right', get: (r) => hm(r.planned_minutes), xget: (r) => +(r.planned_minutes / 60).toFixed(2) },
  { label: 'Pointées', key: 'worked', width: 11, align: 'right', get: (r) => hm(r.worked_minutes), xget: (r) => +(r.worked_minutes / 60).toFixed(2) },
  { label: 'Validées', key: 'validated', width: 11, align: 'right', get: (r) => hm(r.validated_minutes), xget: (r) => +(r.validated_minutes / 60).toFixed(2) },
];
const DUE_COLS = [
  { label: 'Échéance', key: 'due_date', width: 12, get: (r) => frDate(r.due_date) },
  { label: 'Fournisseur', key: 'supplier', width: 28, get: (r) => r.supplier || '', xw: 28 },
  { label: 'N° facture', key: 'invoice_number', width: 16, get: (r) => r.invoice_number || '' },
  { label: 'Établissement', key: 'establishment', width: 18, get: (r) => r.establishment, xw: 20 },
  { label: 'Montant TTC', key: 'ttc', width: 14, align: 'right', get: (r) => eur(r.ttc), xget: (r) => r.ttc, numFmt: EUR_FMT },
  { label: 'Statut', key: 'state', width: 12, get: (r) => (r.overdue ? 'En retard' : r.soon ? 'Sous 15 jours' : 'À venir') },
];

export async function accountingExport(res, client, data, format) {
  const who = client.company || `${client.first_name} ${client.last_name}`;
  const name = `export-comptable-${slug(who)}-${data.from}-au-${data.to}`;
  const vatRows = [
    { label: "Chiffre d'affaires HT déclaré", value: data.vat.revenue_ht },
    { label: 'TVA collectée', value: data.vat.collected },
    { label: 'TVA déductible (factures et notes de frais)', value: data.vat.deductible },
    { label: data.vat.due >= 0 ? 'TVA à reverser (pré-calcul)' : 'Crédit de TVA (pré-calcul)', value: Math.abs(data.vat.due) },
  ];
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Mizu';
    sheet(wb, 'Dépenses', EXPENSE_COLS, data.expenses);
    sheet(wb, 'Par catégorie', CATEGORY_COLS, data.by_category);
    sheet(wb, 'TVA', [{ label: 'Poste', key: 'label', get: (r) => r.label, xw: 45 }, { label: 'Montant', key: 'value', get: (r) => r.value, numFmt: EUR_FMT, xw: 18 }], vatRows);
    sheet(wb, 'Heures', HOURS_COLS, data.hours);
    sheet(wb, 'Échéances', DUE_COLS, data.due_payments);
    return sendWorkbook(res, wb, `${name}.xlsx`);
  }
  const doc = pdfStart(res, `${name}.pdf`, `Export comptable — ${who}`, `Période du ${frDate(data.from)} au ${frDate(data.to)}`);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Établissement(s) : ${data.establishments.map((e) => e.name).join(', ')}`);
  section(doc, 'TVA à reverser (pré-calcul indicatif)');
  table(doc, [{ label: 'Poste', width: 70, get: (r) => r.label }, { label: 'Montant', width: 30, align: 'right', get: (r) => eur(r.value) }], vatRows);
  section(doc, 'Dépenses par catégorie');
  table(doc, CATEGORY_COLS, [...data.by_category, { category: 'Total', count: data.expenses.length, ...data.totals }]);
  section(doc, 'Détail des dépenses');
  table(doc, EXPENSE_COLS, data.expenses);
  section(doc, 'Heures effectuées par collaborateur');
  table(doc, HOURS_COLS, data.hours);
  section(doc, 'Échéances de paiement à venir');
  table(doc, DUE_COLS, data.due_payments.map((r) => ({ ...r, _danger: r.overdue })), { empty: 'Aucune échéance en attente.' });
  pdfEnd(doc);
}

// ---------- Bon de commande ----------
export function orderPdf(res, est, order) {
  const doc = pdfStart(res, `bon-de-commande-${order.id}.pdf`, `Bon de commande n° ${order.id}`, est.name);
  doc.font('Helvetica').fontSize(10).fillColor(INK)
    .text(`Fournisseur : ${clean(order.supplier_name || '')}`)
    .text(`Établissement : ${clean(est.name)}${est.address ? ` — ${clean(est.address)}` : ''}`)
    .text(`Validée le : ${frDateTime(order.validated_at)}`);
  section(doc, 'Produits commandés');
  table(doc, [
    { label: 'Produit', width: 60, get: (r) => r.label },
    { label: 'Quantité', width: 20, align: 'right', get: (r) => String(r.quantity).replace('.', ',') },
    { label: 'Unité', width: 20, get: (r) => UNIT_LABELS[r.unit] || r.unit },
  ], order.lines);
  if (order.note) doc.moveDown().font('Helvetica-Oblique').fontSize(9).fillColor(MUTED).text(clean(order.note));
  pdfEnd(doc);
}

export { EVENT_LABELS };
