/**
 * Wishlist service — Allowance debit + wishlist redemption feature.
 *
 * Owner-side surface: CRUD a wishlist item, request a redemption.
 * Parent-side surface: approve (atomic debit + ledger) or deny a request.
 *
 * The approval path is SECURITY-CRITICAL — it mirrors choresParentService
 * `approveChore`'s `runTransaction` shape:
 *   - Re-read the wishlist item + the owner's `users/{uid}` doc.
 *   - Abort if status != 'requested' (replay guard), if the owner's
 *     balance is insufficient, or if the costCents is malformed.
 *   - In ONE transaction: flip status to 'redeemed', decrement
 *     `allowanceBalance` by `costCents`, append a `transactions/{id}`
 *     row with `type: 'spending'`. Three writes, one atomic boundary.
 *   - User-safe error mapping (never echo a raw Firestore code / PII).
 *
 * Authorization is enforced by firestore.rules (see
 * `test/rules/wishlistItems.test.ts`). UI affordances mirror the rule
 * shape but the rule layer is the safety net.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  type Firestore,
  type Transaction as FirestoreTx,
} from 'firebase/firestore';
import { wishlistItemConverter } from '../../lib/converters';
import { MONEY_MAX_CENTS, type WishlistItem, type WishlistStatus } from '../../lib/types';

const COLLECTION = 'wishlistItems';
const USERS_COLLECTION = 'users';
const TRANSACTIONS_COLLECTION = 'transactions';

export const WISHLIST_TITLE_MAX = 120;
export const WISHLIST_DENIED_REASON_MAX = 200;

export const WISHLIST_GENERIC_ERROR = 'Something went wrong. Please try again.';
export const WISHLIST_TITLE_EMPTY = 'Please give the item a name.';
export const WISHLIST_TITLE_TOO_LONG = `Keep the name under ${WISHLIST_TITLE_MAX} characters.`;
export const WISHLIST_COST_INVALID = 'Please enter a positive amount.';
export const WISHLIST_INSUFFICIENT_FUNDS = 'Not enough allowance saved yet.';
export const WISHLIST_NOT_REQUESTED = "That redemption isn't waiting for approval anymore.";
export const WISHLIST_DENIED_REASON_EMPTY = 'Please leave a short reason for the kid.';

export class WishlistActionError extends Error {
  constructor(message: string = WISHLIST_GENERIC_ERROR) {
    super(message);
    this.name = 'WishlistActionError';
  }
}

export interface WishlistItemWithId extends WishlistItem {
  id: string;
}

function isValidMoneyCents(n: unknown): n is number {
  return (
    typeof n === 'number' &&
    Number.isFinite(n) &&
    Number.isInteger(n) &&
    n >= 0 &&
    n <= MONEY_MAX_CENTS
  );
}

export interface CreateWishlistItemInput {
  familyId: string;
  ownerUid: string;
  title: string;
  costCents: number;
  savingsGoalId?: string;
}

export async function createWishlistItem(
  deps: { db: Firestore },
  input: CreateWishlistItemInput,
): Promise<string> {
  const title = input.title.trim();
  if (title.length === 0) throw new WishlistActionError(WISHLIST_TITLE_EMPTY);
  if (title.length > WISHLIST_TITLE_MAX) throw new WishlistActionError(WISHLIST_TITLE_TOO_LONG);
  if (!isValidMoneyCents(input.costCents) || input.costCents <= 0) {
    throw new WishlistActionError(WISHLIST_COST_INVALID);
  }

  const body = {
    familyId: input.familyId,
    ownerUid: input.ownerUid,
    title,
    costCents: input.costCents,
    status: 'wishing' as WishlistStatus,
    createdAt: Date.now(),
    ...(input.savingsGoalId !== undefined && input.savingsGoalId !== ''
      ? { savingsGoalId: input.savingsGoalId }
      : {}),
  };
  try {
    const ref = await addDoc(
      collection(deps.db, COLLECTION).withConverter(wishlistItemConverter),
      body as unknown as WishlistItem,
    );
    return ref.id;
  } catch {
    throw new WishlistActionError();
  }
}

export interface UpdateWishlistItemInput {
  title?: string;
  costCents?: number;
  savingsGoalId?: string | null;
}

/**
 * Owner-only edit of a 'wishing' item. The rule layer denies edits to
 * items in other statuses, but the service still validates input bounds
 * for cleaner error toasts.
 */
export async function updateWishlistItem(
  deps: { db: Firestore },
  itemId: string,
  input: UpdateWishlistItemInput,
): Promise<void> {
  const patch: { [k: string]: unknown } = {};
  if (input.title !== undefined) {
    const title = input.title.trim();
    if (title.length === 0) throw new WishlistActionError(WISHLIST_TITLE_EMPTY);
    if (title.length > WISHLIST_TITLE_MAX) throw new WishlistActionError(WISHLIST_TITLE_TOO_LONG);
    patch.title = title;
  }
  if (input.costCents !== undefined) {
    if (!isValidMoneyCents(input.costCents) || input.costCents <= 0) {
      throw new WishlistActionError(WISHLIST_COST_INVALID);
    }
    patch.costCents = input.costCents;
  }
  if (input.savingsGoalId === null || input.savingsGoalId === '') {
    patch.savingsGoalId = deleteField();
  } else if (typeof input.savingsGoalId === 'string') {
    patch.savingsGoalId = input.savingsGoalId;
  }
  if (Object.keys(patch).length === 0) return;
  try {
    await updateDoc(
      doc(deps.db, COLLECTION, itemId),
      patch as unknown as { [k: string]: string | number },
    );
  } catch {
    throw new WishlistActionError();
  }
}

