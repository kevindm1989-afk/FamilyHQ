/**
 * Language toggle (en ↔ fr). Lives in the design-system components folder
 * because it surfaces in both signed-out (LoginScreen footer) and signed-in
 * (AccountScreen) contexts.
 *
 * Implementation notes:
 *   - Renders as a native <select> with a visible <label>. Native controls
 *     give us free keyboard support, mobile-friendly pickers, and AT
 *     announcement without bespoke ARIA. A pair of toggle buttons would
 *     scale poorly past two locales; <select> handles any count.
 *   - Persistence is handled by i18next's LanguageDetector localStorage
 *     cache (configured in src/i18n.ts) — changing the language here writes
 *     through automatically.
 *   - The `<html lang>` sync is in App.tsx (a single useEffect) because it
 *     is a side-effect on the document, not a component concern.
 */
import type { ChangeEvent, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGE_LABELS, SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n';

interface Props {
  /**
   * Optional id for the underlying <select> so a parent component can label
   * or describe it from elsewhere in the DOM. Defaults to a stable string.
   */
  selectId?: string;
  className?: string;
}

export function LanguageToggle(props: Props): ReactElement {
  const { selectId = 'language-toggle', className } = props;
  const { t, i18n } = useTranslation();

  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en') as SupportedLanguage;

  const onChange = (e: ChangeEvent<HTMLSelectElement>): void => {
    const next = e.target.value as SupportedLanguage;
    if (!SUPPORTED_LANGUAGES.includes(next)) return;
    void i18n.changeLanguage(next);
  };

  return (
    <div className={className ?? 'flex items-center gap-8'}>
      <label htmlFor={selectId} className="text-label text-ink-mute">
        {t('language.selectorLabel')}
      </label>
      <select
        id={selectId}
        value={current}
        onChange={onChange}
        className="rounded-control border border-surface-line bg-surface-card px-12 py-4 text-body text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
      >
        {SUPPORTED_LANGUAGES.map((lng) => (
          <option key={lng} value={lng}>
            {LANGUAGE_LABELS[lng]}
          </option>
        ))}
      </select>
    </div>
  );
}
