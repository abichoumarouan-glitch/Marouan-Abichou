import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, HOME } from '../auth.jsx';
import { Button, Field, Icon, Logo } from '../ui.jsx';

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={HOME[user.role]} replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const u = await login(email, password);
      const from = location.state?.from;
      navigate(from && from.startsWith(HOME[u.role]) ? from : HOME[u.role], { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login__visual" aria-hidden="true">
        <div className="login__waves">
          <svg viewBox="0 0 600 600" preserveAspectRatio="none">
            <path d="M0 380 C 120 330, 220 430, 330 380 S 520 320, 600 360 L600 600 L0 600Z" fill="rgba(255,255,255,0.06)" />
            <path d="M0 440 C 140 400, 240 490, 360 440 S 540 400, 600 430 L600 600 L0 600Z" fill="rgba(255,255,255,0.08)" />
            <path d="M0 500 C 150 470, 260 540, 380 500 S 550 470, 600 490 L600 600 L0 600Z" fill="rgba(255,255,255,0.1)" />
          </svg>
        </div>
        <div className="login__pitch">
          <Logo size={44} light />
          <h2>La gestion de votre restaurant, claire comme l'eau.</h2>
          <ul>
            <li><Icon name="receipt" size={18} /> Factures lues en une photo</li>
            <li><Icon name="pie" size={18} /> Food cost recalculé à chaque livraison</li>
            <li><Icon name="shield" size={18} /> HACCP sans matériel</li>
            <li><Icon name="users" size={18} /> Plannings et pointages en direct</li>
          </ul>
        </div>
      </div>
      <div className="login__form-wrap">
        <form className="login__form" onSubmit={submit}>
          <div className="login__logo"><Logo size={56} /></div>
          <h1>Connexion</h1>
          <p className="muted">Accédez à votre espace Mizu.</p>
          <Field label="Adresse email">
            <input type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Mot de passe">
            <div className="input-affix">
              <input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              <button type="button" className="input-affix__btn" onClick={() => setShow((s) => !s)} aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}>
                <Icon name="eye" size={18} />
              </button>
            </div>
          </Field>
          {error && <div className="notice notice--danger" role="alert"><Icon name="alert" size={18} /><span>{error}</span></div>}
          <Button type="submit" variant="primary" size="lg" loading={busy} className="btn--block">Se connecter</Button>
          <p className="muted tiny center">Pas encore de compte ? Votre expert-comptable ou votre employeur vous crée un accès.</p>
        </form>
      </div>
    </div>
  );
}
