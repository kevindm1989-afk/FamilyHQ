/**
 * Public invite-redeem screen at /join/:inviteId.
 *
 * Renders for UNAUTHENTICATED visitors arriving via a shareable invite link.
 * Three states:
 *   1. LOADING — fetching the invite doc.
 *   2. INVALID — the invite is missing, already accepted, or revoked. Shows a
 *      friendly dead-end with a link back to the LoginScreen.
 *   3. PENDING — the invite is valid. Shows a signup form (name + password;
 *      email is bound from the invite and disabled-but-visible so the invitee
 *      can confirm). On submit, calls `acceptInvite` which atomically creates
 *      the auth user + writes the users doc + marks the invite accepted.
 *
 * The invite email is shown in the form as the invitee's identity confirmation
 * ("Joining as parent@example.com"). It's not user-editable — rules enforce
 * the email-bind, so allowing the field to be edited would just produce a
 * confusing rules-denial error on submit.
 *
 * Skip-link target id matches the public surface (`#main-content`) so the
 * AODA skip link in App.tsx routes here correctly.
 */
import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Button, TextField } from '../../components';
import { useToast } from '../../hooks/useToast';
import { INVITE_EMAIL_IN_USE_ERROR, type InviteWithId } from './inviteService';

type Status = 'loading' | 'invalid' | 'pending';

export function JoinScreen(): ReactElement {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const { inviteId } = useParams<{ inviteId: string }>();

  const [status, setStatus] = useState<Status>('loading');
  const [invite, setInvite] = useState<InviteWithId | null>(null);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // Persists past the toast's 1.8s auto-dismiss so the visitor has time
  // to read it and tap the "Sign in instead" link. Cleared on the next
  // submit attempt (so a typo'd password retry doesn't show stale copy).
  const [emailInUse, setEmailInUse] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!inviteId) {
      setStatus('invalid');
      return () => {
        /* no-op */
      };
    }
    // Lazy import of firebase + inviteService — matches the rest of the app's
    // dynamic-import pattern so the public bundle stays small.
    void (async () => {
      const [{ db }, { getInviteById }] = await Promise.all([
        import('../../firebase/config'),
        import('./inviteService'),
      ]);
      if (cancelled) return;
      const result = await getInviteById({ db }, inviteId);
      if (cancelled) return;
      if (!result) {
        setStatus('invalid');
      } else {
        setInvite(result);
        setStatus('pending');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inviteId]);

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy || !invite || !inviteId) return;
    setBusy(true);
    setEmailInUse(false);
    try {
      const [{ auth, db }, { acceptInvite, INVITE_ACCEPT_SUCCESS }] = await Promise.all([
        import('../../firebase/config'),
        import('./inviteService'),
      ]);
      await acceptInvite({ auth, db }, { inviteId, email: invite.email, password, name });
      showToast(INVITE_ACCEPT_SUCCESS);
      navigate('/', { replace: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : t('join.genericError');
      showToast(message);
      if (err instanceof Error && err.message === INVITE_EMAIL_IN_USE_ERROR) {
        setEmailInUse(true);
      }
    } finally {
      setBusy(false);
    }
  };

  if (status === 'loading') {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-screen items-center justify-center bg-surface-bg px-24"
      >
        <p className="text-body text-ink-mute" aria-busy="true">
          {t('join.loading')}
        </p>
      </main>
    );
  }

  if (status === 'invalid' || !invite) {
    return (
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex min-h-screen w-full max-w-app flex-col items-center justify-center gap-16 bg-surface-bg px-24 py-32 text-center"
      >
        <h1 className="text-display font-display font-extrabold text-ink">
          {t('join.invalid.title')}
        </h1>
        <p className="text-body text-ink-mute">{t('join.invalid.body')}</p>
        <Link
          to="/"
          className="text-body text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('join.invalid.back')}
        </Link>
      </main>
    );
  }

  // Pending — show the form.
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="mx-auto flex min-h-screen w-full max-w-app flex-col gap-16 bg-surface-bg px-24 py-32"
    >
      <h1 className="text-display font-display font-extrabold text-ink">{t('join.title')}</h1>
      <p className="text-body text-ink-mute">
        {t('join.invitedAs', { role: t(`join.role.${invite.role}`) })}{' '}
        <strong className="text-ink">{invite.email}</strong>
      </p>
      <form className="flex flex-col gap-12" onSubmit={onSubmit}>
        <TextField
          label={t('join.email')}
          value={invite.email}
          onChange={() => {
            /* email is bound from the invite; no-op */
          }}
          disabled
          required
        />
        <TextField label={t('join.name')} value={name} onChange={setName} required />
        <TextField
          label={t('join.password')}
          type="password"
          value={password}
          onChange={setPassword}
          required
        />
        <Button type="submit" loading={busy} size="lg">
          {t('join.submit')}
        </Button>
      </form>
      {emailInUse && (
        <p role="alert" className="rounded-control bg-surface-alt px-16 py-12 text-body text-ink">
          {t('join.emailInUse.body')}{' '}
          <Link
            to="/"
            className="text-brand underline focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
          >
            {t('join.emailInUse.signIn')}
          </Link>
        </p>
      )}
      <p className="text-meta text-ink-mute">
        <Link
          to="/"
          className="text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('join.cancel')}
        </Link>
      </p>
    </main>
  );
}
