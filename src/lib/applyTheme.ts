/**
 * Theme application — stamps the user's explicit theme onto <html> so the
 * CSS-variable layer (src/index.theme.css) switches to the dark palette.
 *
 * When the user has NO explicit choice (signed out, or a future 'system'
 * option), we REMOVE the attribute so the `@media (prefers-color-scheme)`
 * fallback in the theme CSS decides — no flash, no JS required for that path.
 *
 * Pure DOM; no React, no Firebase — safe to call from anywhere and trivially
 * unit-testable against a jsdom document.
 */
export type ThemeChoice = 'light' | 'dark';

export function applyTheme(theme: ThemeChoice | null | undefined): void {
  const el = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    el.setAttribute('data-theme', theme);
  } else {
    el.removeAttribute('data-theme');
  }
}
