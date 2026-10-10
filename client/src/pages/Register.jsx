import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth, HOME } from '../auth.jsx';
import { Button, Field, Icon, Logo } from '../ui.jsx';

const ROLES = [
  {
    value: 'comptable',
    icon: 'pie',
    title: 'Comptable',
    text: 'Expert-comptable : créez votre cabinet, puis ajoutez vos clients restaurateurs.',
  },
  {
    value: 'collaborateur',
    icon: 'clock',
    title: 'Collaborateur',
    text: 'Employé d’un restaurant : rejoignez votre équipe avec le code donné par votre responsable.',
  },
];

export default function Register() {
  const { user, register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [role, setRole] = useState(params.get('code') ? 'collaborateur' : params.get('role') || null);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '', company: '', join_code: params.get('code') || '', job_title: '' });
  const [est, setEst] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  // vérification du code d'invitation pendant la saisie
  useEffect(() => {
    const code = form.join_code.trim();
    setEst(null);
    if (role !== 'collaborateur' || code.length < 4) return undefined;
    const t = setTimeout(() => {
      api.get(`/api/auth/join-code/${encodeURIComponent(code)}`).then((r) => setEst(r.establishment)).catch(() => setEst(false));
    }, 350);
    return () => clearTimeout(t);
  }, [form.join_code, role]);

  if (user) return <Navigate to={HOME[user.role]} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await register({ ...form, role });
      navigate(HOME[u.role], { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="register">
      <form className="register__form" onSubmit={submit}>
        <Link to="/connexion" className="backlink"><Icon name="left" size={16} /> Retour à la connexion</Link>
        <Logo size={44} />
        <h1>Créer un compte</h1>

        <div className="role-cards" role="radiogroup" aria-label="Type de compte">
          {ROLES.map((r) => (
            <button key={r.value} type="button" role="radio" aria-checked={role === r.value}
              className={`role-card ${role === r.value ? 'is-active' : ''}`} onClick={() => { setRole(r.value); setError(''); }}>
              <span className="role-card__icon"><Icon name={r.icon} size={22} /></span>
              <strong>{r.title}</strong>
              <span className="small muted">{r.text}</span>
            </button>
          ))}
        </div>
        <p className="tiny muted">Vous êtes restaurateur ? Votre compte est créé par votre expert-comptable depuis son espace Mizu.</p>

        {role && (
          <div className="stack">
            {role === 'collaborateur' && (
              <Field label="Code d'invitation" hint="Demandez-le à votre responsable (Plannings et équipe › Collaborateurs).">
                <input value={form.join_code} onChange={set('join_code')} autoCapitalize="characters" autoComplete="off" required
                  style={{ textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 600 }} placeholder="Ex. : K7P2QX" />
                {est && <span className="small text-success"><Icon name="check" size={15} /> Vous rejoindrez <strong>{est.name}</strong></span>}
                {est === false && <span className="small text-danger">Code inconnu.</span>}
              </Field>
            )}
            {role === 'comptable' && (
              <Field label="Nom du cabinet"><input value={form.company} onChange={set('company')} required placeholder="Ex. : Cabinet Durand Expertise" /></Field>
            )}
            <div className="form-grid">
              <Field label="Prénom"><input value={form.first_name} onChange={set('first_name')} autoComplete="given-name" required /></Field>
              <Field label="Nom"><input value={form.last_name} onChange={set('last_name')} autoComplete="family-name" /></Field>
            </div>
            {role === 'collaborateur' && <Field label="Poste (facultatif)"><input value={form.job_title} onChange={set('job_title')} placeholder="Ex. : Serveur, commis…" /></Field>}
            <Field label="Adresse email"><input type="email" inputMode="email" autoComplete="email" value={form.email} onChange={set('email')} required /></Field>
            <Field label="Mot de passe" hint="8 caractères minimum"><input type="password" autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} required /></Field>
            {error && <div className="notice notice--danger" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
            <Button type="submit" variant="primary" size="lg" loading={busy} className="btn--block" disabled={role === 'collaborateur' && est === false}>
              Créer mon compte {role === 'comptable' ? 'comptable' : 'collaborateur'}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
