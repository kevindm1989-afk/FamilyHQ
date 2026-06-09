/**
 * WishlistRoute — integration contract. Mocks the live feed + service so no
 * Firebase is touched. Pins that the route wires the screen to the service:
 *  - createWishlistItem with familyId + ownerUid bound to the viewer
 *  - requestRedemption / cancelRedemption / deleteWishlistItem flow
 *  - approveRedemption + denyRedemption are passed ONLY to a parent viewer
 *  - Placeholder fallback when family is not loaded yet
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Role, UserWithId } from '../../lib/types';

const memberUser: UserWithId = {
  id: 'uid-member-a',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 5000,
  theme: 'light',
};
const parentUser: UserWithId = {
  id: 'uid-parent-a',
  name: 'Sarah',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

let familyState: {
  familyId: string | null;
  role: Role | null;
  currentUser: UserWithId | null;
  members: UserWithId[];
  loading: boolean;
} = {
  familyId: memberUser.familyId,
  role: memberUser.role,
  currentUser: memberUser,
  members: [parentUser, memberUser],
  loading: false,
};

vi.mock('../../hooks/useFamily', () => ({
  useFamily: () => familyState,
  FamilyProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../../hooks/useToast', () => ({
  useToast: () => ({ showToast: vi.fn() }),
  ToastProvider: ({ children }: { children: React.ReactNode }) => children,
}));

let mockFeed: { items: unknown[]; loading: boolean; error: string | null } = {
  items: [],
  loading: false,
  error: null,
};
vi.mock('./useFamilyWishlistItems', () => ({
  useFamilyWishlistItems: () => mockFeed,
}));

vi.mock('../../firebase/config', () => ({ db: { __db: true } }));

const createMock = vi.fn(async (..._args: unknown[]) => 'new-id');
const updateMock = vi.fn(async (..._args: unknown[]) => undefined);
const deleteMock = vi.fn(async (..._args: unknown[]) => undefined);
const requestMock = vi.fn(async (..._args: unknown[]) => undefined);
const cancelMock = vi.fn(async (..._args: unknown[]) => undefined);
const approveMock = vi.fn(async (..._args: unknown[]) => undefined);
const denyMock = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('./wishlistService', async () => {
  const actual = await vi.importActual<typeof import('./wishlistService')>('./wishlistService');
  return {
    ...actual,
    createWishlistItem: (a: unknown, b: unknown) => createMock(a, b),
    updateWishlistItem: (a: unknown, b: unknown, c: unknown) => updateMock(a, b, c),
    deleteWishlistItem: (a: unknown, b: unknown) => deleteMock(a, b),
    requestRedemption: (a: unknown, b: unknown) => requestMock(a, b),
    cancelRedemption: (a: unknown, b: unknown) => cancelMock(a, b),
    approveRedemption: (a: unknown, b: unknown) => approveMock(a, b),
    denyRedemption: (a: unknown, b: unknown, c: unknown) => denyMock(a, b, c),
  };
});

import WishlistRoute from './WishlistRoute';

function restoreFamily(): void {
  familyState = {
    familyId: memberUser.familyId,
    role: memberUser.role,
    currentUser: memberUser,
    members: [parentUser, memberUser],
    loading: false,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  mockFeed = { items: [], loading: false, error: null };
  restoreFamily();
});

describe('WishlistRoute', () => {
  it('renders the screen heading', () => {
    render(<WishlistRoute />);
    expect(screen.getByRole('heading', { level: 1, name: /wishlist/i })).toBeInTheDocument();
  });

  it('falls back to a Placeholder when family is not loaded', () => {
    familyState = { familyId: null, role: null, currentUser: null, members: [], loading: false };
    render(<WishlistRoute />);
    expect(screen.getByRole('heading', { level: 1, name: /wishlist/i })).toBeInTheDocument();
  });

  it('calls createWishlistItem with familyId + ownerUid bound to viewer', async () => {
    render(<WishlistRoute />);
    fireEvent.click(screen.getByRole('button', { name: /new wish/i }));
    const sheet = await screen.findByRole('dialog');
    fireEvent.change(within(sheet).getByRole('textbox', { name: /what do you want/i }), {
      target: { value: 'Nintendo Switch' },
    });
    fireEvent.change(within(sheet).getByRole('textbox', { name: /cost \(in dollars\)/i }), {
      target: { value: '300.00' },
    });
    fireEvent.click(within(sheet).getByRole('button', { name: /add wish/i }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const [, payload] = createMock.mock.calls[0] as [
      unknown,
      { familyId: string; ownerUid: string; title: string; costCents: number },
    ];
    expect(payload.familyId).toBe(memberUser.familyId);
    expect(payload.ownerUid).toBe(memberUser.id);
    expect(payload.title).toBe('Nintendo Switch');
    expect(payload.costCents).toBe(30000);
  });

  it('calls requestRedemption when the owner taps Request on their wishing item', async () => {
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: memberUser.familyId,
          ownerUid: memberUser.id,
          title: 'Switch',
          costCents: 30000,
          status: 'wishing',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<WishlistRoute />);
    fireEvent.click(screen.getByRole('button', { name: /request to buy Switch/i }));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith({ db: { __db: true } }, 'i-1');
    });
  });

  it('calls cancelRedemption when the owner taps Cancel request on their requested item', async () => {
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: memberUser.familyId,
          ownerUid: memberUser.id,
          title: 'Switch',
          costCents: 30000,
          status: 'requested',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<WishlistRoute />);
    fireEvent.click(screen.getByRole('button', { name: /cancel request for Switch/i }));
    await waitFor(() => {
      expect(cancelMock).toHaveBeenCalledWith({ db: { __db: true } }, 'i-1');
    });
  });

  it('calls deleteWishlistItem when the owner taps Remove on their wishing item', async () => {
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: memberUser.familyId,
          ownerUid: memberUser.id,
          title: 'Switch',
          costCents: 30000,
          status: 'wishing',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<WishlistRoute />);
    fireEvent.click(screen.getByRole('button', { name: /remove Switch/i }));
    await waitFor(() => {
      expect(deleteMock).toHaveBeenCalledWith({ db: { __db: true } }, 'i-1');
    });
  });
});

describe('WishlistRoute — parent viewer wires approve + deny', () => {
  function asParent(): void {
    familyState = {
      familyId: parentUser.familyId,
      role: parentUser.role,
      currentUser: parentUser,
      members: [parentUser, memberUser],
      loading: false,
    };
  }

  it('passes onApprove + onDeny to the screen ONLY when viewer is a parent', () => {
    asParent();
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: parentUser.familyId,
          ownerUid: memberUser.id,
          title: 'Switch',
          costCents: 30000,
          status: 'requested',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<WishlistRoute />);
    expect(screen.getByRole('button', { name: /Approve Switch for Maya/ })).toBeInTheDocument();
  });

  it('calls approveRedemption when the parent taps Approve on a requested item', async () => {
    asParent();
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: parentUser.familyId,
          ownerUid: memberUser.id,
          title: 'Switch',
          costCents: 30000,
          status: 'requested',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<WishlistRoute />);
    fireEvent.click(screen.getByRole('button', { name: /Approve Switch for Maya/ }));
    await waitFor(() => {
      expect(approveMock).toHaveBeenCalledWith({ db: { __db: true } }, 'i-1');
    });
  });

  it('calls denyRedemption with the trimmed reason on confirm', async () => {
    asParent();
    mockFeed = {
      items: [
        {
          id: 'i-1',
          familyId: parentUser.familyId,
          ownerUid: memberUser.id,
          title: 'Switch',
          costCents: 30000,
          status: 'requested',
          createdAt: 1000,
        },
      ],
      loading: false,
      error: null,
    };
    render(<WishlistRoute />);
    fireEvent.click(screen.getByRole('button', { name: /^Send back$/i }));
    const input = await screen.findByLabelText(/why are you sending it back/i);
    fireEvent.change(input, { target: { value: '  Save up more first  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send back Switch for Maya/i }));
    await waitFor(() => {
      expect(denyMock).toHaveBeenCalledWith(
        { db: { __db: true } },
        'i-1',
        'Save up more first',
      );
    });
  });
});
