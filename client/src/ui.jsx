import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Icon } from './icons.jsx';
import { compressImage } from './api.js';
import { todayIso, addDays, mondayOf } from './format.js';

export { Icon, Logo } from './icons.jsx';

// ---------- Boutons ----------
export function Button({ variant = 'secondary', size, icon, children, loading, className = '', ...props }) {
  return (
    <button
      type="button"
      className={`btn btn--${variant} ${size ? `btn--${size}` : ''} ${!children ? 'btn--icon' : ''} ${className}`}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <span className="spinner spinner--sm" /> : icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

/** Bouton qui ouvre l'appareil photo (ou la galerie) et renvoie l'image compressée. */
export function PhotoButton({ onFile, children, variant = 'primary', icon = 'camera', className = '', size, accept = 'image/*', capture = 'environment', disabled }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  return (
    <label className={`${variant ? `btn btn--${variant}` : ''} ${size ? `btn--${size}` : ''} ${className} ${busy || disabled ? 'is-disabled' : ''}`}>
      {variant
        ? (busy ? <span className="spinner spinner--sm" /> : <Icon name={icon} size={18} />)
        : <span className="quick__icon">{busy ? <span className="spinner spinner--sm" /> : <Icon name={icon} />}</span>}
      {children && <span>{children}</span>}
      <input
        ref={ref}
        type="file"
        accept={accept}
        capture={capture}
        hidden
        disabled={busy || disabled}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          setBusy(true);
          try {
            await onFile(await compressImage(f));
          } finally {
            setBusy(false);
          }
        }}
      />
    </label>
  );
}

