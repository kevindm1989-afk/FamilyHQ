/** applyTheme — stamps/removes data-theme on <html>. */
import { afterEach, describe, expect, it } from 'vitest';
import { applyTheme } from './applyTheme';

afterEach(() => document.documentElement.removeAttribute('data-theme'));

describe('applyTheme', () => {
  it('stamps data-theme="dark"', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });
  it('stamps data-theme="light"', () => {
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
  it('REMOVES the attribute for null (defer to prefers-color-scheme)', () => {
    applyTheme('dark');
    applyTheme(null);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
  it('REMOVES the attribute for undefined', () => {
    applyTheme('dark');
    applyTheme(undefined);
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
