/**
 * Accessibility Statement page (AODA artifact, launch-gate item).
 *
 * AODA requires a public-facing Ontario service to publish:
 *   1. An accessibility statement declaring commitment + conformance target.
 *   2. A feedback mechanism so users can report barriers.
 *   3. A path to request content in an alternative format.
 *
 * This page covers all three. It is reachable WITHOUT auth (the feedback path
 * must work even for a user who cannot get past the sign-in screen) and from
 * the Account screen when signed in.
 *
 * The two `mode` variants:
 *  - 'public'  — rendered for signed-out visitors. Top-of-page provides a
 *                "Back to sign in" link since there is no in-app chrome.
 *  - 'in-app'  — rendered inside the AppShell; the existing TopBar /
 *                BottomNav handles navigation, so this variant does not
 *                duplicate it.
 *
 * i18n: all visible copy reads from the 'common' namespace (accessibility.*
 * keys in src/locales/{en,fr}.json). The French copy is a developer-authored
 * placeholder and is flagged as such in fr.json's `_meta` AND in the
 * statement's own "Known limitations" section, so a French-speaking visitor
 * is told upfront that the translation is pending native-speaker review.
 *
 * Content that requires human sign-off before public launch is marked with
 * `// REVIEW:` comments next to the line; see PR description.
 */
import type { ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

// REVIEW (PRE-LAUNCH): replace with the real service domain's mailbox.
// `mailto:` is the AODA-minimum feedback mechanism; a form is a future upgrade
// (its own ticket). Do NOT route to a personal address — it must outlive any
// single person on the team so feedback is never silently dropped.
export const ACCESSIBILITY_CONTACT_EMAIL = 'accessibility@familyhq.app';

// REVIEW (PRE-LAUNCH + per audit): bump on every published audit / statement
// edit. Stale dates signal a stale commitment to anyone reading the statement.
export const ACCESSIBILITY_LAST_REVIEWED_ISO = '2026-05-28';

// REVIEW (PRE-LAUNCH): the conformance language is intentionally aspirational
// ("we aim for") not declarative ("we conform"). Upgrading to declarative
// requires a real third-party audit on a frozen build. Until then, "aim for"
// is the honest claim.
const CONFORMANCE_TARGET = 'WCAG 2.1 Level AA';

interface Props {
  mode: 'public' | 'in-app';
}

export function AccessibilityStatementScreen({ mode }: Props): ReactElement {
  const { t } = useTranslation();
  const headingId = 'accessibility-statement-heading';

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex w-full max-w-app flex-col gap-16 px-24 py-32 focus:outline-none"
      aria-labelledby={headingId}
    >
      {mode === 'public' && (
        <p>
          <Link
            to="/"
            className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {t('accessibility.back')}
          </Link>
        </p>
      )}

      <h1 id={headingId} className="text-display font-display font-extrabold text-ink">
        {t('accessibility.title')}
      </h1>
      <p className="text-meta text-ink-mute">
        <Trans
          i18nKey="accessibility.lastReviewed"
          values={{ date: ACCESSIBILITY_LAST_REVIEWED_ISO }}
          components={{
            // The date itself stays inside a <time datetime=...> for machine
            // readability — Trans wires the children into the {{date}} slot.
            1: <time dateTime={ACCESSIBILITY_LAST_REVIEWED_ISO} />,
          }}
        />
      </p>

      <section aria-labelledby="commitment-heading" className="flex flex-col gap-8">
        <h2 id="commitment-heading" className="text-title font-semibold text-ink">
          {t('accessibility.commitment.heading')}
        </h2>
        <p className="text-body text-ink">{t('accessibility.commitment.body')}</p>
      </section>

      <section aria-labelledby="conformance-heading" className="flex flex-col gap-8">
        <h2 id="conformance-heading" className="text-title font-semibold text-ink">
          {t('accessibility.conformance.heading')}
        </h2>
        <p className="text-body text-ink">
          <Trans
            i18nKey="accessibility.conformance.body1"
            values={{ target: CONFORMANCE_TARGET }}
            components={{ strong: <strong /> }}
          />
        </p>
        <p className="text-body text-ink">{t('accessibility.conformance.body2')}</p>
      </section>

      <section aria-labelledby="limitations-heading" className="flex flex-col gap-8">
        <h2 id="limitations-heading" className="text-title font-semibold text-ink">
          {t('accessibility.limitations.heading')}
        </h2>
        <p className="text-body text-ink">{t('accessibility.limitations.intro')}</p>
        <ul className="ml-24 list-disc text-body text-ink">
          <li>
            <Trans
              i18nKey="accessibility.limitations.atTesting"
              components={{ strong: <strong /> }}
            />
          </li>
          <li>
            <Trans i18nKey="accessibility.limitations.audit" components={{ strong: <strong /> }} />
          </li>
          <li>
            <Trans i18nKey="accessibility.limitations.french" components={{ strong: <strong /> }} />
          </li>
        </ul>
      </section>

      <section aria-labelledby="feedback-heading" className="flex flex-col gap-8">
        <h2 id="feedback-heading" className="text-title font-semibold text-ink">
          {t('accessibility.feedback.heading')}
        </h2>
        <p className="text-body text-ink">{t('accessibility.feedback.body1')}</p>
        <p className="text-body text-ink">
          <a
            href={`mailto:${ACCESSIBILITY_CONTACT_EMAIL}?subject=${encodeURIComponent('Accessibility feedback — Family HQ')}`}
            className="text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {ACCESSIBILITY_CONTACT_EMAIL}
          </a>
        </p>
        <p className="text-body text-ink">{t('accessibility.feedback.body2')}</p>
      </section>
    </main>
  );
}
