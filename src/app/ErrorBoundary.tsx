/**
 * Global error boundary — catches React render errors below it and shows a
 * friendly fallback instead of a white screen. Sentry-ready seam: the
 * `reportError` prop is the integration point. Today it does nothing in
 * production (logs to console.error in dev); when error tracking lands, the
 * Sentry SDK's captureException wires here and the boundary becomes
 * load-bearing for the production observability story.
 *
 * Why a class component (in 2026):
 *   React still only exposes the error-boundary contract via class lifecycle
 *   hooks (componentDidCatch + static getDerivedStateFromError). There is no
 *   functional equivalent. This is the one class component the codebase needs.
 *
 * Where it mounts:
 *   - App.tsx wraps the entire Gate so an error anywhere — including the
 *     LoginScreen, AuthProvider, or the lazy AuthedApp chunk — has a
 *     non-blank surface to render against.
 *   - AppShell.tsx could optionally wrap individual feature routes in a
 *     scoped boundary so a Calendar render bug doesn't take down the whole
 *     app. Holding off until we have a single reproducer that needs it —
 *     adding scoped boundaries everywhere up front is a complexity tax
 *     without a benefit.
 *
 * Fallback content:
 *   - i18n'd ("errorBoundary.*" keys in en + fr).
 *   - Apology + two actions: "Try again" (clears the boundary, re-renders
 *     children) and "Reload" (full document.location.reload()).
 *   - Includes a mailto link so a stuck user can report what they were
 *     doing without bouncing between tabs.
 *   - Does NOT show the raw error message to the user — that's a
 *     privacy/PI leak risk + a UX downgrade. The error is sent to the
 *     reporter (Sentry, when wired); the user gets human language.
 *
 * Try-again semantics:
 *   Resets the boundary's `error` state to null so React re-attempts to
 *   render the children. If the same error fires again immediately, the
 *   boundary catches it again and re-renders the fallback — i.e. "Try
 *   again" is safe even when the underlying bug is deterministic.
 */
import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import i18n from '../i18n';

interface ErrorReport {
  error: Error;
  componentStack: string;
}

export type ErrorReporter = (report: ErrorReport) => void;

interface ErrorBoundaryProps {
  /** Subtree to guard. */
  children: ReactNode;
  /**
   * Render function for the fallback when an error is caught. Optional so
   * AppShell can pass a chrome-aware fallback and the bare App can pass
   * nothing (defaults to DefaultErrorFallback below).
   */
  fallback?: (props: { error: Error; resetError: () => void; reload: () => void }) => ReactElement;
  /**
   * Reporter callback fired exactly once per caught error. Sentry-ready —
   * when an error-tracking SDK lands, wire its captureException here.
   * Always fires; the reporter decides whether to forward.
   */
  reportError?: ErrorReporter;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Default reporter: log to console so a dev sees the trace. Production
    // builds get the real Sentry/Bugsnag reporter via the prop once that
    // integration lands.
    const reporter =
      this.props.reportError ??
      ((report: ErrorReport): void => {
        console.error('[ErrorBoundary]', report.error, report.componentStack);
      });
    reporter({ error, componentStack: info.componentStack ?? '' });
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  reload = (): void => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  };

  override render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }
    const Fallback = this.props.fallback ?? DefaultErrorFallback;
    return <Fallback error={this.state.error} resetError={this.resetError} reload={this.reload} />;
  }
}

/**
 * Default fallback — minimal, no shell chrome (suitable for the App-level
 * boundary which sits above all routing). i18n'd. Renders a <main> with the
 * skip-link target ID so a focus-management caller from screen-readers
 * still lands somewhere meaningful.
 *
 * Kept in the same file as ErrorBoundary (rather than in its own module)
 * because the two are tightly coupled and the file is small. The
 * react-refresh warning about mixing components + non-component exports is
 * irrelevant here — the boundary state is fatal (we're already past the
 * point Fast Refresh would help) and the file only loads in production
 * builds when something has already gone wrong.
 */
// eslint-disable-next-line react-refresh/only-export-components
function DefaultErrorFallback({
  resetError,
  reload,
}: {
  error: Error;
  resetError: () => void;
  reload: () => void;
}): ReactElement {
  // Translation reads the global i18n singleton directly (NOT via useTranslation
  // — the fallback must render even if i18n's React provider tree is the thing
  // that broke). i18next's t() falls back to the key string when a key is
  // missing, so we wrap with our own English fallback to keep the crash screen
  // human-readable in the worst case (i18n itself is in trouble).
  const tr = (key: string, fallback: string): string => {
    try {
      const translated = i18n.t(key);
      if (translated && translated !== key) return translated;
    } catch {
      // fall through
    }
    return fallback;
  };

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-screen w-full max-w-app flex-col items-center justify-center gap-16 bg-surface-bg px-24 py-32 text-center focus:outline-none"
    >
      {/* role="alert" lives on the inner container, NOT on <main> — axe
          (correctly) rejects role="alert" on a landmark. The inner div
          gets announced by AT the moment the boundary swaps the subtree. */}
      <div role="alert" className="flex flex-col items-center gap-16">
        <h1 className="text-display font-display font-extrabold text-ink">
          {tr('errorBoundary.title', 'Something went wrong.')}
        </h1>
        <p className="text-body text-ink-mute">
          {tr(
            'errorBoundary.body',
            'We hit an unexpected error. Your data is safe — nothing was lost. Try again, or reload the page.',
          )}
        </p>
        <div className="flex flex-col gap-12 sm:flex-row">
          <button
            type="button"
            onClick={resetError}
            className="inline-flex min-h-tap items-center justify-center rounded-control bg-brand px-24 py-12 text-body font-semibold text-brand-on focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {tr('errorBoundary.tryAgain', 'Try again')}
          </button>
          <button
            type="button"
            onClick={reload}
            className="inline-flex min-h-tap items-center justify-center rounded-control border border-surface-line bg-surface-card px-24 py-12 text-body font-semibold text-ink focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {tr('errorBoundary.reload', 'Reload')}
          </button>
        </div>
        <p className="text-meta text-ink-mute">
          {tr('errorBoundary.contactPrefix', 'Still stuck? Tell us what happened: ')}
          <a
            href="mailto:support@familyhq.app?subject=Family%20HQ%20error"
            className="text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            support@familyhq.app
          </a>
        </p>
      </div>
    </main>
  );
}
