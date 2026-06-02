/**
 * Savings Goals service — Feature 1 (savings goals & jars).
 *
 * Each goal is a doc under `savingsGoals/{goalId}` scoped to a family. The
 * subject (`ownerUid`) is the member whose goal it is. Members can manage
 * their OWN active goal (create / edit title-target-targetDate / contribute);
 * parents can contribute to any family goal AND archive / complete any
 * family goal. firestore.rules is the real authority boundary — the
 * client-side checks here mirror it for cleaner error toasts (no raw
 * Firebase codes, no PII).
 *
 * Money everywhere is INTEGER CENTS (ADR-0004 / `MONEY_MAX_CENTS`). The
 * service validates `>= 0` and `<= MONEY_MAX_CENTS` before touching
 * Firestore so a bad client surface never round-trips.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  updateDoc,
  type Firestore,
} from 'firebase/firestore';
import { savingsGoalConverter } from '../../lib/converters';
import { MONEY_MAX_CENTS, type SavingsGoal, type SavingsGoalStatus } from '../../lib/types';

const SAVINGS_GOALS_COLLECTION = 'savingsGoals';

export const SAVINGS_GOAL_TITLE_MAX = 80;

export const SAVINGS_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const SAVINGS_TITLE_EMPTY = 'Please enter a title for your goal.';
export const SAVINGS_TITLE_TOO_LONG = `Keep the title under ${SAVINGS_GOAL_TITLE_MAX} characters.`;
export const SAVINGS_TARGET_INVALID = 'Please enter a target amount greater than zero.';
export const SAVINGS_AMOUNT_INVALID = 'Please enter a positive amount.';
export const SAVINGS_TERMINAL = "This goal isn't open for changes anymore.";

export class SavingsGoalActionError extends Error {
  constructor(message: string = SAVINGS_GENERIC_ERROR) {
    super(message);
    this.name = 'SavingsGoalActionError';
  }
}

export interface SavingsGoalWithId extends SavingsGoal {
  id: string;
}

function isFiniteIntCents(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

function clampedCentsOrThrow(n: number, errorMessage: string): number {
  if (!isFiniteIntCents(n)) {
    throw new SavingsGoalActionError(errorMessage);
  }
  if (n > MONEY_MAX_CENTS) {
    throw new SavingsGoalActionError(errorMessage);
  }
  return n;
}

export interface CreateSavingsGoalInput {
  title: string;
  targetAmount: number;
  /** Optional ISO YYYY-MM-DD. Empty / omitted = no target date. */
  targetDate?: string;
  ownerUid: string;
  familyId: string;
}

/**
 * Member-driven: create a new active goal owned by `ownerUid`. The screen
 * passes `ownerUid = currentUser.id` for a member; a parent creating on
 * behalf of a kid would pass that kid's uid (rules permit when caller is
 * a same-family parent — see firestore.rules).
 */
export async function createSavingsGoal(
  deps: { db: Firestore },
  input: CreateSavingsGoalInput,
): Promise<string> {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new SavingsGoalActionError(SAVINGS_TITLE_EMPTY);
  }
  if (title.length > SAVINGS_GOAL_TITLE_MAX) {
    throw new SavingsGoalActionError(SAVINGS_TITLE_TOO_LONG);
  }
  if (!isFiniteIntCents(input.targetAmount) || input.targetAmount <= 0) {
    throw new SavingsGoalActionError(SAVINGS_TARGET_INVALID);
  }
  clampedCentsOrThrow(input.targetAmount, SAVINGS_TARGET_INVALID);

  const now = Date.now();
  const payload: SavingsGoal = {
    familyId: input.familyId,
    ownerUid: input.ownerUid,
    title,
    targetAmount: input.targetAmount,
    currentAmount: 0,
    createdAt: now,
    updatedAt: now,
    status: 'active',
    // exactOptionalPropertyTypes: include the key ONLY when a value exists,
    // never write `targetDate: undefined` (which is invalid Firestore input).
    ...(input.targetDate !== undefined && input.targetDate !== ''
      ? { targetDate: input.targetDate }
      : {}),
  };

  try {
    const ref = await addDoc(
      collection(deps.db, SAVINGS_GOALS_COLLECTION).withConverter(savingsGoalConverter),
      payload,
    );
    return ref.id;
  } catch {
    throw new SavingsGoalActionError();
  }
}

export interface UpdateSavingsGoalInput {
  title?: string;
  targetAmount?: number;
  targetDate?: string | null;
}

/**
 * Edit a goal's metadata (title / target / target date). Members can only
 * edit their OWN active goals; rules enforce. Setting `targetDate: null`
 * clears the optional field.
 */
