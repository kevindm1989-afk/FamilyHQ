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

// --- PR C: firebase/functions httpsCallable mock --------------------------
//
// approveChore is augmented to fire-and-forget the `notifyChoreApproved`
// callable AFTER runTransaction resolves. The mock returns a stub callable
// the test can drive (resolve OR reject) so we can pin:
//   - the callable is invoked at MOST ONCE per approveChore call
//   - it is invoked AFTER the transaction's tx.update/tx.set ops land
//   - a callable rejection does NOT bubble up to the caller
//   - the only payload field is `{ choreId }` (no kid uid, no amount, etc.)
//
// `httpsCallable(functions, 'notifyChoreApproved')` returns the function the
// implementer invokes — we capture both the registration AND every call.
interface CallableCall {
  // The order in which this callable fired RELATIVE to the txn ops. We push
  // a synthetic 'callable' entry to txnOps so the order assertions below can
  // distinguish "callable fired AFTER all txn ops" from any other ordering.
  payload: Record<string, unknown>;
}
let httpsCallableCalls: CallableCall[];
let callableShouldReject: boolean;
let callableRejection: unknown;

const callableFnMock = vi.fn(async (data: Record<string, unknown>) => {
  httpsCallableCalls.push({ payload: data });
  // Push a marker so the chronological order vs txnOps can be asserted.
  txnOps.push({
    op: 'set',
    ref: { __collection: '__callable__', __id: 'notifyChoreApproved' },
    data,
  });
  if (callableShouldReject) {
    // Reject with whatever the test configured (default: a plain Error).
    throw callableRejection ?? new Error('emulated callable failure');
  }
  return { data: { sent: 1, failed: 0 } };
});

const httpsCallableMock = vi.fn((_functions: unknown, name: string) => {
  // The implementer's call is `httpsCallable(functions, 'notifyChoreApproved')`.
  // Return our stub regardless of name so a typo in the name shows up
  // in the assertion below rather than a missing-mock error.
  if (name !== 'notifyChoreApproved') {
    // Surface a deterministic failure — the implementer must spell the
    // callable name correctly.
    return async () => {
      throw new Error(`unexpected httpsCallable name: ${name}`);
    };
  }
  return callableFnMock;
});

// getFunctions / Functions are optional surfaces the implementer might use
// to instantiate a per-region functions handle. We stub them to no-ops so
// the import resolves.
const getFunctionsMock = vi.fn((..._args: unknown[]) => ({ __functions: true }));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...a: [unknown, string]) => httpsCallableMock(...a),
  getFunctions: (...a: unknown[]) => getFunctionsMock(...a),
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
  httpsCallableCalls = [];
  callableShouldReject = false;
  callableRejection = undefined;
  choreDocData = {
    status: 'complete',
    assignedTo: 'uid-member-a',
    dollarValue: 3,
    pointValue: 10,
    familyId: 'fam-A',
    title: 'Take out the trash',
    dueDate: '2026-05-30',
    isRecurring: false,
    recurrenceFrequency: 'none',
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
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    expect(runTransactionMock).toHaveBeenCalledTimes(1);
  });

  it('flips the chore status to "approved"', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const choreUpdate = txnOps.find(
      (o) => o.op === 'update' && o.ref.__collection === 'chores',
    );
    expect(choreUpdate, 'an update on the chore doc must occur').toBeDefined();
    expect(choreUpdate!.data.status).toBe('approved');
  });

  it('increments the ASSIGNEE allowanceBalance by EXACTLY dollarValue', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
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
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const txnSets = txnOps.filter((o) => o.op === 'set' && o.ref.__collection === 'transactions');
    expect(txnSets, 'exactly one ledger doc is written').toHaveLength(1);
    const data = txnSets[0]!.data;
    expect(data.uid).toBe('uid-member-a');
    expect(data.sourceId).toBe('chore-1');
    expect(data.sourceLabel).toBe('Take out the trash');
    expect(data.amount).toBe(3);
    expect(data.type).toBe('earning');
    expect(data.familyId).toBe('fam-A');
    expect('createdAt' in data, 'the ledger doc carries createdAt').toBe(true);
    // No extra keys smuggled onto the ledger doc (shape lock).
    expect(Object.keys(data).sort()).toEqual(
      ['amount', 'createdAt', 'familyId', 'sourceId', 'sourceLabel', 'type', 'uid'].sort(),
    );
  });

  it('does the chore-flip, balance increment, and ledger write ALL within the SAME transaction', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
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
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps, 'no writes on a non-complete chore').toHaveLength(0);
  });

  it('ABORTS and writes NOTHING when the re-read chore is still pending', async () => {
    choreDocData = { ...choreDocData, status: 'pending' };
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps).toHaveLength(0);
  });

  it('ABORTS and writes NOTHING when the chore doc does not exist', async () => {
    choreDocData = undefined;
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).rejects.toBeInstanceOf(ChoreActionError);
    expect(txnOps).toHaveLength(0);
  });
});

