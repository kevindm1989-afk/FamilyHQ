/**
 * Wishlist service — unit contract (ADR-0004 / ADR-0009; Feature 4).
 *
 * Mirrors choresParentService.test.ts in shape. Firestore is mocked at the
 * SDK boundary so we pin the SERVICE behavior — most importantly the
 * `approveRedemption` runTransaction (re-read item + user; abort unless
 * status='requested', cross-family, insufficient funds; then three writes:
 * flip status to 'redeemed', decrement allowanceBalance by costCents,
 * append ONE 'spending' ledger row). User-safe error mapping is asserted
 * too — raw provider text must never surface.
 *
 * The true end-to-end transaction through the live rules is covered by
 * test/rules/wishlistItems.test.ts; here we lock the client contract.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface TxnOp {
  op: 'update' | 'set';
  ref: { __collection: string; __id?: string };
  data: Record<string, unknown>;
}

let itemDocData: Record<string, unknown> | undefined;
let userDocData: Record<string, unknown> | undefined;
let txnOps: TxnOp[];
let updateShouldReject: boolean;
let addShouldReject: boolean;

const collectionMock = vi.fn((_db: unknown, name: string) => {
  const ref: { __collection: string; withConverter: () => unknown } = {
    __collection: name,
    withConverter: () => ref,
  };
  return ref;
});
const docMock = vi.fn((arg1: unknown, name?: string, id?: string) => {
  if (typeof name === 'string') {
    return { __collection: name, __id: id };
  }
  const ref = arg1 as { __collection: string };
  return { __collection: ref.__collection, __id: 'generated-id' };
});
const serverTimestampMock = vi.fn(() => ({ __serverTimestamp: true }));
const deleteFieldMock = vi.fn(() => ({ __deleteField: true }));

const addDocMock = vi.fn(async (ref: { __collection: string }, data: Record<string, unknown>) => {
  if (addShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
  txnOps.push({ op: 'set', ref, data });
  return { id: 'generated-id' };
});
const updateDocMock = vi.fn(
  async (ref: { __collection: string; __id?: string }, data: Record<string, unknown>) => {
    if (updateShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
    txnOps.push({ op: 'update', ref, data });
  },
);
const deleteDocMock = vi.fn(async (ref: { __collection: string; __id?: string }) => {
  if (updateShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
  txnOps.push({ op: 'update', ref, data: { __deleted: true } });
});
const getDocMock = vi.fn(async (_ref: unknown) => ({
  exists: () => itemDocData !== undefined,
  data: () => itemDocData,
}));

const runTransactionMock = vi.fn(
  async (_db: unknown, updater: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: async (ref: { __collection: string }) => {
        if (ref.__collection === 'wishlistItems') {
          return {
            exists: () => itemDocData !== undefined,
            data: () => itemDocData,
          };
        }
        if (ref.__collection === 'users') {
          return {
            exists: () => userDocData !== undefined,
            data: () => userDocData,
          };
        }
        return { exists: () => false, data: () => undefined };
      },
      update: (ref: { __collection: string; __id?: string }, data: Record<string, unknown>) => {
        txnOps.push({ op: 'update', ref, data });
      },
      set: (ref: { __collection: string; __id?: string }, data: Record<string, unknown>) => {
        txnOps.push({ op: 'set', ref, data });
      },
    };
    await updater(tx);
  },
);

vi.mock('firebase/firestore', () => ({
  collection: (...a: [unknown, string]) => collectionMock(...a),
  doc: (...a: [unknown, string?, string?]) => docMock(...a),
  addDoc: (...a: [{ __collection: string }, Record<string, unknown>]) => addDocMock(...a),
  updateDoc: (...a: [{ __collection: string; __id?: string }, Record<string, unknown>]) =>
    updateDocMock(...a),
  deleteDoc: (ref: { __collection: string; __id?: string }) => deleteDocMock(ref),
  getDoc: (ref: unknown) => getDocMock(ref),
  serverTimestamp: () => serverTimestampMock(),
  deleteField: () => deleteFieldMock(),
  runTransaction: (...a: [unknown, (tx: unknown) => Promise<void>]) => runTransactionMock(...a),
}));

vi.mock('../../lib/converters', () => ({
  wishlistItemConverter: { __converter: 'wishlistItem' },
}));

import {
  WISHLIST_COST_INVALID,
  WISHLIST_DENIED_REASON_EMPTY,
  WISHLIST_DENIED_REASON_MAX,
  WISHLIST_GENERIC_ERROR,
  WISHLIST_INSUFFICIENT_FUNDS,
  WISHLIST_NOT_REQUESTED,
  WISHLIST_TITLE_EMPTY,
  WISHLIST_TITLE_MAX,
  WISHLIST_TITLE_TOO_LONG,
  WishlistActionError,
  approveRedemption,
  cancelRedemption,
  createWishlistItem,
  deleteWishlistItem,
  denyRedemption,
  pendingRedemptions,
  requestRedemption,
  totalRequestedCents,
  updateWishlistItem,
  type WishlistItemWithId,
} from './wishlistService';

const db = {} as import('firebase/firestore').Firestore;
const FIXED_NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

beforeEach(() => {
  txnOps = [];
  updateShouldReject = false;
  addShouldReject = false;
  itemDocData = {
    familyId: 'fam-A',
    ownerUid: 'uid-member-a',
    title: 'Nintendo Switch',
    costCents: 30000,
    status: 'requested',
    createdAt: 1000,
    requestedAt: 1500,
  };
  userDocData = {
    name: 'Maya',
    role: 'member',
    familyId: 'fam-A',
    allowanceBalance: 50000,
    isActive: true,
    theme: 'light',
  };
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('createWishlistItem — owner-side create with hardened shape', () => {
  it('writes a wishing item with the create-time fields', async () => {
    await createWishlistItem(
      { db },
      {
        familyId: 'fam-A',
        ownerUid: 'uid-member-a',
        title: 'Nintendo Switch',
        costCents: 30000,
      },
    );
    expect(addDocMock).toHaveBeenCalledTimes(1);
    const [, payload] = addDocMock.mock.calls[0]!;
    expect((payload as Record<string, unknown>).status).toBe('wishing');
    expect((payload as Record<string, unknown>).familyId).toBe('fam-A');
    expect((payload as Record<string, unknown>).ownerUid).toBe('uid-member-a');
    expect((payload as Record<string, unknown>).title).toBe('Nintendo Switch');
    expect((payload as Record<string, unknown>).costCents).toBe(30000);
    expect('createdAt' in (payload as Record<string, unknown>)).toBe(true);
  });

  it('trims the title before persisting', async () => {
    await createWishlistItem(
      { db },
      { familyId: 'fam-A', ownerUid: 'u', title: '  Lego set  ', costCents: 5000 },
    );
    const [, payload] = addDocMock.mock.calls[0]!;
    expect((payload as Record<string, unknown>).title).toBe('Lego set');
  });

  it('omits savingsGoalId when not provided (no empty-string keys leaked)', async () => {
    await createWishlistItem(
      { db },
      { familyId: 'fam-A', ownerUid: 'u', title: 'Book', costCents: 2000 },
    );
    const [, payload] = addDocMock.mock.calls[0]!;
    expect('savingsGoalId' in (payload as Record<string, unknown>)).toBe(false);
  });

  it('includes savingsGoalId when provided', async () => {
    await createWishlistItem(
      { db },
      {
        familyId: 'fam-A',
        ownerUid: 'u',
        title: 'Book',
        costCents: 2000,
        savingsGoalId: 'goal-1',
      },
    );
    const [, payload] = addDocMock.mock.calls[0]!;
    expect((payload as Record<string, unknown>).savingsGoalId).toBe('goal-1');
  });

  it('omits savingsGoalId when empty string is passed', async () => {
    await createWishlistItem(
      { db },
      {
        familyId: 'fam-A',
        ownerUid: 'u',
        title: 'Book',
        costCents: 2000,
        savingsGoalId: '',
      },
    );
    const [, payload] = addDocMock.mock.calls[0]!;
    expect('savingsGoalId' in (payload as Record<string, unknown>)).toBe(false);
  });

  it('REJECTS an empty title with WISHLIST_TITLE_EMPTY', async () => {
    await expect(
      createWishlistItem(
        { db },
        { familyId: 'fam-A', ownerUid: 'u', title: '   ', costCents: 5000 },
      ),
    ).rejects.toThrow(WISHLIST_TITLE_EMPTY);
    expect(addDocMock).not.toHaveBeenCalled();
  });

  it('REJECTS a title over WISHLIST_TITLE_MAX', async () => {
    const long = 'x'.repeat(WISHLIST_TITLE_MAX + 1);
    await expect(
      createWishlistItem({ db }, { familyId: 'fam-A', ownerUid: 'u', title: long, costCents: 5000 }),
    ).rejects.toThrow(WISHLIST_TITLE_TOO_LONG);
  });

  it('REJECTS a zero or negative cost (must be positive cents)', async () => {
    await expect(
      createWishlistItem({ db }, { familyId: 'fam-A', ownerUid: 'u', title: 'X', costCents: 0 }),
    ).rejects.toThrow(WISHLIST_COST_INVALID);
    await expect(
      createWishlistItem({ db }, { familyId: 'fam-A', ownerUid: 'u', title: 'X', costCents: -10 }),
    ).rejects.toThrow(WISHLIST_COST_INVALID);
  });

  it('REJECTS a non-integer cost (fractional cents)', async () => {
    await expect(
      createWishlistItem({ db }, { familyId: 'fam-A', ownerUid: 'u', title: 'X', costCents: 350.5 }),
    ).rejects.toThrow(WISHLIST_COST_INVALID);
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    addShouldReject = true;
    await expect(
      createWishlistItem(
        { db },
        { familyId: 'fam-A', ownerUid: 'u', title: 'X', costCents: 100 },
      ),
    ).rejects.toThrow(WISHLIST_GENERIC_ERROR);
  });
});

describe('updateWishlistItem — owner edits a wishing item', () => {
  it('writes only the supplied fields', async () => {
    await updateWishlistItem({ db }, 'item-1', { title: 'New title' });
    expect(updateDocMock).toHaveBeenCalledTimes(1);
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect(patch).toEqual({ title: 'New title' });
  });

  it('trims the title before persisting', async () => {
    await updateWishlistItem({ db }, 'item-1', { title: '  Trimmed  ' });
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect((patch as Record<string, unknown>).title).toBe('Trimmed');
  });

  it('REJECTS an empty title', async () => {
    await expect(updateWishlistItem({ db }, 'item-1', { title: '   ' })).rejects.toThrow(
      WISHLIST_TITLE_EMPTY,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('REJECTS a too-long title', async () => {
    await expect(
      updateWishlistItem({ db }, 'item-1', { title: 'x'.repeat(WISHLIST_TITLE_MAX + 1) }),
    ).rejects.toThrow(WISHLIST_TITLE_TOO_LONG);
  });

  it('REJECTS an invalid cost', async () => {
    await expect(updateWishlistItem({ db }, 'item-1', { costCents: 0 })).rejects.toThrow(
      WISHLIST_COST_INVALID,
    );
    await expect(updateWishlistItem({ db }, 'item-1', { costCents: -1 })).rejects.toThrow(
      WISHLIST_COST_INVALID,
    );
  });

  it('writes deleteField sentinel when savingsGoalId is null or empty', async () => {
    await updateWishlistItem({ db }, 'item-1', { savingsGoalId: null });
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect((patch as Record<string, unknown>).savingsGoalId).toEqual({ __deleteField: true });

    updateDocMock.mockClear();
    deleteFieldMock.mockClear();
    await updateWishlistItem({ db }, 'item-1', { savingsGoalId: '' });
    const [, patch2] = updateDocMock.mock.calls[0]!;
    expect((patch2 as Record<string, unknown>).savingsGoalId).toEqual({ __deleteField: true });
  });

  it('writes a string savingsGoalId when provided', async () => {
    await updateWishlistItem({ db }, 'item-1', { savingsGoalId: 'goal-2' });
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect((patch as Record<string, unknown>).savingsGoalId).toBe('goal-2');
  });

  it('is a no-op (no write) when no fields are supplied', async () => {
    await updateWishlistItem({ db }, 'item-1', {});
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    updateShouldReject = true;
    await expect(updateWishlistItem({ db }, 'item-1', { title: 'X' })).rejects.toThrow(
      WISHLIST_GENERIC_ERROR,
    );
  });
});

describe('deleteWishlistItem — owner removes their own item', () => {
  it('calls deleteDoc with the right reference', async () => {
    await deleteWishlistItem({ db }, 'item-1');
    expect(deleteDocMock).toHaveBeenCalledTimes(1);
    const [ref] = deleteDocMock.mock.calls[0]!;
    expect((ref as { __collection: string }).__collection).toBe('wishlistItems');
    expect((ref as { __id: string }).__id).toBe('item-1');
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    updateShouldReject = true;
    await expect(deleteWishlistItem({ db }, 'item-1')).rejects.toThrow(WISHLIST_GENERIC_ERROR);
  });
});

describe('requestRedemption — owner flips wishing → requested', () => {
  it('writes status="requested", requestedAt, and clears deniedReason', async () => {
    await requestRedemption({ db }, 'item-1');
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect((patch as Record<string, unknown>).status).toBe('requested');
    expect('requestedAt' in (patch as Record<string, unknown>)).toBe(true);
    expect((patch as Record<string, unknown>).deniedReason).toEqual({ __deleteField: true });
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    updateShouldReject = true;
    await expect(requestRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_GENERIC_ERROR);
  });
});

describe('cancelRedemption — owner flips requested → wishing', () => {
  it('writes status="wishing"', async () => {
    await cancelRedemption({ db }, 'item-1');
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect((patch as Record<string, unknown>).status).toBe('wishing');
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    updateShouldReject = true;
    await expect(cancelRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_GENERIC_ERROR);
  });
});

describe('denyRedemption — parent flips requested → denied with a reason', () => {
  it('writes status="denied", trimmed reason, and resolvedAt', async () => {
    await denyRedemption({ db }, 'item-1', '  Save up more first  ');
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect((patch as Record<string, unknown>).status).toBe('denied');
    expect((patch as Record<string, unknown>).deniedReason).toBe('Save up more first');
    expect('resolvedAt' in (patch as Record<string, unknown>)).toBe(true);
  });

  it('truncates a long reason to WISHLIST_DENIED_REASON_MAX', async () => {
    const long = 'a'.repeat(WISHLIST_DENIED_REASON_MAX + 50);
    await denyRedemption({ db }, 'item-1', long);
    const [, patch] = updateDocMock.mock.calls[0]!;
    expect(((patch as Record<string, unknown>).deniedReason as string).length).toBe(
      WISHLIST_DENIED_REASON_MAX,
    );
  });

  it('REJECTS an empty / whitespace reason BEFORE any write', async () => {
    await expect(denyRedemption({ db }, 'item-1', '   ')).rejects.toThrow(
      WISHLIST_DENIED_REASON_EMPTY,
    );
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    updateShouldReject = true;
    await expect(denyRedemption({ db }, 'item-1', 'Nope')).rejects.toThrow(WISHLIST_GENERIC_ERROR);
  });
});

describe('approveRedemption — runs ONE transaction with three atomic writes', () => {
  it('runs inside a single runTransaction (not separate writes)', async () => {
    await approveRedemption({ db }, 'item-1');
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('flips the wishlist item status to "redeemed" and stamps resolvedAt', async () => {
    await approveRedemption({ db }, 'item-1');
    const itemUpdate = txnOps.find(
      (o) => o.op === 'update' && o.ref.__collection === 'wishlistItems',
    );
    expect(itemUpdate, 'an update on the item doc must occur').toBeDefined();
    expect((itemUpdate!.data as Record<string, unknown>).status).toBe('redeemed');
    expect('resolvedAt' in (itemUpdate!.data as Record<string, unknown>)).toBe(true);
  });

  it('decrements the owner allowanceBalance by EXACTLY costCents', async () => {
    await approveRedemption({ db }, 'item-1');
    const balUpdate = txnOps.find((o) => o.op === 'update' && o.ref.__collection === 'users');
    expect(balUpdate, 'a balance update on users/{ownerUid} must occur').toBeDefined();
    expect(balUpdate!.ref.__id, 'the balance write targets the owner uid').toBe('uid-member-a');
    // 50000 - 30000 = 20000 cents.
    expect((balUpdate!.data as Record<string, unknown>).allowanceBalance).toBe(20000);
  });

  it('writes EXACTLY ONE spending transaction doc with the 7-field shape', async () => {
    await approveRedemption({ db }, 'item-1');
    const txnSets = txnOps.filter((o) => o.op === 'set' && o.ref.__collection === 'transactions');
    expect(txnSets, 'exactly one ledger doc is written').toHaveLength(1);
    const data = txnSets[0]!.data;
    expect(data.uid).toBe('uid-member-a');
    expect(data.sourceId).toBe('item-1');
    expect(data.sourceLabel).toBe('Nintendo Switch');
    expect(data.amount).toBe(30000);
    expect(data.type).toBe('spending');
    expect(data.familyId).toBe('fam-A');
    expect('createdAt' in data, 'the ledger doc carries createdAt').toBe(true);
    // No extra keys smuggled onto the ledger doc (shape lock).
    expect(Object.keys(data).sort()).toEqual(
      ['amount', 'createdAt', 'familyId', 'sourceId', 'sourceLabel', 'type', 'uid'].sort(),
    );
  });

  it('does the item-flip, balance debit, and ledger write ALL within the SAME transaction', async () => {
    await approveRedemption({ db }, 'item-1');
    expect(txnOps.filter((o) => o.ref.__collection === 'wishlistItems')).toHaveLength(1);
    expect(txnOps.filter((o) => o.ref.__collection === 'users')).toHaveLength(1);
    expect(txnOps.filter((o) => o.ref.__collection === 'transactions')).toHaveLength(1);
    expect(updateDocMock, 'no out-of-transaction updateDoc').not.toHaveBeenCalled();
    expect(addDocMock, 'no out-of-transaction addDoc').not.toHaveBeenCalled();
  });
});

describe('approveRedemption — idempotency guard: aborts unless the re-read item is requested', () => {
  it('ABORTS (rejects) and writes NOTHING when the item is already redeemed', async () => {
    itemDocData = { ...itemDocData, status: 'redeemed' };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toBeInstanceOf(WishlistActionError);
    await expect(approveRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_NOT_REQUESTED);
    expect(txnOps, 'no writes on a non-requested item').toHaveLength(0);
  });

  it('ABORTS when the item is in wishing state', async () => {
    itemDocData = { ...itemDocData, status: 'wishing' };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_NOT_REQUESTED);
    expect(txnOps).toHaveLength(0);
  });

  it('ABORTS when the item is denied', async () => {
    itemDocData = { ...itemDocData, status: 'denied' };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_NOT_REQUESTED);
    expect(txnOps).toHaveLength(0);
  });

  it('ABORTS when the item does not exist (rejects with not-requested copy)', async () => {
    itemDocData = undefined;
    await expect(approveRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_NOT_REQUESTED);
    expect(txnOps).toHaveLength(0);
  });
});

describe('approveRedemption — money safety guards', () => {
  it('ABORTS when the item costCents is malformed (fractional / negative)', async () => {
    itemDocData = { ...itemDocData, costCents: 350.5 };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toBeInstanceOf(WishlistActionError);
    expect(txnOps).toHaveLength(0);
  });

  it('ABORTS when the owner allowanceBalance is malformed', async () => {
    userDocData = { ...userDocData, allowanceBalance: 'oops' };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toBeInstanceOf(WishlistActionError);
    expect(txnOps).toHaveLength(0);
  });

  it('ABORTS with WISHLIST_INSUFFICIENT_FUNDS when balance < costCents', async () => {
    userDocData = { ...userDocData, allowanceBalance: 100 };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toThrow(WISHLIST_INSUFFICIENT_FUNDS);
    expect(txnOps).toHaveLength(0);
  });

  it('ALLOWS exact-balance redemption (balance === costCents, ending at $0.00)', async () => {
    userDocData = { ...userDocData, allowanceBalance: 30000 };
    await approveRedemption({ db }, 'item-1');
    const balUpdate = txnOps.find((o) => o.ref.__collection === 'users')!;
    expect((balUpdate.data as Record<string, unknown>).allowanceBalance).toBe(0);
  });

  it('ABORTS (cross-tenant guard) when item.familyId !== user.familyId', async () => {
    userDocData = { ...userDocData, familyId: 'fam-B' };
    await expect(approveRedemption({ db }, 'item-1')).rejects.toBeInstanceOf(WishlistActionError);
    expect(txnOps, 'no debit on a foreign-family user').toHaveLength(0);
  });

  it('ABORTS when the owner user doc does not exist', async () => {
    userDocData = undefined;
    await expect(approveRedemption({ db }, 'item-1')).rejects.toBeInstanceOf(WishlistActionError);
    expect(txnOps).toHaveLength(0);
  });
});

describe('approveRedemption — error mapping (privacy): raw provider text never surfaces', () => {
  it('maps a transaction failure to the generic PII-free message', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('permission-denied: raw firebase, must not surface');
    });
    await expect(approveRedemption({ db }, 'secret-item')).rejects.toThrow(WISHLIST_GENERIC_ERROR);
  });

  it('the surfaced error contains no raw provider text and no item id', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('permission-denied: raw firebase');
    });
    const err = await approveRedemption({ db }, 'secret-item-id').then(
      () => new Error('expected approveRedemption to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(WISHLIST_GENERIC_ERROR);
    expect(err.message).not.toMatch(/permission-denied|firebase/i);
    expect(err.message).not.toContain('secret-item-id');
  });
});

describe('WishlistActionError', () => {
  it('defaults to the generic error message', () => {
    const err = new WishlistActionError();
    expect(err.message).toBe(WISHLIST_GENERIC_ERROR);
    expect(err.name).toBe('WishlistActionError');
  });

  it('preserves a custom message', () => {
    const err = new WishlistActionError(WISHLIST_INSUFFICIENT_FUNDS);
    expect(err.message).toBe(WISHLIST_INSUFFICIENT_FUNDS);
  });
});

describe('totalRequestedCents — pure selector for the approval badge', () => {
  function mkItem(over: Partial<WishlistItemWithId>): WishlistItemWithId {
    return {
      id: 'i',
      familyId: 'fam-A',
      ownerUid: 'u',
      title: 'X',
      costCents: 100,
      status: 'wishing',
      createdAt: 1,
      ...over,
    };
  }

  it('sums only items in "requested" state', () => {
    expect(
      totalRequestedCents([
        mkItem({ id: 'a', status: 'requested', costCents: 100 }),
        mkItem({ id: 'b', status: 'wishing', costCents: 200 }),
        mkItem({ id: 'c', status: 'requested', costCents: 300 }),
        mkItem({ id: 'd', status: 'redeemed', costCents: 400 }),
        mkItem({ id: 'e', status: 'denied', costCents: 500 }),
      ]),
    ).toBe(400);
  });

  it('returns 0 for an empty list', () => {
    expect(totalRequestedCents([])).toBe(0);
  });

  it('skips items with a malformed costCents (NaN / negative / fractional)', () => {
    expect(
      totalRequestedCents([
        mkItem({ id: 'a', status: 'requested', costCents: 100 }),
        mkItem({ id: 'b', status: 'requested', costCents: Number.NaN }),
        mkItem({ id: 'c', status: 'requested', costCents: -10 }),
        mkItem({ id: 'd', status: 'requested', costCents: 350.5 }),
      ]),
    ).toBe(100);
  });
});

describe('pendingRedemptions — pure selector listing the requested items', () => {
  function mkItem(over: Partial<WishlistItemWithId>): WishlistItemWithId {
    return {
      id: 'i',
      familyId: 'fam-A',
      ownerUid: 'u',
      title: 'X',
      costCents: 100,
      status: 'wishing',
      createdAt: 1,
      ...over,
    };
  }

  it('returns ONLY items in "requested" status', () => {
    const out = pendingRedemptions([
      mkItem({ id: 'a', status: 'wishing' }),
      mkItem({ id: 'b', status: 'requested' }),
      mkItem({ id: 'c', status: 'redeemed' }),
      mkItem({ id: 'd', status: 'requested' }),
    ]);
    expect(out.map((i) => i.id)).toEqual(['b', 'd']);
  });

  it('returns an empty array when none are requested', () => {
    expect(pendingRedemptions([mkItem({ id: 'a', status: 'wishing' })])).toEqual([]);
  });
});
