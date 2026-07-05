import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Button, LanguageToggle, TextField } from '../../components';
import { useToast } from '../../hooks/useToast';
import { isManagedChildEnabled } from '../family/managedChildFeatureFlag';
import { composeChildLoginEmail } from '../family/childLoginEmail';

type Mode = 'signin' | 'signup' | 'forgot' | 'kidsignin';

/**
 * Login screen (Task 4/7). Functional, minimal: sign-in, founding-parent
 * sign-up, and password reset. Every action routes through the toast; errors
 * are already user-safe (PII-free) at the service boundary.
 *
 * NOTHING firebase-related is imported statically here — not the SDK, not the
 * config module, not authService. The login form is the entry point for a
 * cold load (the user isn't signed in yet), so every kilobyte gates time to
 * interactive. authService + firebase are pulled on form submit via
 * `withApi`, which is the only path that needs them.
 *
 * useAuth.ts also dynamic-imports authService. As long as BOTH consumers
 * stay dynamic, Rollup keeps authService (and the Firebase SDK behind it)
 * in its own chunk — a single static reference anywhere reverts it.
 */
export function LoginScreen(): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('signin');
  const [familyName, setFamilyName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [familyCode, setFamilyCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // The "Kid sign-in" affordance is a client UX gate; the child's account and
  // the callables that created it are enforced server-side regardless.
  const kidEnabled = isManagedChildEnabled();

  // Match on the error's name string instead of `instanceof AuthActionError`
  // so we don't need to statically import the class — that would pull
  // authService (and thereby Firebase) into the login bundle.
  // authService sets `name = 'AuthActionError'` at the throw site. The fall-
  // through generic copy is translated; an AuthActionError's own message is
  // already user-safe at the service boundary and surfaces verbatim.
  const userSafeError = (e: unknown): string =>
    e instanceof Error && e.name === 'AuthActionError' ? e.message : t('login.toast.generic');

  async function withApi<T>(
    fn: (
      api: typeof import('./authService'),
      deps: {
        auth: import('firebase/auth').Auth;
        db: import('firebase/firestore').Firestore;
      },
    ) => Promise<T>,
  ): Promise<T> {
    const [api, cfg] = await Promise.all([
      import('./authService'),
      import('../../firebase/config'),
    ]);
    return fn(api, { auth: cfg.auth, db: cfg.db });
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      if (mode === 'kidsignin') {
        // A managed child has no email: compose the synthetic sign-in address
        // from the family code + username, then take the SAME signIn path.
        const syntheticEmail = composeChildLoginEmail(familyCode, username);
        await withApi((api, { auth }) => api.signIn({ auth }, syntheticEmail, password));
        showToast(t('login.toast.signedIn'));
        navigate('/', { replace: true });
      } else if (mode === 'signin') {
        await withApi((api, { auth }) => api.signIn({ auth }, email, password));
        showToast(t('login.toast.signedIn'));
        // Force a return to the dashboard. The Gate flips to AuthedApp on
        // the auth-state change but doesn't touch the URL, so a user who
        // landed on the login surface from a modal route (e.g. signed out
        // from /switch-account) would otherwise re-enter the app on that
        // SAME modal URL — Account screen with no bottom nav, dead-end.
        navigate('/', { replace: true });
      } else if (mode === 'signup') {
        await withApi((api, { auth, db }) =>
          api.signUpFoundingParent({ auth, db }, { familyName, name, email, password }),
        );
        showToast(t('login.toast.created'));
        // Same reason as signin. Belt-and-suspenders: signup almost always
        // starts at '/' so this is usually a no-op, but if a future flow
        // ever lands on signup from a non-root URL, this keeps the
        // post-signup landing predictable.
        navigate('/', { replace: true });
      } else {
        await withApi((api, { auth }) => api.sendPasswordReset({ auth }, email));
        showToast(t('login.toast.resetSent'));
        // Reset succeeded. Send the user back to sign-in so the next step is
        // obvious — they can sign in here once they follow the reset link in
        // their email. Email is preserved (they'll sign in with the same
        // address); password is cleared so a stale value can't be submitted.
        // Without this, the form stayed in `forgot` mode after the toast
        // auto-dismissed, leaving the user staring at the same Send-reset
        // CTA with no obvious next action.
        setMode('signin');
        setPassword('');
      }
    } catch (err) {
      showToast(userSafeError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex min-h-screen flex-col items-center justify-center bg-surface-bg px-24 focus:outline-none"
    >
      <div className="w-full max-w-app">
        <div className="mb-24 text-center">
          <h1 className="text-display font-display font-extrabold text-brand">
            {t('common.appName')}
          </h1>
          <p className="mt-8 text-meta text-ink-mute">{t(`login.tagline.${mode}`)}</p>
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-12">
          {mode === 'signup' && (
            <>
              <TextField
                label={t('login.field.familyName')}
                value={familyName}
                onChange={setFamilyName}
                required
              />
              <TextField label={t('login.field.name')} value={name} onChange={setName} required />
            </>
          )}
          {mode === 'kidsignin' && (
            <>
              <TextField
                label={t('login.field.familyCode')}
                value={familyCode}
                onChange={setFamilyCode}
                required
              />
              <TextField
                label={t('login.field.username')}
                value={username}
                onChange={setUsername}
                required
              />
            </>
          )}
          {mode !== 'kidsignin' && (
            <TextField
              label={t('login.field.email')}
              type="email"
              value={email}
              onChange={setEmail}
              required
            />
          )}
          {mode !== 'forgot' && (
            <TextField
              label={t('login.field.password')}
              type="password"
              value={password}
              onChange={setPassword}
              required
            />
          )}

          <Button type="submit" size="lg" loading={busy}>
            {t(`login.submit.${mode}`)}
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
                {t('login.switch.toSignup')}
              </button>
              <button
                type="button"
                className="text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                onClick={() => setMode('forgot')}
              >
                {t('login.switch.toForgot')}
              </button>
              {kidEnabled && (
                <button
                  type="button"
                  className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
                  onClick={() => setMode('kidsignin')}
                >
                  {t('login.switch.toKid')}
                </button>
              )}
            </>
          )}
          {mode !== 'signin' && (
            <button
              type="button"
              className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
              onClick={() => setMode('signin')}
            >
              {t('login.switch.toSignin')}
            </button>
          )}
        </div>

        {/* AODA: an accessibility statement + feedback path must be reachable
            even by a user who cannot complete sign-in. Keep this link present
            in all three modes, sized below the primary actions. The language
            toggle sits ABOVE the accessibility link so a user can switch into
            French BEFORE relying on the statement copy. */}
        <div className="mt-32 flex flex-col items-center gap-12">
          <LanguageToggle />
          {/* Footer policy links — accessibility (AODA), privacy (PIPEDA),
              and terms must be reachable from the public surface so a user
              can read them BEFORE signing up. */}
          <nav
            aria-label={t('account.resourcesLabel')}
            className="flex flex-wrap items-center justify-center gap-x-16 gap-y-4"
          >
            <Link
              to="/accessibility"
              className="text-meta text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            >
              {t('login.footer.accessibility')}
            </Link>
            <Link
              to="/privacy"
              className="text-meta text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            >
              {t('login.footer.privacy')}
            </Link>
            <Link
              to="/terms"
              className="text-meta text-ink-mute focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
            >
              {t('login.footer.terms')}
            </Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
