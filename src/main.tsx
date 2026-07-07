import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './app/App';
import './index.css';
// Theme CSS-variable layer (generated from design-tokens.json by
// scripts/gen-theme-css.cjs). Defines the light `:root` palette + the
// `[data-theme="dark"]` and prefers-color-scheme:dark layers that every
// colour utility resolves against (ADR-0007 dark mode).
import './index.theme.css';
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
