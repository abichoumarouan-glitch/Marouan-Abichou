import { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { useAuth } from './auth.jsx';
import { useRealtime, closeRealtime, enablePush, pushPermission, syncPushSubscription } from './realtime.js';
import { Button, Field, Icon, Logo, Modal, useToast, useAction } from './ui.jsx';
import { dateTime } from './format.js';

const SEVERITY_ICON = { danger: 'alert', warning: 'alert', success: 'check', info: 'bell' };

function NotificationsPanel({ open, onClose, alerts, onRead }) {
  const navigate = useNavigate();
  if (!open) return null;
  return (
    <>
      <div className="popover-backdrop" onClick={onClose} />
      <div className="popover notif-panel" role="dialog" aria-label="Notifications">
        <div className="popover__head">
          <strong>Notifications</strong>
          <Button size="sm" variant="ghost" onClick={() => onRead()}>Tout marquer comme lu</Button>
        </div>
        <div className="notif-panel__list">
          {!alerts.length && <p className="muted small pad">Aucune notification.</p>}
          {alerts.map((a) => (
            <button key={a.id} type="button" className={`notif ${a.read_at ? '' : 'is-unread'} notif--${a.severity}`}
              onClick={() => { onRead([a.id]); onClose(); if (a.link) navigate(a.link); }}>
              <span className="notif__icon"><Icon name={SEVERITY_ICON[a.severity] || 'bell'} size={16} /></span>
              <span className="notif__body">
                <strong>{a.title}</strong>
                {a.body && <span>{a.body}</span>}
                <span className="muted tiny">{dateTime(a.created_at)}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}

function AccountModal({ open, onClose, onLogout }) {
  const { user } = useAuth();
  const [run, busy] = useAction();
  const [form, setForm] = useState({ current: '', next: '' });
  const [perm, setPerm] = useState(pushPermission());
  const [installPrompt, setInstallPrompt] = useState(window.__mizuInstallPrompt || null);
  useEffect(() => {
    const h = (e) => { e.preventDefault(); window.__mizuInstallPrompt = e; setInstallPrompt(e); };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <Modal open={open} onClose={onClose} title="Mon compte">
      <div className="stack">
        <div>
          <strong>{user.first_name} {user.last_name}</strong>
          <div className="muted small">{user.email}</div>
        </div>
        <div className="divider" />
        <h3 className="h3">Notifications</h3>
        {perm === 'granted' ? (
          <p className="small"><Icon name="check" size={16} className="text-success" /> Notifications activées sur cet appareil.</p>
        ) : perm === 'unsupported' ? (
          <p className="small muted">Cet appareil ne prend pas en charge les notifications{ios ? " (sur iPhone, installez d'abord Mizu sur l'écran d'accueil)" : ''}.</p>
        ) : (
          <div className="row">
            <p className="small muted grow">Recevez les alertes même lorsque l'application est fermée.</p>
            <Button icon="bell" onClick={() => run(async () => { await enablePush(); setPerm(pushPermission()); }, 'Notifications activées')}>Activer</Button>
          </div>
        )}
        {!standalone && (
          <>
            <h3 className="h3">Installer l'application</h3>
            {installPrompt ? (
              <Button icon="phone" onClick={async () => { installPrompt.prompt(); await installPrompt.userChoice; setInstallPrompt(null); window.__mizuInstallPrompt = null; }}>Installer Mizu sur cet appareil</Button>
            ) : (
              <p className="small muted">
                {ios ? 'Sur iPhone : touchez « Partager » puis « Sur l’écran d’accueil ».' : 'Dans le menu du navigateur, choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».'}
              </p>
            )}
          </>
        )}
        <div className="divider" />
        <h3 className="h3">Changer le mot de passe</h3>
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          run(async () => { await api.post('/api/auth/password', form); setForm({ current: '', next: '' }); }, 'Mot de passe modifié');
        }}>
          <Field label="Mot de passe actuel"><input type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} required /></Field>
          <Field label="Nouveau mot de passe" hint="8 caractères minimum"><input type="password" autoComplete="new-password" minLength={8} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} required /></Field>
          <div><Button type="submit" variant="primary" loading={busy}>Enregistrer</Button></div>
        </form>
        <div className="divider" />
        <div><Button variant="ghost" icon="logout" onClick={onLogout}>Se déconnecter</Button></div>
      </div>
    </Modal>
  );
}

/**
 * Coque commune aux espaces : menu latéral (ordinateur), menu en bas (téléphone),
 * barre du haut avec le sélecteur d'établissement et les notifications.
 */
export default function AppShell({ nav, mobileNav, topSlot, establishmentId, children, mobileFirst = false, spaceLabel }) {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [alerts, setAlerts] = useState([]);
  const [panel, setPanel] = useState(false);
  const [more, setMore] = useState(false);
  const [account, setAccount] = useState(false);

  const loadAlerts = () => api.get(`/api/alerts${establishmentId ? `?establishment=${establishmentId}` : ''}`).then((d) => setAlerts(d.alerts)).catch(() => {});
  useEffect(() => { loadAlerts(); /* eslint-disable-next-line */ }, [establishmentId]);
  useEffect(() => { setMore(false); }, [location.pathname]);
  useEffect(() => { syncPushSubscription().catch(() => {}); }, []);
  useEffect(() => {
    const onMsg = (e) => e.data?.type === 'navigate' && navigate(e.data.url);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [navigate]);

  useRealtime('alerte', (a) => {
    if (establishmentId && a.establishment_id && a.establishment_id !== establishmentId) return loadAlerts();
    setAlerts((l) => [a, ...l.filter((x) => x.id !== a.id)]);
    toast({ tone: a.severity === 'danger' || a.severity === 'warning' ? 'danger' : 'info', title: a.title, message: a.body, onClick: () => a.link && navigate(a.link), duration: 7000 });
  });

  const markRead = async (ids) => {
    await api.post('/api/alerts/read', ids ? { ids } : {}).catch(() => {});
    setAlerts((l) => l.map((a) => (!ids || ids.includes(a.id) ? { ...a, read_at: a.read_at || 'lu' } : a)));
  };
  const unread = alerts.filter((a) => !a.read_at).length;
  const bottom = mobileNav || nav.slice(0, 4);
  const overflow = nav.filter((n) => !bottom.some((b) => b.to === n.to));

  const doLogout = async () => {
    closeRealtime();
    await logout();
    navigate('/connexion');
  };

  return (
    <div className={`shell ${mobileFirst ? 'shell--mobile-first' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar__brand"><Logo size={32} /></div>
        {spaceLabel && <div className="sidebar__space">{spaceLabel}</div>}
        <nav className="sidebar__nav">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `navlink ${isActive ? 'is-active' : ''}`}>
              <Icon name={n.icon} size={19} />
              <span>{n.label}</span>
              {n.badge ? <span className="navlink__badge">{n.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__foot">
          <button type="button" className="userchip" onClick={() => setAccount(true)}>
            <span className="avatar">{user.first_name[0]}{user.last_name?.[0] || ''}</span>
            <span className="userchip__text"><strong>{user.first_name} {user.last_name}</strong><span className="muted tiny">Mon compte</span></span>
          </button>
          <Button variant="ghost" icon="logout" onClick={doLogout} aria-label="Se déconnecter" title="Se déconnecter" />
        </div>
      </aside>

      <div className="main">
        <header className={`topbar ${topSlot ? 'topbar--slot' : ''}`}>
          <div className="topbar__brand"><Logo size={28} /></div>
          <div className="topbar__slot">{topSlot}</div>
          <div className="topbar__actions">
            <button type="button" className="iconbtn" onClick={() => setPanel((p) => !p)} aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`}>
              <Icon name="bell" size={21} />
              {unread > 0 && <span className="iconbtn__dot">{unread > 9 ? '9+' : unread}</span>}
            </button>
            <button type="button" className="iconbtn topbar__account" onClick={() => setAccount(true)} aria-label="Mon compte">
              <span className="avatar avatar--sm">{user.first_name[0]}</span>
            </button>
          </div>
          <NotificationsPanel open={panel} onClose={() => setPanel(false)} alerts={alerts} onRead={markRead} />
        </header>
        <main className="content">{children}</main>
      </div>

      <nav className="bottomnav" aria-label="Menu principal">
        {bottom.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `bottomnav__item ${isActive ? 'is-active' : ''}`}>
            <span className="bottomnav__icon"><Icon name={n.icon} size={22} />{n.badge ? <span className="bottomnav__badge">{n.badge}</span> : null}</span>
            <span>{n.short || n.label}</span>
          </NavLink>
        ))}
        {(overflow.length > 0 || !mobileFirst) && (
          <button type="button" className={`bottomnav__item ${more ? 'is-active' : ''}`} onClick={() => setMore((m) => !m)}>
            <span className="bottomnav__icon"><Icon name="menu" size={22} /></span>
            <span>Plus</span>
          </button>
        )}
      </nav>
      {more && (
        <>
          <div className="sheet-backdrop" onClick={() => setMore(false)} />
          <div className="sheet" role="dialog" aria-label="Plus">
            <div className="sheet__handle" />
            {overflow.map((n) => (
              <NavLink key={n.to} to={n.to} className="sheet__item"><Icon name={n.icon} size={20} />{n.label}</NavLink>
            ))}
            <button type="button" className="sheet__item" onClick={() => { setMore(false); setAccount(true); }}><Icon name="user" size={20} />Mon compte et notifications</button>
            <button type="button" className="sheet__item" onClick={doLogout}><Icon name="logout" size={20} />Se déconnecter</button>
          </div>
        </>
      )}
      <AccountModal open={account} onClose={() => setAccount(false)} onLogout={doLogout} />
    </div>
  );
}
