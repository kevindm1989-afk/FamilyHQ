/**
 * Family Management route — parent-only (the `guard('family', ...)` wrapper at
 * the Routes layer already bounces a member to the dashboard). Wires the screen
 * to live data: viewer = currentUser; members = the all-status feed (active +
 * inactive) from useAllFamilyMembers(familyId); the rename / activate actions
 * route through familyManagementService and surface a single toast per result.
 * Firebase config is imported lazily (mirrors the other routes) so the route
 * chunk stays SDK-free at the top level.
 *
 * Default-exported for React.lazy in AppShell.
 */
import type { ReactElement } from 'react';
import type { Firestore } from 'firebase/firestore';
import { Placeholder } from '../../app/Placeholder';
import { useFamily } from '../../hooks/useFamily';
import { FamilyManagementScreen } from './FamilyManagementScreen';
import { useAllFamilyMembers } from './useAllFamilyMembers';
import {
  FamilyManagementError,
  renameMember,
  setFamilyTimezone,
  setMemberActive,
} from './familyManagementService';
import { createInvite, InviteActionError, inviteExpiresAt, revokeInvite } from './inviteService';
import { usePendingFamilyInvites } from './usePendingFamilyInvites';
import { useFamilyDoc } from './useFamilyDoc';
import { isManagedChildEnabled } from './managedChildFeatureFlag';
import type { Role } from '../../lib/types';

export default function FamilyManagementRoute(): ReactElement {
  const { familyId, currentUser } = useFamily();
  const feed = useAllFamilyMembers(familyId);
  const invitesFeed = usePendingFamilyInvites(familyId);
  const familyDoc = useFamilyDoc(familyId);

  if (!currentUser || !familyId) {
    return <Placeholder title="Family" />;
  }

  // The Firestore handle is resolved at action time (lazy import keeps the
  // route chunk SDK-free at top level — mirrors BoardRoute / ChoresRoute). A
  // failing dynamic import (e.g. config missing in a test harness) returns
  // null — Sec1: the handler must SHORT-CIRCUIT in that case (raise a
  // FamilyManagementError so the screen toasts the generic copy) and MUST NOT
  // call the service with a `db as Firestore` null-lie cast.
  const resolveDb = async (): Promise<Firestore | null> => {
    try {
      const { db } = await import('../../firebase/config');
      return db;
    } catch {
      return null;
    }
  };

  const handleRename = async (uid: string, name: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      // Sec1 — no service call, no null cast. The screen's .catch surfaces
      // the generic toast.
      throw new FamilyManagementError();
    }
    await renameMember({ db }, uid, name);
  };

  const handleSetActive = async (uid: string, isActive: boolean): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      throw new FamilyManagementError();
    }
    await setMemberActive({ db }, uid, isActive);
  };

  const handleCreateInvite = async (input: { email: string; role: Role }): Promise<string> => {
    const db = await resolveDb();
    if (db === null) {
      throw new InviteActionError();
    }
    return createInvite(
      { db },
      {
        email: input.email,
        role: input.role,
        familyId,
        invitedBy: currentUser.id,
      },
    );
  };

  const handleRevokeInvite = async (inviteId: string): Promise<void> => {
    const db = await resolveDb();
    if (db === null) {
      throw new InviteActionError();
    }
    await revokeInvite({ db }, inviteId);
  };

  // Managed (email-less) child creation — parent-only, flag-gated. The service
  // invokes the createManagedChild callable directly (no Firestore handle
  // needed); it's lazy-imported so this route chunk doesn't statically pull
  // firebase/functions. Wired only when the flag is on, so the screen's
  // "Add a child" affordance stays hidden otherwise.
  const handleCreateChild = isManagedChildEnabled()
    ? async (input: {
        displayName: string;
        handle: string;
        password: string;
      }): Promise<{ childUid: string; loginCode: string; handle: string }> => {
        const { createManagedChild } = await import('./managedChildService');
        return createManagedChild(input);
      }
    : undefined;

  // Managed-child password reset — same flag gate + lazy-import discipline.
  // The screen renders the row action only on accountType==='managed' rows;
  // the callable re-verifies the target server-side regardless.
  const handleResetChildPassword = isManagedChildEnabled()
    ? async (childUid: string, newPassword: string): Promise<void> => {
        const { resetManagedChildPassword } = await import('./managedChildService');
        await resetManagedChildPassword({ childUid, newPassword });
      }
    : undefined;

  // F13 — parent-only timezone update. Mirror the resolveDb null guard so a
  // missing firebase config in a test harness short-circuits with the
  // generic PII-free FamilyManagementError (no `db as Firestore` null lie).
  // The handler is wired only when the viewer is a parent so a defensive
  // non-parent embed can never call the write.
  const handleSetTimezone =
    currentUser.role === 'parent'
      ? async (timezone: string): Promise<void> => {
          const db = await resolveDb();
          if (db === null) {
            throw new FamilyManagementError();
          }
          await setFamilyTimezone({ db }, familyId, timezone);
        }
      : undefined;

  return (
    <FamilyManagementScreen
      viewer={currentUser}
      members={feed.members}
      loading={feed.loading}
      error={feed.error}
      onRename={handleRename}
      onSetActive={handleSetActive}
      onRefresh={() => void feed.refresh()}
      onCreateInvite={handleCreateInvite}
      onCreateChild={handleCreateChild}
      onResetChildPassword={handleResetChildPassword}
      pendingInvites={invitesFeed.invites.map((inv) => ({
        id: inv.id,
        email: inv.email,
        role: inv.role,
        createdAt: inv.createdAt,
        // Synthesize the derived expiry for legacy invites (pre-TTL) so
        // the screen always has a value to render against, while still
        // showing the real `expiresAt` for invites created post-TTL.
        expiresAt: inviteExpiresAt(inv),
      }))}
      onRevokeInvite={handleRevokeInvite}
      timezone={familyDoc.family?.timezone}
      onSetTimezone={handleSetTimezone}
    />
  );
}
