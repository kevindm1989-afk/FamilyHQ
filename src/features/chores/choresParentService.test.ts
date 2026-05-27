/**
 * Chores PARENT service — unit contract (Task 11; ADR-0004; threat-model
 * M27/M28/F4, T1.8/M8). Mirrors choresMemberService.test.ts / calendarService.
 *
 * Level: unit. Firestore is mocked at the SDK boundary so we assert the SERVICE
 * behavior — the EXACT transaction the approve path runs (re-read chore, abort
 * unless complete, flip to approved, increment the assignee balance by
 * dollarValue, append ONE earning ledger doc), the reject shape + reason
 * validation, the hardened addChore shape, PII-free error mapping, and the pure
 * selectors. The rule-level authority + true idempotency through the live rules
 * is covered by test/rules/allowance-approval.test.ts (the emulator runs the
 * real transaction); here we pin the CLIENT contract.
 *
 * FAILS today: choresParentService.ts is a declare-only contract stub (every
 * function throws 'not implemented').
 *
 * Isolation: clock frozen (vi.useFakeTimers); no network/RNG; each test
 * re-creates its mocks (no shared mutable state, order-independent).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock the Firestore SDK surfaces the service depends on. ---
// We model a runTransaction that hands the callback a `tx` object recording the
// get/update/set calls, and a chore doc whose status the test controls. This
// lets us assert the EXACT transactional writes without an emulator.

interface TxnOp {
  op: 'update' | 'set';
  ref: { __collection: string; __id?: string };
  data: Record<string, unknown>;
}

let choreDocData: Record<string, unknown> | undefined;
let txnOps: TxnOp[];
let addShouldReject: boolean;
let updateShouldReject: boolean;

const collectionMock = vi.fn((_db: unknown, name: string) => ({ __collection: name }));
const docMock = vi.fn((arg1: unknown, name?: string, id?: string) => {
  // doc(db, collection, id) OR doc(collectionRef) (auto-id). Normalize both.
  if (typeof name === 'string') {
    return { __collection: name, __id: id };
  }
  const ref = arg1 as { __collection: string };
  return { __collection: ref.__collection, __id: 'generated-id' };
});
const incrementMock = vi.fn((n: number) => ({ __increment: n }));
const serverTimestampMock = vi.fn(() => ({ __serverTimestamp: true }));

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
const setDocMock = vi.fn(
  async (ref: { __collection: string; __id?: string }, data: Record<string, unknown>) => {
    if (addShouldReject) throw new Error('emulated-firestore-failure (raw, must not surface)');
    txnOps.push({ op: 'set', ref, data });
  },
);

const runTransactionMock = vi.fn(
  async (_db: unknown, updater: (tx: unknown) => Promise<void>) => {
    const tx = {
      get: async (_ref: unknown) => ({
        exists: () => choreDocData !== undefined,
        data: () => choreDocData,
      }),
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
  setDoc: (...a: [{ __collection: string; __id?: string }, Record<string, unknown>]) =>
    setDocMock(...a),
  increment: (n: number) => incrementMock(n),
  serverTimestamp: () => serverTimestampMock(),
  runTransaction: (...a: [unknown, (tx: unknown) => Promise<void>]) => runTransactionMock(...a),
}));

// Imported AFTER mocks are registered.
import {
  ALL_MEMBERS_TAB_ID,
  CHORE_ADD_SUCCESS,
  CHORE_APPROVE_SUCCESS,
  CHORE_PARENT_GENERIC_ERROR,
  CHORE_REJECT_SUCCESS,
  ChoreActionError,
  MONEY_INVALID_INDICATOR,
  MONEY_MAX_CENTS,
  addChore,
  approvalQueue,
  approveChore,
  canManageChores,
  choresForTab,
  formatMoney,
  isValidMoneyCents,
  memberFilterTabs,
  pendingApprovalCount,
  rejectChore,
  type CreateChoreInput,
} from './choresParentService';
import type { UserWithId } from '../../lib/types';
import type { ChoreWithId } from './choresMemberService';
type ChoreWithIdAlias = ChoreWithId;

const db = {} as import('firebase/firestore').Firestore;
const FIXED_NOW = Date.UTC(2026, 4, 27, 12, 0, 0);

function mkChore(over: Partial<ChoreWithIdAlias> & { id: string }): ChoreWithIdAlias {
  return {
    title: 'Take out the trash',
    assignedTo: 'uid-member-a',
    dueDate: '2026-05-30',
    pointValue: 10,
    dollarValue: 3,
    status: 'pending',
    familyId: 'fam-A',
    createdBy: 'uid-parent-a',
    createdAt: 1000,
    isRecurring: false,
    recurrenceFrequency: 'none',
    ...over,
  };
}

function mkMember(over: Partial<UserWithId> & { id: string }): UserWithId {
  return {
    name: 'Member',
    role: 'member',
    familyId: 'fam-A',
    isActive: true,
    allowanceBalance: 0,
    theme: 'light',
    ...over,
  };
}

beforeEach(() => {
  txnOps = [];
  addShouldReject = false;
  updateShouldReject = false;
  choreDocData = {
    status: 'complete',
    assignedTo: 'uid-member-a',
    dollarValue: 3,
    familyId: 'fam-A',
    title: 'Take out the trash',
  };
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('approveChore — runs ONE transaction with the exact ADR-0004 writes', () => {
  it('runs inside a single runTransaction (atomic — not separate writes)', async () => {
    await approveChore({ db }, 'chore-1');
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('flips the chore status to "approved"', async () => {
    await approveChore({ db }, 'chore-1');
    const choreUpdate = txnOps.find(
      (o) => o.op === 'update' && o.ref.__collection === 'chores',
    );
    expect(choreUpdate, 'an update on the chore doc must occur').toBeDefined();
    expect(choreUpdate!.data.status).toBe('approved');
  });

  it('increments the ASSIGNEE allowanceBalance by EXACTLY dollarValue', async () => {
    await approveChore({ db }, 'chore-1');
    const balUpdate = txnOps.find(
      (o) => o.op === 'update' && o.ref.__collection === 'users',
    );
    expect(balUpdate, 'a balance update on users/{assignedTo} must occur').toBeDefined();
    expect(balUpdate!.ref.__id, 'the balance write targets the assignee uid').toBe('uid-member-a');
    expect(
      balUpdate!.data.allowanceBalance,
      'balance must be a positive increment of the chore dollarValue (3)',
    ).toEqual({ __increment: 3 });
    expect(incrementMock).toHaveBeenCalledWith(3);
  });

  it('writes EXACTLY ONE earning transaction doc with the 7-field shape', async () => {
    await approveChore({ db }, 'chore-1');
    const txnSets = txnOps.filter((o) => o.op === 'set' && o.ref.__collection === 'transactions');
    expect(txnSets, 'exactly one ledger doc is written').toHaveLength(1);
    const data = txnSets[0]!.data;
    expect(data.uid).toBe('uid-member-a');
    expect(data.choreId).toBe('chore-1');
    expect(data.choreTitle).toBe('Take out the trash');
    expect(data.amount).toBe(3);
    expect(data.type).toBe('earning');
    expect(data.familyId).toBe('fam-A');
    expect('createdAt' in data, 'the ledger doc carries createdAt').toBe(true);
    // No extra keys smuggled onto the ledger doc (shape lock).
    expect(Object.keys(data).sort()).toEqual(
      ['amount', 'choreId', 'choreTitle', 'createdAt', 'familyId', 'type', 'uid'].sort(),
    );
  });

  it('does the chore-flip, balance increment, and ledger write ALL within the SAME transaction', async () => {
    await approveChore({ db }, 'chore-1');
    // All three writes were recorded by the in-transaction tx object, not via a
    // separate top-level updateDoc/setDoc/addDoc (which would not be atomic).
    expect(txnOps.filter((o) => o.ref.__collection === 'chores')).toHaveLength(1);
    expect(txnOps.filter((o) => o.ref.__collection === 'users')).toHaveLength(1);
    expect(txnOps.filter((o) => o.ref.__collection === 'transactions')).toHaveLength(1);
    expect(updateDocMock, 'no out-of-transaction updateDoc').not.toHaveBeenCalled();
    expect(addDocMock, 'no out-of-transaction addDoc').not.toHaveBeenCalled();
  });
});

describe('approveChore — idempotency guard: aborts unless the re-read chore is complete (F4)', () => {
  it('ABORTS (rejects) and writes NOTHING when the re-read chore is already approved', async () => {
    choreDocData = { ...choreDocData, status: 'approved' };
    await expect(approveChore({ db }, 'chore-1')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps, 'no writes on a non-complete chore').toHaveLength(0);
  });

  it('ABORTS and writes NOTHING when the re-read chore is still pending', async () => {
    choreDocData = { ...choreDocData, status: 'pending' };
    await expect(approveChore({ db }, 'chore-1')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps).toHaveLength(0);
  });

  it('ABORTS and writes NOTHING when the chore doc does not exist', async () => {
    choreDocData = undefined;
    await expect(approveChore({ db }, 'chore-1')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps).toHaveLength(0);
  });
});

describe('approveChore — error mapping (privacy): raw Firestore text never surfaces', () => {
  it('maps a transaction failure to the generic PII-free message', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('permission-denied: raw firebase, must not surface');
    });
    await expect(approveChore({ db }, 'secret-chore')).rejects.toThrow(CHORE_PARENT_GENERIC_ERROR);
  });

  it('the surfaced error contains no raw provider text and no chore id', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('permission-denied: raw firebase');
    });
    const err = await approveChore({ db }, 'secret-chore-id').then(
      () => new Error('expected approveChore to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(CHORE_PARENT_GENERIC_ERROR);
    expect(err.message).not.toMatch(/permission-denied|firebase/i);
    expect(err.message).not.toContain('secret-chore-id');
  });
});

describe('rejectChore — sets status+reason, NO balance change, NO ledger doc', () => {
  it('updates the chore to status="rejected" with the trimmed reason', async () => {
    await rejectChore({ db }, 'chore-1', '  Half the plates are dirty  ');
    const choreUpdate = txnOps.find((o) => o.ref.__collection === 'chores');
    expect(choreUpdate, 'the chore is updated').toBeDefined();
    expect(choreUpdate!.data.status).toBe('rejected');
    expect(choreUpdate!.data.rejectionReason).toBe('Half the plates are dirty');
  });

  it('writes NO users balance update and NO transactions doc', async () => {
    await rejectChore({ db }, 'chore-1', 'Redo it');
    expect(txnOps.some((o) => o.ref.__collection === 'users')).toBe(false);
    expect(txnOps.some((o) => o.ref.__collection === 'transactions')).toBe(false);
    expect(runTransactionMock, 'reject is not a money transaction').not.toHaveBeenCalled();
  });

  it('REJECTS an empty reason BEFORE any write (validation)', async () => {
    await expect(rejectChore({ db }, 'chore-1', '')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps, 'no write on an empty reason').toHaveLength(0);
  });

  it('REJECTS a whitespace-only reason BEFORE any write', async () => {
    await expect(rejectChore({ db }, 'chore-1', '   \n\t  ')).rejects.toBeInstanceOf(
      ChoreActionError,
    );
    expect(txnOps).toHaveLength(0);
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    updateShouldReject = true;
    await expect(rejectChore({ db }, 'chore-1', 'Redo it')).rejects.toThrow(
      CHORE_PARENT_GENERIC_ERROR,
    );
  });
});

describe('addChore — creates the hardened pending shape with createdBy from the author', () => {
  function input(over: Partial<CreateChoreInput> = {}): CreateChoreInput {
    return {
      title: 'Vacuum the den',
      assignedTo: 'uid-member-a',
      dueDate: '2026-05-30',
      pointValue: 5,
      dollarValue: 2,
      isRecurring: false,
      recurrenceFrequency: 'none',
      familyId: 'fam-A',
      createdBy: 'uid-parent-a',
      ...over,
    };
  }

  it('writes a chore with status="pending" (never pre-approved/complete)', async () => {
    await addChore({ db }, input());
    const created = txnOps.find((o) => o.ref.__collection === 'chores');
    expect(created, 'a chore doc is created').toBeDefined();
    expect(created!.data.status).toBe('pending');
  });

  it('binds createdBy to the author and familyId to the author family', async () => {
    await addChore({ db }, input({ createdBy: 'uid-parent-a', familyId: 'fam-A' }));
    const created = txnOps.find((o) => o.ref.__collection === 'chores')!;
    expect(created.data.createdBy).toBe('uid-parent-a');
    expect(created.data.familyId).toBe('fam-A');
  });

  it('trims the title and writes the EXACT hardened key set (no rejectionReason on create)', async () => {
    await addChore({ db }, input({ title: '  Vacuum the den  ' }));
    const created = txnOps.find((o) => o.ref.__collection === 'chores')!;
    expect(created.data.title).toBe('Vacuum the den');
    // The persisted shape is exactly the create-time chore keys — rejectionReason
    // is ABSENT on a fresh create (it is only ever set by the reject path).
    expect(Object.keys(created.data).sort()).toEqual(
      [
        'assignedTo',
        'createdAt',
        'createdBy',
        'dollarValue',
        'dueDate',
        'familyId',
        'isRecurring',
        'pointValue',
        'recurrenceFrequency',
        'status',
        'title',
      ].sort(),
    );
    expect('rejectionReason' in created.data, 'no rejectionReason on a fresh chore').toBe(false);
  });

  it('carries the numeric reward values and recurrence through unchanged', async () => {
    await addChore({ db }, input({ pointValue: 8, dollarValue: 4, isRecurring: true, recurrenceFrequency: 'weekly' }));
    const created = txnOps.find((o) => o.ref.__collection === 'chores')!;
    expect(created.data.pointValue).toBe(8);
    expect(created.data.dollarValue).toBe(4);
    expect(created.data.isRecurring).toBe(true);
    expect(created.data.recurrenceFrequency).toBe('weekly');
  });

  it('REJECTS an empty/whitespace title BEFORE any write', async () => {
    await expect(addChore({ db }, input({ title: '   ' }))).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps, 'no chore written for an empty title').toHaveLength(0);
  });

  it('maps a Firestore failure to the generic PII-free error', async () => {
    addShouldReject = true;
    await expect(addChore({ db }, input())).rejects.toThrow(CHORE_PARENT_GENERIC_ERROR);
  });
});

describe('toast copy — defined for the toast-everything rule', () => {
  it('approve/reject/add success copy + generic error are non-empty strings', () => {
    for (const s of [
      CHORE_APPROVE_SUCCESS,
      CHORE_REJECT_SUCCESS,
      CHORE_ADD_SUCCESS,
      CHORE_PARENT_GENERIC_ERROR,
    ]) {
      expect(typeof s).toBe('string');
      expect(s.length).toBeGreaterThan(0);
    }
  });

  it('no copy leaks a raw provider token / PII', () => {
    for (const s of [CHORE_APPROVE_SUCCESS, CHORE_REJECT_SUCCESS, CHORE_ADD_SUCCESS, CHORE_PARENT_GENERIC_ERROR]) {
      expect(s).not.toMatch(/permission-denied|firestore|@|uid-/i);
    }
  });
});

describe('pendingApprovalCount — pure selector for the approval-queue badge', () => {
  it('counts ONLY chores with status === "complete"', () => {
    const chores = [
      mkChore({ id: 'p', status: 'pending' }),
      mkChore({ id: 'c1', status: 'complete' }),
      mkChore({ id: 'c2', status: 'complete' }),
      mkChore({ id: 'a', status: 'approved' }),
      mkChore({ id: 'r', status: 'rejected' }),
    ] as ChoreWithId[];
    expect(pendingApprovalCount(chores)).toBe(2);
  });

  it('is 0 for an empty list (no badge)', () => {
    expect(pendingApprovalCount([])).toBe(0);
  });

  it('is 0 when nothing is awaiting approval', () => {
    const chores = [
      mkChore({ id: 'p', status: 'pending' }),
      mkChore({ id: 'a', status: 'approved' }),
    ] as ChoreWithId[];
    expect(pendingApprovalCount(chores)).toBe(0);
  });
});

describe('approvalQueue — pure selector listing the complete chores', () => {
  it('returns ONLY the complete chores', () => {
    const chores = [
      mkChore({ id: 'p', status: 'pending' }),
      mkChore({ id: 'c1', status: 'complete' }),
      mkChore({ id: 'a', status: 'approved' }),
    ] as ChoreWithId[];
    const queue = approvalQueue(chores);
    expect(queue.map((c) => c.id)).toEqual(['c1']);
  });

  it('returns an empty array when none are awaiting approval', () => {
    expect(approvalQueue([mkChore({ id: 'p', status: 'pending' }) as ChoreWithId])).toEqual([]);
  });
});

describe('memberFilterTabs — DYNAMIC tabs from active members (NOT hardcoded names)', () => {
  it('returns an "All" tab FIRST, then one tab per active member (in member order)', () => {
    const members = [
      mkMember({ id: 'uid-maya', name: 'Maya' }),
      mkMember({ id: 'uid-ben', name: 'Ben' }),
    ];
    const tabs = memberFilterTabs(members);
    expect(tabs[0]!.id).toBe(ALL_MEMBERS_TAB_ID);
    expect(tabs.map((t) => t.label)).toEqual(['All', 'Maya', 'Ben']);
    expect(tabs.map((t) => t.id)).toEqual([ALL_MEMBERS_TAB_ID, 'uid-maya', 'uid-ben']);
  });

  it('reflects a DIFFERENT family roster (proves the tabs are derived, not hardcoded Maya/Ben)', () => {
    const members = [mkMember({ id: 'uid-zoe', name: 'Zoe' })];
    const tabs = memberFilterTabs(members);
    expect(tabs.map((t) => t.label)).toEqual(['All', 'Zoe']);
    expect(tabs.some((t) => /maya|ben/i.test(t.label)), 'no hardcoded names').toBe(false);
  });

  it('returns just the "All" tab when there are no members', () => {
    const tabs = memberFilterTabs([]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]!.id).toBe(ALL_MEMBERS_TAB_ID);
  });
});

describe('choresForTab — pure filter by selected tab', () => {
  const chores = [
    mkChore({ id: 'a1', assignedTo: 'uid-maya' }),
    mkChore({ id: 'a2', assignedTo: 'uid-ben' }),
    mkChore({ id: 'a3', assignedTo: 'uid-maya' }),
  ] as ChoreWithId[];

  it('the "All" tab returns every chore', () => {
    expect(choresForTab(chores, ALL_MEMBERS_TAB_ID).map((c) => c.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('a member tab returns only that member’s chores', () => {
    expect(choresForTab(chores, 'uid-maya').map((c) => c.id)).toEqual(['a1', 'a3']);
  });

  it('a tab for a member with no chores returns an empty array', () => {
    expect(choresForTab(chores, 'uid-nobody')).toEqual([]);
  });
});

describe('canManageChores — pure role derivation (cosmetic; rules are authority)', () => {
  it('a parent CAN manage chores', () => {
    expect(canManageChores({ role: 'parent' })).toBe(true);
  });

  it('a member CANNOT manage chores', () => {
    expect(canManageChores({ role: 'member' })).toBe(false);
  });
});

// =====================================================================
// MONEY → INTEGER CENTS (second-opinion #4 / Finding 7): the single money
// formatter turns whole cents into "$X.XX". Precise, exact-string matchers —
// never a loose digit that a points/date value could satisfy (learned bug).
// =====================================================================
describe('formatMoney — integer CENTS to "$X.XX" display', () => {
  it('formats 300 cents as exactly "$3.00"', () => {
    expect(formatMoney(300)).toBe('$3.00');
  });

  it('formats 3850 cents as exactly "$38.50"', () => {
    expect(formatMoney(3850)).toBe('$38.50');
  });

  it('formats 0 cents as exactly "$0.00"', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });

  it('formats 5 cents as exactly "$0.05" (sub-dollar cents, not "$5.00")', () => {
    expect(formatMoney(5)).toBe('$0.05');
  });

  it('formats 100 cents as exactly "$1.00" (distinct from a points value of 1)', () => {
    expect(formatMoney(100)).toBe('$1.00');
  });

  it('formats the MAX (100000000 cents) as exactly "$1,000,000.00"', () => {
    expect(formatMoney(MONEY_MAX_CENTS)).toBe('$1,000,000.00');
  });
});

describe('isValidMoneyCents — guards the money display (Finding 8)', () => {
  it('accepts a valid integer-cents amount (300)', () => {
    expect(isValidMoneyCents(300)).toBe(true);
  });

  it('accepts 0 cents', () => {
    expect(isValidMoneyCents(0)).toBe(true);
  });

  it('accepts the max ($1,000,000 in cents)', () => {
    expect(isValidMoneyCents(MONEY_MAX_CENTS)).toBe(true);
  });

  it('rejects NaN', () => {
    expect(isValidMoneyCents(Number.NaN)).toBe(false);
  });

  it('rejects Infinity', () => {
    expect(isValidMoneyCents(Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(isValidMoneyCents(-1)).toBe(false);
  });

  it('rejects a fractional amount (350.5 — not whole cents)', () => {
    expect(isValidMoneyCents(350.5)).toBe(false);
  });

  it('rejects an over-max amount (MONEY_MAX_CENTS + 1)', () => {
    expect(isValidMoneyCents(MONEY_MAX_CENTS + 1)).toBe(false);
  });
});

describe('money constants', () => {
  it('MONEY_MAX_CENTS is $1,000,000 in cents (100000000)', () => {
    expect(MONEY_MAX_CENTS).toBe(100000000);
  });

  it('MONEY_INVALID_INDICATOR is a non-empty, non-money string (distinct from "$0.00")', () => {
    expect(typeof MONEY_INVALID_INDICATOR).toBe('string');
    expect(MONEY_INVALID_INDICATOR.length).toBeGreaterThan(0);
    expect(MONEY_INVALID_INDICATOR).not.toMatch(/\$/);
  });
});
