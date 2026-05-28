import { useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { Button, TextField } from '../../components';
import { useToast } from '../../hooks/useToast';
import { AuthActionError, sendPasswordReset, signIn, signUpFoundingParent } from './authService';

type Mode = 'signin' | 'signup' | 'forgot';

/**
 * Login screen (Task 4/7). Functional, minimal: sign-in, founding-parent
 * sign-up, and password reset. Every action routes through the toast; errors
 * are already user-safe (PII-free) at the service boundary. Firebase config is
 * imported lazily so this module stays SDK-free at load time.
 */
export function LoginScreen(): ReactElement {
  const { showToast } = useToast();
  const [mode, setMode] = useState<Mode>('signin');
  const [familyName, setFamilyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const userSafeError = (e: unknown): string =>
    e instanceof AuthActionError ? e.message : 'Something went wrong. Please try again.';

  async function withConfig<T>(
    fn: (deps: {
      auth: import('firebase/auth').Auth;
      db: import('firebase/firestore').Firestore;
    }) => Promise<T>,
  ): Promise<T> {
    const { auth, db } = await import('../../firebase/config');
    return fn({ auth, db });
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        await withConfig(({ auth }) => signIn({ auth }, email, password));
        showToast('Signed in.');
      } else if (mode === 'signup') {
        await withConfig(({ auth, db }) =>
          signUpFoundingParent({ auth, db }, { familyName, name, email, password }),
        );
        showToast('Family created. Welcome to Family HQ.');
      } else {
        await withConfig(({ auth }) => sendPasswordReset({ auth }, email));
        showToast('If that email exists, a reset link is on its way.');
      }
    } catch (err) {
      showToast(userSafeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-surface-bg px-24">
      <div className="w-full max-w-app">
        <div className="mb-24 text-center">
          <h1 className="text-display font-display font-extrabold text-brand">Family HQ</h1>
          <p className="mt-8 text-meta text-ink-mute">
            {mode === 'signup'
              ? 'Create your family home base.'
              : mode === 'forgot'
                ? 'Reset your password.'
                : 'Your shared family home base.'}
          </p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-12">
          {mode === 'signup' && (
            <>
              <TextField label="Family name" value={familyName} onChange={setFamilyName} required />
              <TextField label="Your name" value={name} onChange={setName} required />
            </>
          )}
          <TextField label="Email" type="email" value={email} onChange={setEmail} required />
          {mode !== 'forgot' && (
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              required
            />
          )}

          <Button type="submit" size="lg" loading={busy}>
            {mode === 'signup'
              ? 'Create family'
              : mode === 'forgot'
                ? 'Send reset link'
                : 'Sign in'}
          </Button>
        </form>

        <div className="mt-24 flex flex-col items-center gap-8 text-label">
          {mode === 'signin' && (
            <>
              <button
                type="button"
                className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                onClick={() => setMode('signup')}
              >
                New here? Create a family
              </button>
              <button
                type="button"
                className="text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                onClick={() => setMode('forgot')}
              >
                Forgot password?
              </button>
            </>
          )}
          {mode !== 'signin' && (
            <button
              type="button"
              className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
              onClick={() => setMode('signin')}
            >
              Back to sign in
            </button>
          )}
        </div>

        {/* AODA: an accessibility statement + feedback path must be reachable
            even by a user who cannot complete sign-in. Keep this link present
            in all three modes, sized below the primary actions. */}
        <nav aria-label="Site resources" className="mt-32 flex justify-center">
          <Link
            to="/accessibility"
            className="text-meta text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            Accessibility statement
          </Link>
        </nav>
      </div>
    </main>
  );
}
