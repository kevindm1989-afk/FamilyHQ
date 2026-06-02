/**
 * FamilyProvider — runtime contract.
 *
 * The pure `deriveActiveMembers` helper has its own tests
 * (useFamily.test.ts). This file pins the Provider runtime that lights up
 * the rest of the app — the two Firestore subscriptions (own user doc +
 * family-scoped users query) and the derived `FamilyState` returned by
 * `useFamily()`. None of the post-auth screens render until this Provider
 * settles, so a regression here breaks every authed feature at once.
 *
 * Tactical mock surface: `firebase/firestore` is mocked at the SDK boundary
 * (so `doc` / `collection` / `query` / `where` / `onSnapshot` are
 * controllable spies), and the lazy `import('../firebase/config')` returns
 * a stub `db`. The component renders the resolved `FamilyState` into
 * data-* attributes the tests inspect.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const docMock = vi.fn();
const collectionMock = vi.fn();
const queryMock = vi.fn();
const whereMock = vi.fn();
const onSnapshotMock = vi.fn();
const unsubUserMock = vi.fn();
const unsubFamilyMock = vi.fn();

// `.withConverter` is chained on `doc(...)` and `collection(...)` —
// stub it so the chained call doesn't TypeError.
function refWithConverter() {
  return { withConverter: () => ({ __ref: true }) };
}

vi.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => {
    docMock(...a);
    return refWithConverter();
  },
  collection: (...a: unknown[]) => {
    collectionMock(...a);
    return refWithConverter();
  },
  query: (...a: unknown[]) => queryMock(...a),
  where: (...a: unknown[]) => whereMock(...a),
  onSnapshot: (...a: unknown[]) => onSnapshotMock(...a),
}));

vi.mock('../firebase/config', () => ({
  db: { __db: true },
}));

// authUser is the trigger for the Provider's first subscription; control
// it per test so we can exercise null, signed-in, and switch-account.
let authUser: { uid: string } | null = null;
let authLoading = false;
vi.mock('./useAuth', () => ({
  useAuth: () => ({ authUser, loading: authLoading, signOut: vi.fn() }),
}));

import { FamilyProvider, useFamily } from './useFamily';

function Harness() {
  const f = useFamily();
  return (
    <div
      data-testid="state"
      data-loading={String(f.loading)}
      data-family={f.familyId ?? ''}
      data-role={f.role ?? ''}
      data-current={f.currentUser?.id ?? ''}
      data-members={f.members.map((m) => m.id).join(',')}
    />
  );
}

function mount() {
  return render(
    <FamilyProvider>
      <Harness />
    </FamilyProvider>,
  );
}

// onSnapshot is called twice (own user doc + family-scoped query). The
// FIRST call is for the user doc; the SECOND for the family query.
type SnapCb = (snap: unknown) => void;
type ErrCb = (err: unknown) => void;
function lastSnapshotCalls(): {
  userCb: SnapCb | undefined;
  userErr: ErrCb | undefined;
  familyCb: SnapCb | undefined;
  familyErr: ErrCb | undefined;
} {
  const calls = onSnapshotMock.mock.calls;
  const user = calls[0];
  const family = calls[1];
  return {
    userCb: user?.[1] as SnapCb | undefined,
    userErr: user?.[2] as ErrCb | undefined,
    familyCb: family?.[1] as SnapCb | undefined,
    familyErr: family?.[2] as ErrCb | undefined,
  };
}

beforeEach(() => {
  docMock.mockReset();
  collectionMock.mockReset();
  queryMock.mockReset();
  whereMock.mockReset();
  onSnapshotMock.mockReset();
  unsubUserMock.mockReset();
  unsubFamilyMock.mockReset();
  authUser = null;
  authLoading = false;

  // Default: every onSnapshot returns a distinct unsub so we can assert
  // teardown order.
  let callCount = 0;
  onSnapshotMock.mockImplementation(() => {
    callCount += 1;
    return callCount === 1 ? unsubUserMock : unsubFamilyMock;
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

const SARAH_DOC = {
  exists: () => true,
  id: 'uid-parent',
  data: () => ({
    name: 'Sarah',
    role: 'parent' as const,
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light' as const,
  }),
};

const FAMILY_SNAPSHOT = {
  docs: [
    {
      id: 'uid-parent',
      data: () => ({
        name: 'Sarah',
        role: 'parent' as const,
        familyId: 'fam-A',
        isActive: true,
        allowanceBalance: 0,
        theme: 'light' as const,
      }),
    },
    {
      id: 'uid-member',
      data: () => ({
        name: 'Maya',
        role: 'member' as const,
        familyId: 'fam-A',
        isActive: true,
        allowanceBalance: 0,
        theme: 'light' as const,
      }),
    },
    {
      id: 'uid-deactivated',
      data: () => ({
        name: 'Ben',
        role: 'member' as const,
        familyId: 'fam-A',
        isActive: false,
        allowanceBalance: 0,
        theme: 'light' as const,
      }),
    },
  ],
};

describe('FamilyProvider', () => {
  it('returns settled empty state when there is no authUser (never opens a Firestore listener)', () => {
    const r = mount();
    // The Provider short-circuits on the !authUser branch — no subscription.
    expect(onSnapshotMock).not.toHaveBeenCalled();
    const state = r.getByTestId('state');
    expect(state.dataset.family).toBe('');
    expect(state.dataset.current).toBe('');
    expect(state.dataset.loading).toBe('false');
  });

  it('subscribes to the own-user doc once authUser appears, and reports the role + familyId from the doc', async () => {
    authUser = { uid: 'uid-parent' };
    const r = mount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(docMock).toHaveBeenCalledWith({ __db: true }, 'users', 'uid-parent');

    act(() => {
      lastSnapshotCalls().userCb?.(SARAH_DOC);
    });

    const state = r.getByTestId('state');
    expect(state.dataset.role).toBe('parent');
    expect(state.dataset.family).toBe('fam-A');
    expect(state.dataset.current).toBe('uid-parent');
  });

  it('opens a SECOND subscription scoped to the user\'s familyId once that familyId resolves, and exposes only ACTIVE members', async () => {
    authUser = { uid: 'uid-parent' };
    const r = mount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Step 1: the own-user snapshot lands; the familyId is now known.
    act(() => {
      lastSnapshotCalls().userCb?.(SARAH_DOC);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Step 2: a NEW subscription opens for the family-scoped users query.
    expect(whereMock).toHaveBeenCalledWith('familyId', '==', 'fam-A');
    expect(onSnapshotMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Step 3: family snapshot arrives — derived members exclude the
    // deactivated user.
    act(() => {
      lastSnapshotCalls().familyCb?.(FAMILY_SNAPSHOT);
    });
    const state = r.getByTestId('state');
    expect(state.dataset.members?.split(',').sort()).toEqual(['uid-member', 'uid-parent']);
  });

  it('flips loading to FALSE only once BOTH subscriptions have a first snapshot (so the shell never short-circuits to the empty state mid-bootstrap)', async () => {
    authUser = { uid: 'uid-parent' };
    const r = mount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Only the user snapshot has landed — the family subscription opens
    // but hasn't emitted yet.
    act(() => {
      lastSnapshotCalls().userCb?.(SARAH_DOC);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(r.getByTestId('state').dataset.loading).toBe('true');

    // Now the family snapshot lands → loading flips false.
    act(() => {
      lastSnapshotCalls().familyCb?.(FAMILY_SNAPSHOT);
    });
    expect(r.getByTestId('state').dataset.loading).toBe('false');
  });

  it('on snapshot error, settles to an empty state without crashing (the app shows the unauth surface instead of breaking)', async () => {
    authUser = { uid: 'uid-parent' };
    const r = mount();
    await new Promise((resolve) => setTimeout(resolve, 0));

    act(() => {
      lastSnapshotCalls().userErr?.(new Error('permission-denied'));
    });
    const state = r.getByTestId('state');
    expect(state.dataset.current).toBe('');
    expect(state.dataset.loading).toBe('false');
  });

  it('tears down BOTH subscriptions on unmount (no listener leak across sign-out)', async () => {
    authUser = { uid: 'uid-parent' };
    const r = mount();
    await new Promise((resolve) => setTimeout(resolve, 0));
    act(() => {
      lastSnapshotCalls().userCb?.(SARAH_DOC);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    r.unmount();
    expect(unsubUserMock).toHaveBeenCalledTimes(1);
    expect(unsubFamilyMock).toHaveBeenCalledTimes(1);
  });
});

describe('useFamily — consumer guard', () => {
  it('throws a clear error when called outside a FamilyProvider', () => {
    function Lone() {
      useFamily();
      return null;
    }
    // The throw bubbles to React and shows up as an error during render.
    expect(() => render(<Lone />)).toThrow(/must be used within a FamilyProvider/i);
  });
});
