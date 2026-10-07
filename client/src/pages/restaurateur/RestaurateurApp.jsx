import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from '../../AppShell.jsx';
import { api } from '../../api.js';
import { Button, Field, Icon, Modal, Spinner, ErrorBox, useAction, useLoad } from '../../ui.jsx';
import { useRealtime } from '../../realtime.js';
import Dashboard from './Dashboard.jsx';
import Invoices from './Invoices.jsx';
import InvoiceDetail from './InvoiceDetail.jsx';
import FoodCost from './FoodCost.jsx';
import DishDetail from './DishDetail.jsx';
import Haccp from './Haccp.jsx';
import Team from './Team.jsx';
import Orders from './Orders.jsx';
import Marketing from './Marketing.jsx';
import Contact from './Contact.jsx';

const EstContext = createContext(null);
/** Établissement sélectionné + helper d'URL d'API pour cet établissement. */
export const useEst = () => useContext(EstContext);

const STORAGE_KEY = 'mizu.establishment';

function EstablishmentSelect({ establishments, value, onChange, onAdd }) {
  return (
    <div className="est-select">
      <Icon name="building" size={17} />
      <select
        value={value ?? ''}
        aria-label="Établissement"
        onChange={(e) => (e.target.value === '__new' ? onAdd() : onChange(Number(e.target.value)))}
      >
        {establishments.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        <option value="__new">+ Ajouter un établissement…</option>
      </select>
    </div>
  );
}

function NewEstablishment({ open, onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', address: '' });
  const [run, busy] = useAction();
  return (
    <Modal open={open} onClose={onClose} title="Nouvel établissement"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant="primary" loading={busy} onClick={() => run(async () => {
        const { establishment } = await api.post('/api/r/establishments', form);
        setForm({ name: '', address: '' });
        onCreated(establishment);
      }, 'Établissement créé')}>Créer</Button></>}>
      <div className="stack">
        <Field label="Nom"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. : Le Comptoir de la gare" autoFocus /></Field>
        <Field label="Adresse"><input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

export default function RestaurateurApp() {
  const { data, error, loading, reload } = useLoad(() => api.get('/api/r/establishments'));
  const [selected, setSelected] = useState(() => Number(localStorage.getItem(STORAGE_KEY)) || null);
  const [adding, setAdding] = useState(false);
  const [badges, setBadges] = useState({});

  const establishments = data?.establishments || [];
  const est = establishments.find((e) => e.id === selected) || establishments[0] || null;

  useEffect(() => {
    if (est) {
      try { localStorage.setItem(STORAGE_KEY, String(est.id)); } catch { /* stockage indisponible */ }
    }
  }, [est]);

  // Pastilles du menu (éléments en attente de validation)
  const loadBadges = () => est && api.get(`/api/r/e/${est.id}/dashboard?group=day`).then((d) => setBadges(d.pending)).catch(() => {});
  useEffect(() => { loadBadges(); /* eslint-disable-next-line */ }, [est?.id]);
  useRealtime('alerte', () => loadBadges());
  useRealtime('pointage', () => loadBadges());

  const ctx = useMemo(() => est && { est, establishments, path: (p) => `/api/r/e/${est.id}${p}`, refreshBadges: loadBadges }, [est, establishments]); // eslint-disable-line

  if (loading && !data) return <div className="fullpage"><Spinner /></div>;
  if (error) return <div className="fullpage"><ErrorBox error={error} onRetry={reload} /></div>;

  const nav = [
    { to: '/restaurateur', end: true, label: 'Tableau de bord', short: 'Accueil', icon: 'home' },
    { to: '/restaurateur/factures', label: 'Factures', icon: 'receipt', badge: badges.draft_invoices },
    { to: '/restaurateur/food-cost', label: 'Food cost', icon: 'pie' },
    { to: '/restaurateur/haccp', label: 'HACCP', icon: 'shield', badge: badges.dlc_soon },
    { to: '/restaurateur/equipe', label: 'Plannings et équipe', short: 'Équipe', icon: 'users', badge: badges.corrections },
    { to: '/restaurateur/commandes', label: 'Commandes fournisseurs', short: 'Commandes', icon: 'truck', badge: badges.orders },
    { to: '/restaurateur/marketing', label: 'Marketing', icon: 'megaphone', badge: badges.marketing },
    { to: '/restaurateur/contact', label: 'Contact', icon: 'chat' },
  ];
  const mobileNav = [nav[0], nav[1], nav[3], nav[4]];

  return (
    <AppShell
      nav={nav}
      mobileNav={mobileNav}
      establishmentId={est?.id}
      spaceLabel="Espace restaurateur"
      topSlot={est && <EstablishmentSelect establishments={establishments} value={est.id} onChange={setSelected} onAdd={() => setAdding(true)} />}
    >
      {!est ? (
        <div className="card">
          <p>Aucun établissement pour le moment.</p>
          <Button variant="primary" icon="plus" onClick={() => setAdding(true)}>Créer mon premier établissement</Button>
        </div>
      ) : (
        <EstContext.Provider value={ctx}>
          <Routes key={est.id}>
            <Route index element={<Dashboard />} />
            <Route path="factures" element={<Invoices />} />
            <Route path="factures/:id" element={<InvoiceDetail />} />
            <Route path="food-cost" element={<FoodCost />} />
            <Route path="food-cost/ingredients" element={<FoodCost tab="ingredients" />} />
            <Route path="food-cost/:id" element={<DishDetail />} />
            <Route path="haccp" element={<Navigate to="temperatures" replace />} />
            <Route path="haccp/:tab" element={<Haccp />} />
            <Route path="equipe" element={<Navigate to="planning" replace />} />
            <Route path="equipe/:tab" element={<Team />} />
            <Route path="commandes" element={<Orders />} />
            <Route path="marketing" element={<Marketing />} />
            <Route path="contact" element={<Contact />} />
            <Route path="*" element={<Navigate to="/restaurateur" replace />} />
          </Routes>
        </EstContext.Provider>
      )}
      <NewEstablishment open={adding} onClose={() => setAdding(false)} onCreated={async (e) => { setAdding(false); await reload(true); setSelected(e.id); }} />
    </AppShell>
  );
}
