/**
 * ErrorBoundary — unit contract.
 *
 * Pins:
 *   1. Renders children when no error.
 *   2. Catches a thrown render error and shows the fallback UI (apology
 *      heading + try-again + reload + mailto).
 *   3. "Try again" resets the boundary and re-renders children.
 *   4. reportError callback fires exactly once per caught error with the
 *      error + the componentStack (the Sentry-ready seam).
 *   5. The fallback is role="alert" so AT announces it.
 *
 * NOTE on console noise:
 *   React logs an "uncaught error" to console.error WHEN an error boundary
 *   catches an error. The tests stub console.error so that expected output
 *   doesn't pollute the suite. We restore the original in afterEach.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary, type ErrorReporter } from './ErrorBoundary';

// A tiny component that throws on first render. The `: never` return tells
// TypeScript this never produces a value, so it satisfies JSX as a child
// (the boundary catches before any ReactNode would be returned).
function Thrower({ message }: { message: string }): never {
  throw new Error(message);
}

function Fine() {
  return <p>I rendered just fine.</p>;
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  // React 18 + the boundary itself both log to console.error on a caught
  // error. Silence the noise for clean suite output.
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleErrorSpy.mockRestore();
});

describe('ErrorBoundary — happy path', () => {
  it('renders children unchanged when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <Fine />
      </ErrorBoundary>,
    );
    expect(screen.getByText('I rendered just fine.')).toBeInTheDocument();
  });
});

describe('ErrorBoundary — catches errors', () => {
  it('shows the fallback (apology + Try again + Reload + mailto) when a child throws', () => {
    render(
      <ErrorBoundary>
        <Thrower message="boom" />
      </ErrorBoundary>,
    );
    // role="alert" so AT announces it as soon as it mounts.
    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    // Apology heading.
    expect(within(alert).getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Both actions present.
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument();
    // Mailto fallback contact link.
    const support = screen.getByRole('link', { name: /support@familyhq.app/i });
    expect(support.getAttribute('href')?.startsWith('mailto:')).toBe(true);
  });

  it('does NOT display the raw error message to the user (privacy / UX)', () => {
    render(
      <ErrorBoundary>
        <Thrower message="UID 1234 leaked into the error" />
      </ErrorBoundary>,
    );
    // The raw message must never reach the DOM — that's how PI ends up
    // in screenshots and bug reports.
    expect(screen.queryByText(/UID 1234/)).toBeNull();
  });
});

describe('ErrorBoundary — reset', () => {
  it('"Try again" clears the boundary so children re-render', () => {
    // The component renders Thrower with a key; bump the key inside the
    // boundary by reading a controlled prop from outside.
    function Harness({ shouldThrow }: { shouldThrow: boolean }) {
      return (
        <ErrorBoundary>
          {shouldThrow ? <Thrower message="boom" /> : <Fine />}
        </ErrorBoundary>
      );
    }
    const { rerender } = render(<Harness shouldThrow />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Caller swaps to non-throwing children (in real life: an action,
    // a network retry, etc).
    rerender(<Harness shouldThrow={false} />);
    // The boundary still has the error latched — Try again clears it.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('I rendered just fine.')).toBeInTheDocument();
  });
});

describe('ErrorBoundary — reporter seam (Sentry-ready)', () => {
  it('fires reportError with the error AND the componentStack', () => {
    const reportError = vi.fn<ErrorReporter>();
    render(
      <ErrorBoundary reportError={reportError}>
        <Thrower message="boom" />
      </ErrorBoundary>,
    );
    expect(reportError).toHaveBeenCalledTimes(1);
    const [report] = reportError.mock.calls[0]!;
    expect(report.error).toBeInstanceOf(Error);
    expect(report.error.message).toBe('boom');
    expect(typeof report.componentStack).toBe('string');
    // The componentStack should at least mention the throwing component.
    expect(report.componentStack).toMatch(/Thrower/);
  });
});