// ---------- Mise en page ----------
export function PageHeader({ title, subtitle, actions, back }) {
  return (
    <header className="page-header">
      <div className="page-header__text">
        {back}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Card({ title, actions, children, className = '', pad = true, subtitle }) {
  return (
    <section className={`card ${pad ? '' : 'card--flush'} ${className}`}>
      {(title || actions) && (
        <div className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub, tone, icon }) {
  return (
    <div className={`stat ${tone ? `stat--${tone}` : ''}`}>
      <div className="stat__label">{icon && <Icon name={icon} size={16} />}{label}</div>
      <div className="stat__value">{value}</div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

export function Badge({ tone = 'neutral', children, icon }) {
  return <span className={`badge badge--${tone}`}>{icon && <Icon name={icon} size={13} strokeWidth={2.2} />}{children}</span>;
}

export function Empty({ icon = 'list', title, children, action }) {
  return (
    <div className="empty">
      <div className="empty__icon"><Icon name={icon} size={26} /></div>
      <p className="empty__title">{title}</p>
      {children && <p className="muted small">{children}</p>}
      {action}
    </div>
  );
}

export function Spinner({ label = 'Chargement…' }) {
  return <div className="loading"><span className="spinner" /> <span className="muted">{label}</span></div>;
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="notice notice--danger">
      <Icon name="alert" size={18} />
      <span>{error.message || String(error)}</span>
      {onRetry && <Button size="sm" variant="ghost" onClick={onRetry}>Réessayer</Button>}
    </div>
  );
}

export function Notice({ tone = 'info', icon = 'alert', children }) {
  return <div className={`notice notice--${tone}`}><Icon name={icon} size={18} /><div>{children}</div></div>;
}

// ---------- Onglets ----------
export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" aria-selected={value === t.value}
          className={`tabs__tab ${value === t.value ? 'is-active' : ''}`} onClick={() => onChange(t.value)}>
          {t.icon && <Icon name={t.icon} size={16} />}
          {t.label}
          {t.count ? <span className="tabs__count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Segmented({ options, value, onChange, size }) {
  return (
    <div className={`segmented ${size === 'sm' ? 'segmented--sm' : ''}`}>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? 'is-active' : ''} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---------- Formulaires ----------
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      {label && <span className="field__label">{label}</span>}
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

// ---------- Fenêtre modale ----------
export function Modal({ open, onClose, title, children, footer, size }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal__panel ${size ? `modal__panel--${size}` : ''}`}>
        <div className="modal__head">
          <h2>{title}</h2>
          <Button variant="ghost" icon="x" onClick={onClose} aria-label="Fermer" />
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Notifications à l'écran ----------
const ToastContext = createContext(() => {});
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    const toast = typeof t === 'string' ? { message: t } : t;
    setToasts((l) => [...l.slice(-3), { id, tone: 'success', ...toast }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), toast.duration || 4500);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`} onClick={() => { t.onClick?.(); setToasts((l) => l.filter((x) => x.id !== t.id)); }}>
            <Icon name={t.tone === 'danger' ? 'alert' : t.tone === 'info' ? 'bell' : 'check'} size={18} />
            <div>
              {t.title && <strong>{t.title}</strong>}
              <div>{t.message}</div>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);

// ---------- Chargement de données ----------
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const ref = useRef(loader);
  ref.current = loader;
  const reload = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await ref.current();
      setState({ data, error: null, loading: false });
      return data;
    } catch (error) {
      setState((s) => ({ ...s, error, loading: false }));
      return null;
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, deps);
  return { ...state, reload, setData: (fn) => setState((s) => ({ ...s, data: typeof fn === 'function' ? fn(s.data) : fn })) };
}

/** Exécute une action avec retour visuel (toast d'erreur ou de succès). */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn, success) => {
    setBusy(true);
    try {
      const r = await fn();
      if (success) toast(success);
      return r;
    } catch (e) {
      toast({ tone: 'danger', message: e.message || 'Erreur' });
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [toast]);
  return [run, busy];
}

// ---------- Sélecteur de période ----------
export function periodRange(kind, anchor = todayIso()) {
  if (kind === 'day') return { from: anchor, to: anchor };
  if (kind === 'week') { const m = mondayOf(anchor); return { from: m, to: addDays(m, 6) }; }
  if (kind === 'month') { const from = `${anchor.slice(0, 7)}-01`; const next = addDays(`${anchor.slice(0, 7)}-28`, 4).slice(0, 7); return { from, to: addDays(`${next}-01`, -1) }; }
  return null;
}

export function PeriodPicker({ value, onChange, kinds = ['day', 'week', 'month', 'custom'] }) {
  const labels = { day: 'Jour', week: 'Semaine', month: 'Mois', custom: 'Période' };
  const shift = (dir) => {
    if (value.kind === 'day') onChange({ ...value, ...periodRange('day', addDays(value.from, dir)) });
    else if (value.kind === 'week') onChange({ ...value, ...periodRange('week', addDays(value.from, dir * 7)) });
    else if (value.kind === 'month') onChange({ ...value, ...periodRange('month', addDays(value.from, dir > 0 ? 32 : -1)) });
  };
  return (
    <div className="period">
      <Segmented
        options={kinds.map((k) => ({ value: k, label: labels[k] }))}
        value={value.kind}
        onChange={(kind) => onChange(kind === 'custom' ? { ...value, kind } : { kind, ...periodRange(kind) })}
      />
      {value.kind === 'custom' ? (
        <div className="period__custom">
          <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label="Du" />
          <span className="muted">au</span>
          <input type="date" value={value.to} min={value.from} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label="Au" />
        </div>
      ) : (
        <div className="period__nav">
          <Button variant="ghost" size="sm" icon="left" onClick={() => shift(-1)} aria-label="Période précédente" />
          <Button variant="ghost" size="sm" icon="right" onClick={() => shift(1)} aria-label="Période suivante" />
        </div>
      )}
    </div>
  );
}

export function Confirm({ open, title, children, confirmLabel = 'Confirmer', tone = 'danger', onConfirm, onClose, busy }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm"
      footer={<><Button variant="ghost" onClick={onClose}>Annuler</Button><Button variant={tone} loading={busy} onClick={onConfirm}>{confirmLabel}</Button></>}>
      {children}
    </Modal>
  );
}

/** Mot de passe temporaire à transmettre (affiché une seule fois). */
export function PasswordReveal({ email, password }) {
  const toast = useToast();
  return (
    <div className="password-reveal">
      <p>Transmettez ces identifiants à la personne. Le mot de passe n'est affiché qu'une fois ; elle pourra le changer depuis « Mon compte ».</p>
      <dl>
        <dt>Email</dt><dd>{email}</dd>
        <dt>Mot de passe</dt><dd><code>{password}</code></dd>
      </dl>
      <Button size="sm" icon="copy" onClick={() => navigator.clipboard?.writeText(`Email : ${email}\nMot de passe : ${password}`).then(() => toast('Identifiants copiés'))}>Copier</Button>
    </div>
  );
}
