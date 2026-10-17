import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.jsx';
import './style.css';
import './neon.css';

// Instalar como app (PWA): el service worker deja la interfaz disponible al
// instante y sin red. Solo existe en HTTPS (devdj.lat ya lo tiene).
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

// El navegador ofrece "Instalar app" una vez; se guarda para el botón de Ajustes.
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  window.cmInstallPrompt = event;
  window.dispatchEvent(new Event('cm:installable'));
});

createRoot(document.getElementById('root')).render(<App/>);
