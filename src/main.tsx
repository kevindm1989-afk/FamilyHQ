import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './index.css';
// Side-effect import — bootstraps i18next BEFORE the first React render so
// LoginScreen and any other translated surface paints in the user's chosen
// language on first paint (no English flash before switching). See src/i18n.ts.
import './i18n';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
