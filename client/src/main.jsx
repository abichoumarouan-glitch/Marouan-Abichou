import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './auth.jsx';
import { ToastProvider } from './ui.jsx';
import { registerServiceWorker } from './realtime.js';
import './styles.css';

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__mizuInstallPrompt = e;
});
registerServiceWorker();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
