/**
 * WishlistScreen — props-injected contract. Pins:
 *  - State machine (loading / error / empty / list)
 *  - Owner affordances (edit / delete / request on wishing; cancel on
 *    requested; try-again on denied)
 *  - Parent-only pending-approval queue with Approve / Deny + required reason
 *  - Status sorting (requested → wishing → denied) and the redeemed footer
 *  - Money is INTEGER CENTS everywhere — formatted "$X.XX" for display
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '../../hooks/useToast';
import { WishlistScreen, type WishlistScreenProps } from './WishlistScreen';
import type { UserWithId } from '../../lib/types';
import type { WishlistItemWithId } from './wishlistService';

const MAYA: UserWithId = {
  id: 'uid-maya',
  name: 'Maya',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 5000, // $50.00
  theme: 'light',
};
const BEN: UserWithId = {
  id: 'uid-ben',
  name: 'Ben',
  role: 'member',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 1200, // $12.00
  theme: 'light',
};
const SARAH: UserWithId = {
  id: 'uid-parent-a',
  name: 'Sarah Kim',
  role: 'parent',
  familyId: 'fam-A',
  isActive: true,
  allowanceBalance: 0,
  theme: 'light',
};

function mk(over: Partial<WishlistItemWithId> & { id: string }): WishlistItemWithId {
  return {
    familyId: 'fam-A',
    ownerUid: MAYA.id,
    title: `Wish ${over.id}`,
    costCents: 1500,
    status: 'wishing',
    createdAt: 1000,
    ...over,
  };
}

function renderScreen(overrides: Partial<WishlistScreenProps> = {}) {
  const props: WishlistScreenProps = {
    viewer: { uid: MAYA.id, name: MAYA.name, role: 'member' },
    members: [SARAH, MAYA, BEN],
    feed: { items: [], loading: false, error: null },
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onRequest: vi.fn().mockResolvedValue(undefined),
    onCancelRequest: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(
    <ToastProvider>
      <WishlistScreen {...props} />
    </ToastProvider>,
  );
  return props;
}

describe('WishlistScreen — state machine', () => {
  it('renders the loading affordance when feed.loading=true', () => {
    renderScreen({ feed: { items: [], loading: true, error: null } });
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders an inline role=alert (never a toast) on feed error', () => {
    renderScreen({ feed: { items: [], loading: false, error: 'We could not load the wishlist. Please try again.' } });
    expect(screen.getByRole('alert')).toHaveTextContent(/could not load the wishlist/i);
  });

  it('renders the empty copy when the viewer has zero items', () => {
    renderScreen({ feed: { items: [], loading: false, error: null } });
    expect(screen.getByText(/no wishes yet/i)).toBeInTheDocument();
  });

  it('renders the title heading', () => {
    renderScreen();
    expect(screen.getByRole('heading', { level: 1, name: /wishlist/i })).toBeInTheDocument();
  });
});

describe('WishlistScreen — balance display', () => {
  it('shows the member viewer their own balance, formatted as "$X.XX"', () => {
    renderScreen({ viewer: { uid: MAYA.id, name: MAYA.name, role: 'member' } });
    expect(screen.getByText('$50.00')).toBeInTheDocument();
  });

  it('does NOT show the single-balance card to a parent (parent gets per-member chips)', () => {
    renderScreen({ viewer: { uid: SARAH.id, name: SARAH.name, role: 'parent' } });
    // Parent sees the per-member balance label
    expect(screen.getByLabelText(/member balances/i)).toBeInTheDocument();
  });

  it('shows per-member balance chips with formatted money for parent viewer', () => {
    renderScreen({ viewer: { uid: SARAH.id, name: SARAH.name, role: 'parent' } });
    // Maya $50.00, Ben $12.00 — both rendered.
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('$12.00')).toBeInTheDocument();
  });

  it('member viewer with a NaN balance shows the "balance unavailable" indicator (never "$0.00")', () => {
    const broken: UserWithId = { ...MAYA, allowanceBalance: Number.NaN };
    renderScreen({
      viewer: { uid: broken.id, name: broken.name, role: 'member' },
      members: [SARAH, broken, BEN],
    });
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.getByText(/balance unavailable/i)).toBeInTheDocument();
  });
});

describe('WishlistScreen — owner actions on wishing items', () => {
  it('shows Request and Edit and Remove on a wishing item the viewer owns', () => {
    renderScreen({
      feed: { items: [mk({ id: 'w1', title: 'Switch', costCents: 30000 })], loading: false, error: null },
    });
    expect(screen.getByRole('button', { name: /request to buy Switch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /edit Switch/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /remove Switch/i })).toBeInTheDocument();
  });

  it('dispatches onRequest with the item id when Request is clicked', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      feed: { items: [mk({ id: 'w1' })], loading: false, error: null },
      onRequest,
    });
    fireEvent.click(screen.getByRole('button', { name: /request to buy/i }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('w1'));
  });

  it('dispatches onDelete with the item id when Remove is clicked', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      feed: { items: [mk({ id: 'w1' })], loading: false, error: null },
      onDelete,
    });
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith('w1'));
  });

  it('does NOT show Edit or Remove on items owned by OTHER members (still rendered when parent)', () => {
    renderScreen({
      viewer: { uid: SARAH.id, name: SARAH.name, role: 'parent' },
      feed: { items: [mk({ id: 'w1', ownerUid: MAYA.id })], loading: false, error: null },
    });
    expect(screen.queryByRole('button', { name: /edit Wish w1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove Wish w1/i })).not.toBeInTheDocument();
  });
});

describe('WishlistScreen — owner actions on requested items', () => {
  it('shows Cancel request on a requested item the viewer owns', () => {
    renderScreen({
      feed: {
        items: [mk({ id: 'r1', status: 'requested' })],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByRole('button', { name: /cancel request for/i })).toBeInTheDocument();
  });

  it('dispatches onCancelRequest when Cancel is clicked', async () => {
    const onCancelRequest = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      feed: { items: [mk({ id: 'r1', status: 'requested' })], loading: false, error: null },
      onCancelRequest,
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel request/i }));
    await waitFor(() => expect(onCancelRequest).toHaveBeenCalledWith('r1'));
  });

  it('does NOT show Request/Edit/Remove on a requested item (immutable while pending)', () => {
    renderScreen({
      feed: { items: [mk({ id: 'r1', status: 'requested' })], loading: false, error: null },
    });
    expect(screen.queryByRole('button', { name: /request to buy/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /edit Wish r1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /remove Wish r1/i })).not.toBeInTheDocument();
  });
});

describe('WishlistScreen — owner actions on denied items (Try again)', () => {
  it('shows the denied reason inline', () => {
    renderScreen({
      feed: {
        items: [
          mk({
            id: 'd1',
            status: 'denied',
            deniedReason: 'Save up more first',
            resolvedAt: 2000,
          }),
        ],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByText(/save up more first/i)).toBeInTheDocument();
  });

  it('shows a Try again button that dispatches onRequest', async () => {
    const onRequest = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      feed: {
        items: [mk({ id: 'd1', status: 'denied', deniedReason: 'Nope' })],
        loading: false,
        error: null,
      },
      onRequest,
    });
    fireEvent.click(screen.getByRole('button', { name: /try requesting/i }));
    await waitFor(() => expect(onRequest).toHaveBeenCalledWith('d1'));
  });
});

describe('WishlistScreen — redeemed footer', () => {
  it('moves redeemed items into a separate "Recently redeemed" section', () => {
    renderScreen({
      feed: {
        items: [
          mk({ id: 'w1', status: 'wishing' }),
          mk({ id: 'r1', status: 'redeemed', resolvedAt: 5000 }),
        ],
        loading: false,
        error: null,
      },
    });
    expect(screen.getByRole('heading', { name: /recently redeemed/i })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: /redeemed items/i });
    expect(within(list).getByText('Wish r1')).toBeInTheDocument();
  });

  it('a redeemed item does NOT carry any action buttons (terminal state)', () => {
    renderScreen({
      feed: { items: [mk({ id: 'r1', status: 'redeemed' })], loading: false, error: null },
    });
    expect(screen.queryByRole('button', { name: /request|edit|remove/i })).not.toBeInTheDocument();
  });
});

describe('WishlistScreen — parent approval queue', () => {
  function withQueue(overrides: Partial<WishlistScreenProps> = {}) {
    return renderScreen({
      viewer: { uid: SARAH.id, name: SARAH.name, role: 'parent' },
      onApprove: vi.fn().mockResolvedValue(undefined),
      onDeny: vi.fn().mockResolvedValue(undefined),
      feed: {
        items: [
          mk({ id: 'q1', title: 'Switch', status: 'requested', costCents: 30000, ownerUid: MAYA.id }),
          mk({ id: 'q2', title: 'Lego', status: 'requested', costCents: 5000, ownerUid: BEN.id }),
          mk({ id: 'w1', title: 'Book', status: 'wishing', costCents: 1500, ownerUid: MAYA.id }),
        ],
        loading: false,
        error: null,
      },
      ...overrides,
    });
  }

  it('renders the queue heading with the pending count', () => {
    withQueue();
    expect(screen.getByRole('heading', { name: /2 redemption[s]? to review/i })).toBeInTheDocument();
  });

  it('shows the total requested money sum (formatted) above the queue', () => {
    withQueue();
    // 30000 + 5000 = 35000 cents = $350.00
    expect(screen.getByText(/total requested:.*\$350\.00/i)).toBeInTheDocument();
  });

  it('renders an Approve button per requested item with an accessible name carrying title/owner/amount', () => {
    withQueue();
    expect(
      screen.getByRole('button', { name: /Approve Switch for Maya \(\$300\.00\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Approve Lego for Ben \(\$50\.00\)/ }),
    ).toBeInTheDocument();
  });

  it('dispatches onApprove with the item id when Approve is clicked', async () => {
    const props = withQueue();
    fireEvent.click(screen.getByRole('button', { name: /Approve Switch for Maya/ }));
    await waitFor(() => expect(props.onApprove).toHaveBeenCalledWith('q1'));
  });

  it('clicking Send back reveals a required reason input', () => {
    withQueue();
    // Multiple "Send back" buttons (one per row). Pick the first.
    const sendBack = screen.getAllByRole('button', { name: /^Send back$/i });
    fireEvent.click(sendBack[0]!);
    expect(screen.getByLabelText(/why are you sending it back/i)).toBeInTheDocument();
  });

  it('REJECTS empty reason: flags aria-invalid + surfaces the inline error (no silent no-op)', () => {
    const props = withQueue();
    fireEvent.click(screen.getAllByRole('button', { name: /^Send back$/i })[0]!);
    // Confirm without a reason
    const confirm = screen.getByRole('button', { name: /Send back Switch for Maya/i });
    fireEvent.click(confirm);
    expect(screen.getByText(/please add a short reason/i)).toBeInTheDocument();
    expect(props.onDeny).not.toHaveBeenCalled();
  });

  it('dispatches onDeny with the trimmed reason on confirm', async () => {
    const props = withQueue();
    fireEvent.click(screen.getAllByRole('button', { name: /^Send back$/i })[0]!);
    const input = screen.getByLabelText(/why are you sending it back/i);
    fireEvent.change(input, { target: { value: '  Save up more first  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send back Switch for Maya/i }));
    await waitFor(() => expect(props.onDeny).toHaveBeenCalledWith('q1', 'Save up more first'));
  });

  it('does NOT show the approval queue to a member viewer', () => {
    renderScreen({
      viewer: { uid: MAYA.id, name: MAYA.name, role: 'member' },
      feed: {
        items: [mk({ id: 'q1', status: 'requested', ownerUid: MAYA.id })],
        loading: false,
        error: null,
      },
    });
    // A member viewer sees Cancel on their own requested item, never Approve.
    expect(screen.queryByRole('button', { name: /^Approve$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /redemption[s]? to review/i })).not.toBeInTheDocument();
  });
});

describe('WishlistScreen — create flow', () => {
  it('opens a sheet with a title + cost field when the FAB is clicked', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /\+ New wish/i }));
    expect(screen.getByLabelText(/what do you want/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cost \(in dollars\)/i)).toBeInTheDocument();
  });

  it('dispatches onCreate with the parsed integer-cents cost', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /\+ New wish/i }));
    fireEvent.change(screen.getByLabelText(/what do you want/i), {
      target: { value: '  Nintendo Switch  ' },
    });
    fireEvent.change(screen.getByLabelText(/cost \(in dollars\)/i), { target: { value: '300.50' } });
    fireEvent.click(screen.getByRole('button', { name: /add wish/i }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith({ title: 'Nintendo Switch', costCents: 30050 }),
    );
  });

  it('REJECTS an empty title (inline error; no dispatch)', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /\+ New wish/i }));
    fireEvent.change(screen.getByLabelText(/cost \(in dollars\)/i), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: /add wish/i }));
    expect(await screen.findByText(/please give the wish a name/i)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it('REJECTS an invalid cost (inline error; no dispatch)', async () => {
    const onCreate = vi.fn().mockResolvedValue(undefined);
    renderScreen({ onCreate });
    fireEvent.click(screen.getByRole('button', { name: /\+ New wish/i }));
    fireEvent.change(screen.getByLabelText(/what do you want/i), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/cost \(in dollars\)/i), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: /add wish/i }));
    expect(await screen.findByText(/positive amount/i)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe('WishlistScreen — edit flow', () => {
  it('opens an edit sheet pre-filled with the current title and cost (as dollars)', () => {
    renderScreen({
      feed: { items: [mk({ id: 'w1', title: 'Switch', costCents: 30000 })], loading: false, error: null },
    });
    fireEvent.click(screen.getByRole('button', { name: /edit Switch/i }));
    expect(screen.getByDisplayValue('Switch')).toBeInTheDocument();
    expect(screen.getByDisplayValue('300.00')).toBeInTheDocument();
  });

  it('dispatches onUpdate with the patch (cents) on save', async () => {
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    renderScreen({
      feed: { items: [mk({ id: 'w1', title: 'Switch', costCents: 30000 })], loading: false, error: null },
      onUpdate,
    });
    fireEvent.click(screen.getByRole('button', { name: /edit Switch/i }));
    fireEvent.change(screen.getByLabelText(/what do you want/i), {
      target: { value: 'Nintendo Switch OLED' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith('w1', {
        title: 'Nintendo Switch OLED',
        costCents: 30000,
      }),
    );
  });
});

describe('WishlistScreen — status badges (text label, not color alone)', () => {
  it('renders a "Requested" badge on requested items', () => {
    renderScreen({
      feed: { items: [mk({ id: 'r1', status: 'requested' })], loading: false, error: null },
    });
    expect(screen.getAllByText(/^Requested$/i).length).toBeGreaterThan(0);
  });

  it('renders a "Redeemed" badge on redeemed items', () => {
    renderScreen({
      feed: { items: [mk({ id: 'r1', status: 'redeemed' })], loading: false, error: null },
    });
    expect(screen.getByText(/^Redeemed$/i)).toBeInTheDocument();
  });

  it('renders a "Sent back" badge on denied items', () => {
    renderScreen({
      feed: { items: [mk({ id: 'd1', status: 'denied' })], loading: false, error: null },
    });
    expect(screen.getByText(/^Sent back$/i)).toBeInTheDocument();
  });
});
