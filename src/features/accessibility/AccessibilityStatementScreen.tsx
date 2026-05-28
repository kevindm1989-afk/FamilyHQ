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
 * Content that requires human sign-off before public launch is marked with
 * `// REVIEW:` comments next to the line; see PR description.
 */
import type { ReactElement } from 'react';
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
  const headingId = 'accessibility-statement-heading';

  return (
    <main
      className="mx-auto flex w-full max-w-app flex-col gap-16 px-24 py-32"
      aria-labelledby={headingId}
    >
      {mode === 'public' && (
        <p>
          <Link
            to="/"
            className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            ← Back to sign in
          </Link>
        </p>
      )}

      <h1 id={headingId} className="text-display font-display font-extrabold text-ink">
        Accessibility at Family HQ
      </h1>
      <p className="text-meta text-ink-mute">
        Last reviewed:{' '}
        <time dateTime={ACCESSIBILITY_LAST_REVIEWED_ISO}>{ACCESSIBILITY_LAST_REVIEWED_ISO}</time>
      </p>

      <section aria-labelledby="commitment-heading" className="flex flex-col gap-8">
        <h2 id="commitment-heading" className="text-title font-semibold text-ink">
          Our commitment
        </h2>
        <p className="text-body text-ink">
          Family HQ is built for every member of every family. We design and develop with
          accessibility as a baseline — not an afterthought — and we want to hear from you when we
          get it wrong.
        </p>
      </section>

      <section aria-labelledby="conformance-heading" className="flex flex-col gap-8">
        <h2 id="conformance-heading" className="text-title font-semibold text-ink">
          Conformance target
        </h2>
        <p className="text-body text-ink">
          We aim to meet <strong>{CONFORMANCE_TARGET}</strong> of the Web Content Accessibility
          Guidelines, and to exceed it where we can. This is the legal minimum for public-facing
          services under the Accessibility for Ontarians with Disabilities Act (AODA).
        </p>
        <p className="text-body text-ink">
          Conformance is verified by a combination of automated checks (axe-core in our
          continuous-integration pipeline), structured manual review by our team, and ongoing
          feedback from people who use Family HQ. We treat reported barriers as bugs and triage them
          with the same urgency.
        </p>
      </section>

      <section aria-labelledby="limitations-heading" className="flex flex-col gap-8">
        <h2 id="limitations-heading" className="text-title font-semibold text-ink">
          Known limitations
        </h2>
        <p className="text-body text-ink">
          We publish what we know is not yet conformant so you can plan around it and so we are
          accountable to fixing it:
        </p>
        <ul className="ml-24 list-disc text-body text-ink">
          <li>
            <strong>Real-user assistive-technology testing</strong> is scheduled but has not yet
            been completed against this build. If a screen reader, voice control, or switch device
            fails for you, we want to know.
          </li>
          <li>
            <strong>Independent third-party accessibility audit</strong> is scheduled before public
            launch.
          </li>
          <li>
            <strong>French-language interface</strong> is not yet available; this is tracked
            separately as a localization deliverable.
          </li>
        </ul>
      </section>

      <section aria-labelledby="feedback-heading" className="flex flex-col gap-8">
        <h2 id="feedback-heading" className="text-title font-semibold text-ink">
          Report a barrier or request an alternative format
        </h2>
        <p className="text-body text-ink">
          If you encounter an accessibility barrier in Family HQ, or you need information from this
          site in an alternative format (large print, plain text, an accessible electronic format,
          or another arrangement that works for you), please contact us:
        </p>
        <p className="text-body text-ink">
          <a
            href={`mailto:${ACCESSIBILITY_CONTACT_EMAIL}?subject=${encodeURIComponent('Accessibility feedback — Family HQ')}`}
            className="text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {ACCESSIBILITY_CONTACT_EMAIL}
          </a>
        </p>
        <p className="text-body text-ink">
          We aim to acknowledge every report within two business days and to provide a substantive
          response within ten business days. Please include the page or flow where the barrier
          appeared, the assistive technology you were using, and a description of what went wrong.
        </p>
      </section>
    </main>
  );
}
