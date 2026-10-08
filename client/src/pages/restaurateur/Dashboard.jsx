import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { useEst } from './RestaurateurApp.jsx';
import { Badge, Button, Card, ErrorBox, Field, Icon, PageHeader, PeriodPicker, PhotoButton, Segmented, Spinner, Stat, periodRange, useAction, useLoad } from '../../ui.jsx';
import { ColumnChart } from '../../Chart.jsx';
import { useRealtime } from '../../realtime.js';
import { setPendingFile } from '../../pending.js';
import { eur, eur0, pct, dateShort, dayName, date, todayIso } from '../../format.js';

function Delta({ now, before, invert = false }) {
  if (now == null || before == null || before === 0) return null;
  const d = ((now - before) / Math.abs(before)) * 100;
  const good = invert ? d <= 0 : d >= 0;
  return <span className={good ? 'delta-up' : 'delta-down'}>{d >= 0 ? '+' : '−'}{pct(Math.abs(d), 0)}</span>;
}

function autoGroup(p) {
  if (p.kind === 'day' || p.kind === 'week' || p.kind === 'month') return 'day';
  const days = (Date.parse(p.to) - Date.parse(p.from)) / 86400000 + 1;
  return days <= 45 ? 'day' : days <= 190 ? 'week' : 'month';
}

function bucketLabel(key, group) {
  if (group === 'month') return dateShort(`${key}-01`).split(' ')[1];
  if (group === 'week') return `sem. ${dateShort(key)}`;
  return dateShort(key);
}

function SalesEntry({ path, today, onSaved }) {
  const [form, setForm] = useState({ date: todayIso(), revenue_ht: today?.revenue_ht ?? '', covers: today?.covers ?? '', vat_collected: today?.vat_collected ?? '' });
  const [run, busy] = useAction();
  return (
    <form className="stack" onSubmit={(e) => {
      e.preventDefault();
      run(async () => {
        await api.put(path(`/sales/${form.date}`), form);
        onSaved();
      }, "Chiffre d'affaires enregistré");
    }}>
      <div className="form-grid">
        <Field label="Date"><input type="date" value={form.date} max={todayIso()} onChange={(e) => setForm({ ...form, date: e.target.value })} required /></Field>
        <Field label="CA HT"><div className="input-suffix"><input inputMode="decimal" value={form.revenue_ht} onChange={(e) => setForm({ ...form, revenue_ht: e.target.value })} required placeholder="0,00" /><span>€</span></div></Field>
        <Field label="Couverts"><input inputMode="numeric" value={form.covers} onChange={(e) => setForm({ ...form, covers: e.target.value })} /></Field>
        <Field label="TVA collectée" hint="Vide : 10 % du CA HT"><div className="input-suffix"><input inputMode="decimal" value={form.vat_collected} onChange={(e) => setForm({ ...form, vat_collected: e.target.value })} /><span>€</span></div></Field>
      </div>
      <div><Button type="submit" variant="primary" loading={busy} icon="check">Enregistrer</Button></div>
    </form>
  );
}

