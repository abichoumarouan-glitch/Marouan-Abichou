import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const AuthContext = createContext(null);

export const HOME = {
  restaurateur: '/restaurateur',
  comptable: '/comptable',
  collaborateur: '/collaborateur',
  support: '/support',
};

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, ai: false });

  const refresh = useCallback(async () => {
    try {
      const { user, ai } = await api.get('/api/auth/me');
      setState({ loading: false, user, ai });
    } catch {
      setState({ loading: false, user: null, ai: false });
    }
  }, []);

  useEffect(() => {
    refresh();
    const onUnauthorized = () => setState((s) => ({ ...s, user: null }));
    window.addEventListener('mizu:unauthorized', onUnauthorized);
    return () => window.removeEventListener('mizu:unauthorized', onUnauthorized);
  }, [refresh]);

  const login = async (email, password) => {
    const { user } = await api.post('/api/auth/login', { email, password });
    await refresh();
    return user;
  };
  const register = async (body) => {
    const { user } = await api.post('/api/auth/register', body);
    await refresh();
    return user;
  };
  const logout = async () => {
    await api.post('/api/auth/logout').catch(() => {});
    setState({ loading: false, user: null, ai: false });
  };

  return <AuthContext.Provider value={{ ...state, login, register, logout, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