export async function deleteWishlistItem(deps: { db: Firestore }, itemId: string): Promise<void> {
  try {
    await deleteDoc(doc(deps.db, COLLECTION, itemId));
  } catch {
    throw new WishlistActionError();
  }
}

/** Owner flips status: wishing → requested (kicks off the parent's approval queue). */
export async function requestRedemption(deps: { db: Firestore }, itemId: string): Promise<void> {
  try {
    await updateDoc(doc(deps.db, COLLECTION, itemId), {
      status: 'requested',
      requestedAt: Date.now(),
      deniedReason: deleteField(),
    } as unknown as { [k: string]: string | number });
  } catch {
    throw new WishlistActionError();
  }
}

/** Owner cancels their own request: requested → wishing. */
export async function cancelRedemption(deps: { db: Firestore }, itemId: string): Promise<void> {
  try {
    await updateDoc(doc(deps.db, COLLECTION, itemId), {
      status: 'wishing',
    });
  } catch {
    throw new WishlistActionError();
  }
}

/** Parent denies a request: requested → denied, with a reason. */
export async function denyRedemption(
  deps: { db: Firestore },
  itemId: string,
  reason: string,
): Promise<void> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new WishlistActionError(WISHLIST_DENIED_REASON_EMPTY);
  }
  try {
    await updateDoc(doc(deps.db, COLLECTION, itemId), {
      status: 'denied',
      deniedReason: trimmed.slice(0, WISHLIST_DENIED_REASON_MAX),
      resolvedAt: Date.now(),
    });
  } catch {
    throw new WishlistActionError();
  }
}

/**
 * Parent approves a redemption — SECURITY-CRITICAL atomic transaction.
 *
 * Reads:
 *  - wishlistItems/{itemId}  → must be status='requested'
 *  - users/{ownerUid}         → balance must be >= costCents
 *
 * Writes (one transaction):
 *  - wishlistItems/{itemId}.status = 'redeemed', resolvedAt = now
 *  - users/{ownerUid}.allowanceBalance -= costCents
 *  - transactions/{auto} — { uid: ownerUid, choreId: itemId,
 *      choreTitle: title, amount: costCents, type: 'spending',
 *      familyId, createdAt: serverTimestamp() }
 *    (choreId/choreTitle reused as generic source identity + label
 *    per Transaction type — see types.ts; rename to sourceId/sourceLabel
 *    is a follow-up.)
 *
 * Status-guard makes this idempotent: a repeated call after the first
 * approval sees status='redeemed' and aborts before any write.
 */
export async function approveRedemption(deps: { db: Firestore }, itemId: string): Promise<void> {
  try {
    await runTransaction(deps.db, async (tx: FirestoreTx) => {
      const itemRef = doc(deps.db, COLLECTION, itemId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists()) {
        throw new WishlistActionError(WISHLIST_NOT_REQUESTED);
      }
      const item = itemSnap.data() as WishlistItem;
      if (item.status !== 'requested') {
        throw new WishlistActionError(WISHLIST_NOT_REQUESTED);
      }
      if (!isValidMoneyCents(item.costCents) || item.costCents <= 0) {
        throw new WishlistActionError();
      }

      const userRef = doc(deps.db, USERS_COLLECTION, item.ownerUid);
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new WishlistActionError();
      }
      const user = userSnap.data() as { allowanceBalance?: number; familyId?: string };
      const balance = user.allowanceBalance;
      if (!isValidMoneyCents(balance)) {
        throw new WishlistActionError();
      }
      if (balance < item.costCents) {
        throw new WishlistActionError(WISHLIST_INSUFFICIENT_FUNDS);
      }
      if (user.familyId !== item.familyId) {
        // Cross-tenant guard — should be impossible given the rules but
        // belt-and-suspenders: never debit a foreign-family user.
        throw new WishlistActionError();
      }

      const newBalance = balance - item.costCents;
      tx.update(userRef, { allowanceBalance: newBalance });
      tx.update(itemRef, {
        status: 'redeemed',
        resolvedAt: Date.now(),
      });
      const txnRef = doc(collection(deps.db, TRANSACTIONS_COLLECTION));
      tx.set(txnRef, {
        uid: item.ownerUid,
        choreId: itemId,
        choreTitle: item.title,
        amount: item.costCents,
        type: 'spending',
        familyId: item.familyId,
        createdAt: serverTimestamp(),
      });
    });
  } catch (err) {
    if (err instanceof WishlistActionError) throw err;
    throw new WishlistActionError();
  }
}

/** Pure helper for the screen — sum of pending request amounts. */
export function totalRequestedCents(items: WishlistItemWithId[]): number {
  let total = 0;
  for (const item of items) {
    if (item.status === 'requested' && isValidMoneyCents(item.costCents)) {
      total += item.costCents;
    }
  }
  return total;
}

/** Pure helper for the screen — only the items in the redemption queue. */
export function pendingRedemptions(items: WishlistItemWithId[]): WishlistItemWithId[] {
  return items.filter((i) => i.status === 'requested');
}

// `getDoc` is imported for future use by callers (e.g. a one-off lookup
// before approving) but currently unused inside the service. Re-export
// guards against tree-shaking removing it from the dynamic-import path.
export { getDoc };