export default function Dashboard() {
  const { est, path } = useEst();
  const navigate = useNavigate();
  const [period, setPeriod] = useState({ kind: 'week', ...periodRange('week') });
  const [group, setGroup] = useState(null);
  const [view, setView] = useState('chart');
  const [run] = useAction();
  const g = group || autoGroup(period);
  const { data, error, loading, reload } = useLoad(() => api.get(path(`/dashboard?from=${period.from}&to=${period.to}&group=${g}`)), [period.from, period.to, g]);
  useRealtime('pointage', () => reload(true));
  useRealtime('refresh', () => reload(true));

  const uploadInvoice = (file) => run(async () => {
    const fd = new FormData();
    fd.append('photo', file);
    const { invoice } = await api.post(path('/invoices'), fd);
    navigate(`/restaurateur/factures/${invoice.id}`);
  });

  const t = data?.totals;
  const prev = data?.previous;
  const cmp = data?.compared.current;
  const rows = (data?.series || []).map((s) => ({
    label: g === 'day' && period.kind === 'week' ? `${dayName(s.key)} ${s.key.slice(8)}` : bucketLabel(s.key, g),
    tip: g === 'day' ? date(s.key) : bucketLabel(s.key, g),
    revenue: s.revenue, margin: s.margin, purchases: s.purchases,
  }));

  return (
    <>
      <div className="quick" aria-label="Actions rapides">
        <PhotoButton className="quick__btn quick__btn--primary" variant="" onFile={uploadInvoice} icon="camera">Photographier une facture</PhotoButton>
        <PhotoButton className="quick__btn" variant="" icon="tag" onFile={(f) => { setPendingFile('label', f); navigate('/restaurateur/haccp/dates?etiquette=1'); }}>Photographier une étiquette</PhotoButton>
        <Link className="quick__btn" to="/restaurateur/haccp/temperatures?saisie=1"><span className="quick__icon"><Icon name="thermo" /></span>Saisir une température</Link>
        <Link className="quick__btn" to="/restaurateur/equipe/direct"><span className="quick__icon"><Icon name="clock" /></span>Voir qui a pointé{data ? ` (${data.team.present + data.team.pause})` : ''}</Link>
        <Link className="quick__btn" to="/restaurateur/commandes"><span className="quick__icon"><Icon name="truck" /></span>Valider une commande{data?.pending.orders ? ` (${data.pending.orders})` : ''}</Link>
      </div>

      <PageHeader
        title="Tableau de bord"
        subtitle={`${est.name} · du ${date(period.from)} au ${date(period.to)}`}
        actions={<PeriodPicker value={period} onChange={(p) => { setPeriod(p); setGroup(null); }} />}
      />
      <ErrorBox error={error} onRetry={reload} />
      {loading && !data ? <Spinner /> : data && (
        <>
          <div className="grid grid-4">
            <Stat icon="trend" label="Chiffre d'affaires HT" value={eur0(t.revenue)} sub={<><Delta now={cmp.revenue} before={prev.revenue} /> vs période précédente</>} />
            <Stat icon="pie" label="Marge brute" value={eur0(t.margin)} tone={t.margin < 0 ? 'danger' : undefined} sub={<>{pct(t.margin_pct)} du CA · <Delta now={cmp.margin} before={prev.margin} /></>} />
            <Stat icon="receipt" label="Achats matières HT" value={eur0(t.purchases)} sub={<>Food cost réel {pct(t.food_cost_pct)}</>} />
            <Stat icon="users" label="Couverts" value={t.covers || '—'} sub={t.average_ticket ? `Ticket moyen HT ${eur(t.average_ticket)}` : 'Ticket moyen —'} />
          </div>

          <div className="grid grid-main section">
            <Card
              title="Chiffre d'affaires et marge"
              subtitle="Marge brute = CA HT − achats de marchandises HT (factures validées, par date de livraison)"
              actions={<>
                {period.kind === 'custom' && <Segmented size="sm" value={g} onChange={setGroup} options={[{ value: 'day', label: 'Jour' }, { value: 'week', label: 'Semaine' }, { value: 'month', label: 'Mois' }]} />}
                <Segmented size="sm" value={view} onChange={setView} options={[{ value: 'chart', label: 'Graphique' }, { value: 'table', label: 'Tableau' }]} />
              </>}
            >
              {!t.revenue && !t.purchases ? (
                <p className="muted small">Aucune donnée sur cette période. Saisissez votre chiffre d'affaires quotidien ci-contre.</p>
              ) : view === 'chart' ? (
                <ColumnChart rows={rows} format={eur} tickFormat={(v) => eur0(v).replace(/\s?€/, ' €')}
                  series={[{ key: 'revenue', label: 'CA HT', color: 'var(--chart-1)' }, { key: 'margin', label: 'Marge brute', color: 'var(--chart-2)' }]} />
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Période</th><th className="num">CA HT</th><th className="num">Achats HT</th><th className="num">Marge brute</th><th className="num">Marge %</th></tr></thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.tip}><td>{r.tip}</td><td className="num">{eur(r.revenue)}</td><td className="num">{eur(r.purchases)}</td><td className="num">{eur(r.margin)}</td><td className="num">{r.revenue ? pct((r.margin / r.revenue) * 100) : '—'}</td></tr>
                      ))}
                    </tbody>
                    <tfoot><tr><td>Total</td><td className="num">{eur(t.revenue)}</td><td className="num">{eur(t.purchases)}</td><td className="num">{eur(t.margin)}</td><td className="num">{pct(t.margin_pct)}</td></tr></tfoot>
                  </table>
                </div>
              )}
            </Card>

            <div className="stack">
              <Card title="Saisir le chiffre d'affaires">
                <SalesEntry key={est.id} path={path} today={data.today_sales} onSaved={() => reload(true)} />
              </Card>
              <Card title="À traiter">
                <div className="list">
                  {[
                    { n: data.pending.draft_invoices, label: 'facture(s) à vérifier', to: '/restaurateur/factures', icon: 'receipt' },
                    { n: data.pending.dlc_soon, label: 'produit(s) proches de la date limite', to: '/restaurateur/haccp/dates', icon: 'alert', tone: 'danger' },
                    { n: data.pending.orders, label: 'commande(s) à valider', to: '/restaurateur/commandes', icon: 'truck' },
                    { n: data.pending.corrections, label: 'correction(s) de pointage', to: '/restaurateur/equipe/corrections', icon: 'clock' },
                    { n: data.pending.marketing, label: 'contenu(s) marketing à valider', to: '/restaurateur/marketing', icon: 'megaphone' },
                  ].filter((x) => x.n > 0).map((x) => (
                    <Link key={x.to} to={x.to} className="list__item" style={{ color: 'inherit', textDecoration: 'none' }}>
                      <span className={`list__icon ${x.tone === 'danger' ? 'list__icon--danger' : 'list__icon--accent'}`}><Icon name={x.icon} size={18} /></span>
                      <span className="grow"><strong>{x.n}</strong> {x.label}</span>
                      <Icon name="right" size={16} className="muted" />
                    </Link>
                  ))}
                  {!Object.values(data.pending).some(Boolean) && <p className="muted small">Rien en attente. 👌</p>}
                </div>
              </Card>
            </div>
          </div>

          <div className="grid grid-2 section">
            <Card title="Rentabilité des plats" actions={<Link to="/restaurateur/food-cost" className="small">Voir le food cost</Link>}>
              <p className="small muted" style={{ marginBottom: 10 }}>Food cost théorique moyen de la carte : <strong className="text-ink">{pct(data.theoretical_food_cost_pct)}</strong></p>
              {data.dishes_over_target.length ? (
                <div className="list">
                  {data.dishes_over_target.map((d) => (
                    <Link key={d.id} to={`/restaurateur/food-cost/${d.id}`} className="list__item" style={{ color: 'inherit', textDecoration: 'none' }}>
                      <span className="list__icon list__icon--warning"><Icon name="alert" size={18} /></span>
                      <span className="grow">{d.name}</span>
                      <Badge tone="danger">{pct(d.food_cost_pct)}</Badge>
                      <span className="muted small nowrap">cible {pct(d.target, 0)}</span>
                    </Link>
                  ))}
                </div>
              ) : <p className="small"><Icon name="check" size={16} className="text-success" /> Tous les plats sont sous leur food cost cible.</p>}
            </Card>
            <Card title="Équipe aujourd'hui" actions={<Link to="/restaurateur/equipe/direct" className="small">En direct</Link>}>
              <div className="grid grid-3">
                <Stat label="Au travail" value={data.team.present} tone="success" />
                <Stat label="En pause" value={data.team.pause} />
                <Stat label="Équipe" value={data.team.total} />
              </div>
            </Card>
          </div>
          <p className="tiny muted section">Évolutions calculées du {date(period.from)} au {date(data.compared.until)}, comparées à la période du {date(data.compared.from)} au {date(data.compared.to)}.</p>
        </>
      )}
    </>
  );
}