describe('approveChore — error mapping (privacy): raw Firestore text never surfaces', () => {
  it('maps a transaction failure to the generic PII-free message', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('permission-denied: raw firebase, must not surface');
    });
    await expect(approveChore({ db }, 'secret-chore', 'uid-parent-a')).rejects.toThrow(CHORE_PARENT_GENERIC_ERROR);
  });

  it('the surfaced error contains no raw provider text and no chore id', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('permission-denied: raw firebase');
    });
    const err = await approveChore({ db }, 'secret-chore-id', 'uid-parent-a').then(
      () => new Error('expected approveChore to reject'),
      (e: unknown) => e as Error,
    );
    expect(err.message).toBe(CHORE_PARENT_GENERIC_ERROR);
    expect(err.message).not.toMatch(/permission-denied|firebase/i);
    expect(err.message).not.toContain('secret-chore-id');
  });
});

describe('approveChore — recurring respawn (Feature follow-up)', () => {
  it('does NOT create a next instance when the chore is non-recurring (status flip + balance + ledger only)', async () => {
    // Default fixture has isRecurring=false / recurrenceFrequency='none'.
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    // Filter out the PR C callable-invocation marker (the mock pushes a
    // synthetic `__callable__` set into txnOps for ordering tests). The
    // real Firestore writes we care about live under transactions/users/
    // chores collections only.
    const setOps = txnOps.filter(
      (o) => o.op === 'set' && o.ref.__collection !== '__callable__',
    );
    // Only the ledger doc — no second chore set.
    expect(setOps).toHaveLength(1);
    expect(setOps[0]!.ref.__collection).toBe('transactions');
  });

  it('creates a fresh PENDING chore advanced by 7 days for a WEEKLY recurring chore', async () => {
    choreDocData = {
      ...choreDocData,
      isRecurring: true,
      recurrenceFrequency: 'weekly',
      dueDate: '2026-05-30',
    };
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const newChore = txnOps.find(
      (o) => o.op === 'set' && o.ref.__collection === 'chores',
    );
    expect(newChore, 'a weekly recurring approve must spawn a next-instance chore').toBeDefined();
    const payload = newChore!.data as Record<string, unknown>;
    expect(payload.status).toBe('pending');
    expect(payload.dueDate).toBe('2026-06-06'); // +7 days
    expect(payload.title).toBe('Take out the trash');
    expect(payload.assignedTo).toBe('uid-member-a');
    expect(payload.dollarValue).toBe(3);
    expect(payload.pointValue).toBe(10);
    expect(payload.familyId).toBe('fam-A');
    expect(payload.isRecurring).toBe(true);
    expect(payload.recurrenceFrequency).toBe('weekly');
  });

  it('advances the dueDate by 14 days for a BIWEEKLY recurring chore', async () => {
    choreDocData = {
      ...choreDocData,
      isRecurring: true,
      recurrenceFrequency: 'biweekly',
      dueDate: '2026-05-30',
    };
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const newChore = txnOps.find(
      (o) => o.op === 'set' && o.ref.__collection === 'chores',
    );
    expect((newChore!.data as Record<string, unknown>).dueDate).toBe('2026-06-13');
  });

  it('sets `createdBy` on the new chore to the APPROVING parent uid (rule require)', async () => {
    choreDocData = {
      ...choreDocData,
      isRecurring: true,
      recurrenceFrequency: 'weekly',
    };
    // Use a DIFFERENT parent than the original creator to prove the new
    // chore's createdBy follows the APPROVER, not the original chore's
    // creator (the rule's check is on request.auth.uid).
    await approveChore({ db }, 'chore-1', 'uid-parent-different');
    const newChore = txnOps.find(
      (o) => o.op === 'set' && o.ref.__collection === 'chores',
    );
    expect((newChore!.data as Record<string, unknown>).createdBy).toBe('uid-parent-different');
  });

  it('rolls the dueDate across a month boundary correctly (2026-06-28 + 7 days = 2026-07-05)', async () => {
    choreDocData = {
      ...choreDocData,
      isRecurring: true,
      recurrenceFrequency: 'weekly',
      dueDate: '2026-06-28',
    };
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const newChore = txnOps.find(
      (o) => o.op === 'set' && o.ref.__collection === 'chores',
    );
    expect((newChore!.data as Record<string, unknown>).dueDate).toBe('2026-07-05');
  });

  it('does NOT respawn when isRecurring is true but recurrenceFrequency is "none" (defensive — schema drift)', async () => {
    choreDocData = {
      ...choreDocData,
      isRecurring: true,
      recurrenceFrequency: 'none',
    };
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const newChore = txnOps.find(
      (o) => o.op === 'set' && o.ref.__collection === 'chores',
    );
    expect(newChore, 'a "none" frequency must not respawn even with isRecurring=true').toBeUndefined();
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

// =====================================================================
// PR C — approveChore client wiring to notifyChoreApproved callable
// (threat-model §A.10 C-T20 + brief C2).
//
// AFTER the existing runTransaction resolves, approveChore fires the
// notify-callable fire-and-forget. The callable's failure does NOT undo
// the approve — the tx side effects (balance, ledger, status) MUST
// already have landed before the callable is ever invoked.
//
// These tests FAIL today: approveChore does not invoke httpsCallable.
// The implementer wires it in PR C2.
// =====================================================================

describe('approveChore — PR C: invokes notifyChoreApproved callable AFTER tx resolves', () => {
  it('calls httpsCallable with the EXACT name "notifyChoreApproved"', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    // At least one httpsCallable() lookup must have happened with the
    // canonical name. The mock returns a stub function for that name only;
    // a typo would surface in the next assertion below.
    expect(httpsCallableMock).toHaveBeenCalled();
    const namesUsed = httpsCallableMock.mock.calls.map((c) => c[1]);
    expect(namesUsed).toContain('notifyChoreApproved');
  });

  it('invokes the callable EXACTLY ONCE per approveChore call', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    expect(httpsCallableCalls).toHaveLength(1);
  });

  it('passes ONLY { choreId } to the callable — NEVER the kid uid, amount, or any chore PI', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    const { payload } = httpsCallableCalls[0]!;
    expect(payload).toEqual({ choreId: 'chore-1' });
    // Defense in depth — pin that none of these PI fields leaked in:
    expect(payload).not.toHaveProperty('assignedTo');
    expect(payload).not.toHaveProperty('dollarValue');
    expect(payload).not.toHaveProperty('amount');
    expect(payload).not.toHaveProperty('title');
    expect(payload).not.toHaveProperty('familyId');
    expect(payload).not.toHaveProperty('recipientUid');
    expect(payload).not.toHaveProperty('uid');
  });

  it('invokes the callable AFTER all transaction ops have landed (order assertion)', async () => {
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    // The mock pushes a `__callable__` marker into txnOps the moment the
    // callable is invoked. Its index must be STRICTLY GREATER than every
    // real-tx-op index (chore status flip, balance increment, ledger doc).
    const callableIdx = txnOps.findIndex((o) => o.ref.__collection === '__callable__');
    const txOpIdxs = txnOps
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => o.ref.__collection !== '__callable__')
      .map(({ i }) => i);
    expect(callableIdx, 'a callable invocation marker must be present').toBeGreaterThanOrEqual(0);
    for (const i of txOpIdxs) {
      expect(
        callableIdx,
        'the callable MUST fire AFTER every tx op (fire-and-forget post-tx)',
      ).toBeGreaterThan(i);
    }
  });

  it('does NOT invoke the callable when the transaction aborts (chore not complete)', async () => {
    choreDocData = { ...choreDocData, status: 'approved' };
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).rejects.toBeInstanceOf(
      ChoreActionError,
    );
    expect(httpsCallableCalls, 'no callable on aborted approve').toHaveLength(0);
  });

  it('does NOT invoke the callable when the transaction itself throws (mapped to generic error)', async () => {
    runTransactionMock.mockImplementationOnce(async () => {
      throw new Error('emulated-firestore-failure');
    });
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).rejects.toThrow(
      CHORE_PARENT_GENERIC_ERROR,
    );
    expect(httpsCallableCalls).toHaveLength(0);
  });
});