export async function updateSavingsGoal(
  deps: { db: Firestore },
  goalId: string,
  input: UpdateSavingsGoalInput,
): Promise<void> {
  // `Record<string, unknown>` is rejected by updateDoc's strict overloads
  // (it expects `Record<string, FieldValue | Partial<unknown> | undefined>`);
  // use the `any`-keyed shape via a cast at the boundary. The values are
  // either numbers, strings, or null — all valid Firestore primitives.
  const patch: { [k: string]: unknown } = { updatedAt: Date.now() };
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length === 0) throw new SavingsGoalActionError(SAVINGS_TITLE_EMPTY);
    if (title.length > SAVINGS_GOAL_TITLE_MAX)
      throw new SavingsGoalActionError(SAVINGS_TITLE_TOO_LONG);
    patch.title = title;
  }
  if (input.targetAmount !== undefined) {
    if (!isFiniteIntCents(input.targetAmount) || input.targetAmount <= 0) {
      throw new SavingsGoalActionError(SAVINGS_TARGET_INVALID);
    }
    clampedCentsOrThrow(input.targetAmount, SAVINGS_TARGET_INVALID);
    patch.targetAmount = input.targetAmount;
  }
  if (input.targetDate === null) {
    // The screen offers "clear target date". Firestore's REST/SDK accept
    // null to "clear" a field on update (the converter treats it as
    // present-but-null, distinguishable from a missing key on read).
    patch.targetDate = null;
  } else if (typeof input.targetDate === 'string' && input.targetDate !== '') {
    patch.targetDate = input.targetDate;
  }
  try {
    // The strict overloads on `updateDoc` reject our heterogeneous
    // `{ [k]: number | string | null }` patch; cast via `unknown` keeps
    // the runtime payload identical while satisfying the type-check.
    await updateDoc(
      doc(deps.db, SAVINGS_GOALS_COLLECTION, goalId),
      patch as unknown as { [k: string]: string | number | null },
    );
  } catch {
    throw new SavingsGoalActionError();
  }
}

/**
 * Add cents to a goal's `currentAmount`. Member can contribute to own
 * goals; parent can contribute to any family goal (rules enforce). Caps
 * at the goal's `targetAmount` — over-contribution rounds down, no
 * over-saved surplus. Reads the current doc first to compute the new
 * amount; not transactional, so a concurrent contribution may underfill
 * — acceptable for a v1 (low-velocity write surface).
 */
export async function contributeToSavingsGoal(
  deps: { db: Firestore },
  goalId: string,
  centsToAdd: number,
): Promise<void> {
  if (!isFiniteIntCents(centsToAdd) || centsToAdd <= 0) {
    throw new SavingsGoalActionError(SAVINGS_AMOUNT_INVALID);
  }
  clampedCentsOrThrow(centsToAdd, SAVINGS_AMOUNT_INVALID);
  try {
    const ref = doc(deps.db, SAVINGS_GOALS_COLLECTION, goalId).withConverter(savingsGoalConverter);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      throw new SavingsGoalActionError();
    }
    const data = snap.data();
    if (data.status !== 'active') {
      throw new SavingsGoalActionError(SAVINGS_TERMINAL);
    }
    const next = Math.min(data.currentAmount + centsToAdd, data.targetAmount);
    await updateDoc(doc(deps.db, SAVINGS_GOALS_COLLECTION, goalId), {
      currentAmount: next,
      updatedAt: Date.now(),
    });
  } catch (err) {
    if (err instanceof SavingsGoalActionError) throw err;
    throw new SavingsGoalActionError();
  }
}

/**
 * Parent-driven terminal-state transition. `archive` and `complete` are
 * both irreversible (the doc lingers as a record but isn't editable).
 */
export async function setSavingsGoalStatus(
  deps: { db: Firestore },
  goalId: string,
  status: Exclude<SavingsGoalStatus, 'active'>,
): Promise<void> {
  try {
    await updateDoc(doc(deps.db, SAVINGS_GOALS_COLLECTION, goalId), {
      status,
      updatedAt: Date.now(),
    });
  } catch {
    throw new SavingsGoalActionError();
  }
}

/**
 * Hard-delete (admin / cleanup). Parents only via rules. Used by the
 * "Permanently remove" affordance on archived goals.
 */
export async function deleteSavingsGoal(deps: { db: Firestore }, goalId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, SAVINGS_GOALS_COLLECTION, goalId));
  } catch {
    throw new SavingsGoalActionError();
  }
}

/**
 * Pure helper: percent completion (clamped 0..100). Renders the progress
 * bar fill width; also screen-reader-spoken on the goal row.
 */
export function savingsGoalProgressPercent(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target) || target <= 0) return 0;
  const raw = (current / target) * 100;
  if (raw < 0) return 0;
  if (raw > 100) return 100;
  return Math.round(raw);
}
