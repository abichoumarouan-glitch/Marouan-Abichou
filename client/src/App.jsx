import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth, HOME } from './auth.jsx';
import { Spinner } from './ui.jsx';
import Login from './pages/Login.jsx';
import RestaurateurApp from './pages/restaurateur/RestaurateurApp.jsx';
import CollaborateurApp from './pages/collaborateur/CollaborateurApp.jsx';
import ComptableApp from './pages/comptable/ComptableApp.jsx';
import SupportApp from './pages/support/SupportApp.jsx';

/** Chaque rôle n'accède qu'à son propre espace. */
function RequireRole({ role, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="fullpage"><Spinner /></div>;
  if (!user) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />;
  return children;
}

function Root() {
  const { user, loading } = useAuth();
  if (loading) return <div className="fullpage"><Spinner /></div>;
  return <Navigate to={user ? HOME[user.role] : '/connexion'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<Login />} />
      <Route path="/restaurateur/*" element={<RequireRole role="restaurateur"><RestaurateurApp /></RequireRole>} />
      <Route path="/collaborateur/*" element={<RequireRole role="collaborateur"><CollaborateurApp /></RequireRole>} />
      <Route path="/comptable/*" element={<RequireRole role="comptable"><ComptableApp /></RequireRole>} />
      <Route path="/support/*" element={<RequireRole role="support"><SupportApp /></RequireRole>} />
      <Route path="*" element={<Root />} />
    </Routes>
  );
}