describe('approveChore — PR C: callable failure is silent (in-app inbox is source of truth, ADR-0014)', () => {
  it('does NOT throw to the caller when the callable rejects', async () => {
    callableShouldReject = true;
    callableRejection = new Error('FCM is unavailable');
    // Must resolve — the approve has already landed; the push is non-essential.
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).resolves.toBeUndefined();
  });

  it('the chore-flip, balance increment, and ledger doc ALL land even when the callable rejects', async () => {
    callableShouldReject = true;
    callableRejection = new Error('FCM throws');
    await approveChore({ db }, 'chore-1', 'uid-parent-a');
    // Filter out the synthetic '__callable__' marker.
    const realOps = txnOps.filter((o) => o.ref.__collection !== '__callable__');
    const choreFlip = realOps.find(
      (o) => o.op === 'update' && o.ref.__collection === 'chores',
    );
    const balUpdate = realOps.find(
      (o) => o.op === 'update' && o.ref.__collection === 'users',
    );
    const ledger = realOps.find((o) => o.op === 'set' && o.ref.__collection === 'transactions');
    expect(choreFlip, 'chore status flip must persist regardless of callable outcome').toBeDefined();
    expect(choreFlip!.data.status).toBe('approved');
    expect(balUpdate, 'balance increment must persist regardless of callable outcome').toBeDefined();
    expect(balUpdate!.data.allowanceBalance).toEqual({ __increment: 3 });
    expect(ledger, 'ledger doc must persist regardless of callable outcome').toBeDefined();
  });

  it('a SYNCHRONOUS throw from httpsCallable (not an async rejection) is also swallowed', async () => {
    // Cover the second failure mode: getFunctions() / httpsCallable() throws
    // at lookup time, before the callable is even invoked. The approve must
    // still resolve.
    httpsCallableMock.mockImplementationOnce(() => {
      throw new Error('sync init failure (e.g. functions not initialized)');
    });
    await expect(approveChore({ db }, 'chore-1', 'uid-parent-a')).resolves.toBeUndefined();
    // The chore flip + balance + ledger still happened.
    const realOps = txnOps.filter((o) => o.ref.__collection !== '__callable__');
    expect(realOps.filter((o) => o.ref.__collection === 'chores')).toHaveLength(1);
    expect(realOps.filter((o) => o.ref.__collection === 'users')).toHaveLength(1);
    expect(realOps.filter((o) => o.ref.__collection === 'transactions')).toHaveLength(1);
  });

  it('the rejected callable does NOT surface the raw provider error to the caller (M39)', async () => {
    callableShouldReject = true;
    callableRejection = Object.assign(new Error('messaging/internal-error RAW'), {
      code: 'functions/internal',
    });
    // No throw expected. If a future regression DID throw, ensure the
    // surfaced message would still be generic, not the raw text.
    await approveChore({ db }, 'chore-1', 'uid-parent-a').catch((e: Error) => {
      expect(e.message).not.toMatch(/messaging\/internal-error/);
      expect(e.message).not.toMatch(/RAW/);
    });
  });
});
