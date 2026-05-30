/**
 * Legal pages — Privacy Policy + Terms of Service (launch-gate items).
 *
 * Both reachable without auth (a visitor MUST be able to read the privacy
 * policy before deciding to sign up). Both ship as DRAFTS authored by the
 * engineering team and explicitly say so — the heading carries a
 * "draft — pending legal review" badge and the body links to the contact
 * mailbox for substantive concerns. This is the honest, defensible position
 * for a pre-launch product that needs SOMETHING at /privacy and /terms;
 * shipping nothing at all is worse.
 *
 * One component takes a `variant` prop and renders the matching i18n key
 * tree because the two pages share structure exactly (heading, last-reviewed
 * date, sections, back link, contact). Only the content differs.
 *
 * REVIEW (PRE-LAUNCH, BLOCKING):
 *   - Legal counsel / qualified reviewer must sign off on each section.
 *     The current copy is engineering-authored to set up the seam; it is
 *     NOT a substitute for professional review and is marked as such on
 *     the page itself.
 *   - LEGAL_LAST_REVIEWED_ISO bumps on every legal-counsel-signed-off edit.
 *   - LEGAL_CONTACT_EMAIL is a placeholder mailbox; replace before launch.
 *   - Jurisdiction-of-record + governing-law clauses (terms) need the real
 *     company entity and incorporation jurisdiction.
 */
import type { ReactElement } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ROUTES } from '../../app/routes';

// REVIEW (PRE-LAUNCH): replace with the real legal/privacy mailbox. Must
// outlive any single person on the team — never route to a personal address.
export const LEGAL_CONTACT_EMAIL = 'privacy@familyhq.app';

// REVIEW (PRE-LAUNCH + per published edit): bump on every legal-reviewed
// content change. Stale dates signal a stale commitment.
export const LEGAL_LAST_REVIEWED_ISO = '2026-05-30';

export type LegalVariant = 'privacy' | 'terms';

interface Props {
  variant: LegalVariant;
  mode: 'public' | 'in-app';
}

// i18n key roots map 1:1 with the variant so the same component template
// reads from `privacy.*` or `terms.*` without conditional logic in JSX.
const KEY_ROOT: Record<LegalVariant, string> = {
  privacy: 'privacy',
  terms: 'terms',
};

// Section order mirrors the structure both pages share. Keeping this list
// in code (not in the locale file) means a translator can re-order copy
// inside a section but cannot accidentally drop a section.
const SECTIONS = ['scope', 'data', 'sharing', 'retention', 'rights', 'changes'] as const;

export function LegalScreen({ variant, mode }: Props): ReactElement {
  const { t } = useTranslation();
  const root = KEY_ROOT[variant];
  const headingId = `${variant}-heading`;

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
            {t('legal.back')}
          </Link>
        </p>
      )}

      <div className="flex flex-col gap-4">
        <h1 id={headingId} className="text-display font-display font-extrabold text-ink">
          {t(`${root}.title`)}
        </h1>
        {/* Draft badge — sits inline so a reader sees it before reading the
            policy. Removing this badge is a LEGAL-REVIEW gate, not a
            cosmetic edit. */}
        <p>
          <span
            className="inline-flex items-center rounded-control bg-status-warn-bg px-12 py-4 text-meta font-semibold text-status-warn-text"
            role="status"
          >
            {t('legal.draftBadge')}
          </span>
        </p>
      </div>

      <p className="text-meta text-ink-mute">
        <Trans
          i18nKey="legal.lastReviewed"
          values={{ date: LEGAL_LAST_REVIEWED_ISO }}
          components={{ 1: <time dateTime={LEGAL_LAST_REVIEWED_ISO} /> }}
        />
      </p>

      {SECTIONS.map((section) => {
        const sectionHeadingId = `${variant}-${section}-heading`;
        return (
          <section key={section} aria-labelledby={sectionHeadingId} className="flex flex-col gap-8">
            <h2 id={sectionHeadingId} className="text-title font-semibold text-ink">
              {t(`${root}.sections.${section}.heading`)}
            </h2>
            <p className="text-body text-ink">{t(`${root}.sections.${section}.body`)}</p>
          </section>
        );
      })}

      <section aria-labelledby={`${variant}-contact-heading`} className="flex flex-col gap-8">
        <h2 id={`${variant}-contact-heading`} className="text-title font-semibold text-ink">
          {t('legal.contact.heading')}
        </h2>
        <p className="text-body text-ink">{t('legal.contact.body')}</p>
        <p className="text-body text-ink">
          <a
            href={`mailto:${LEGAL_CONTACT_EMAIL}?subject=${encodeURIComponent(
              variant === 'privacy' ? 'Privacy concern — Family HQ' : 'Terms concern — Family HQ',
            )}`}
            className="text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {LEGAL_CONTACT_EMAIL}
          </a>
        </p>
      </section>

      {/* Cross-link to the sibling document — readers of one frequently want
          to check the other. Public mode shows /privacy + /terms as plain
          links; in-app mode same paths (the routes serve both surfaces). */}
      <nav aria-label={t('legal.relatedNav')} className="flex flex-col gap-4 text-meta">
        <Link
          to={variant === 'privacy' ? ROUTES.terms.path : ROUTES.privacy.path}
          className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t(variant === 'privacy' ? 'legal.related.terms' : 'legal.related.privacy')}
        </Link>
        <Link
          to={ROUTES.accessibility.path}
          className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('legal.related.accessibility')}
        </Link>
      </nav>
    </main>
  );
}
