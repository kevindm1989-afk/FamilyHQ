/**
 * In-app landing for `/join/:inviteId` when the visitor is already signed in.
 *
 * The public JoinScreen at this same path only renders for unauthenticated
 * visitors (App.tsx). Before this component existed, a signed-in user who
 * clicked an invite link fell through AppShell's catch-all and silently
 * landed on the dashboard — no explanation, no path forward.
 *
 * The fix is small and obvious: render an explicit handoff here that says
 * "you're already signed in" and offers a sign-out CTA. The sign-out routes
 * through useAuth().signOut → signOutAndClearCache, which reloads the page;
 * the URL is still `/join/:inviteId`, so the public branch in App.tsx
 * mounts JoinScreen on the next render and the invitee redeems normally.
 *
 * We deliberately do NOT auto sign-out — a parent who shared the link to a
 * relative might have opened it on their own device to test it; bouncing
 * them out without consent would be surprising.
 */
import { useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Button } from '../../components';
import { useAuth } from '../../hooks/useAuth';
import { useFamily } from '../../hooks/useFamily';
import { useToast } from '../../hooks/useToast';
import { ROUTES } from '../../app/routes';

export function JoinAuthedHandoff(): ReactElement {
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const { currentUser } = useFamily();
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);

  const onSignOut = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } catch {
      setBusy(false);
      showToast(t('joinAuthed.error'));
    }
  };

  return (
    <section className="mx-auto flex w-full max-w-app flex-col gap-16 px-24 py-32 text-center">
      <h1 className="text-display font-display font-extrabold text-ink">{t('joinAuthed.title')}</h1>
      <p className="text-body text-ink-mute">
        {currentUser ? t('joinAuthed.bodyNamed', { name: currentUser.name }) : t('joinAuthed.body')}
      </p>
      <div className="flex flex-col items-center gap-12 pt-8">
        <Button onClick={onSignOut} loading={busy} size="lg">
          {t('joinAuthed.signOut')}
        </Button>
        <Link
          to={ROUTES.dashboard.path}
          className="text-body text-brand focus-visible:ring-focus focus-visible:ring-brand focus-visible:ring-offset-focus"
        >
          {t('joinAuthed.stay')}
        </Link>
      </div>
    </section>
  );
}
