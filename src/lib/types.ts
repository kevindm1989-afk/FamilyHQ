/**
 * CONTRACT — Family HQ data model (system-design §2.2, ADR-0001/0006).
 *
 * Types only, no logic. This file is authored by the test-writer to PIN the
 * shape the implementer must fulfill (the tests below import these). The
 * implementer may extend with helpers but must not change these field names /
 * unions without updating the tests + the threat model.
 *
 * `familyId` is on every non-`families` doc and is IMMUTABLE from the client
 * (enforced in firestore.rules — see test/rules/). Role naming is parent|member
 * everywhere (the handoff's "teen" maps to "member").
 */

export type Role = 'parent' | 'member';
export type Theme = 'light' | 'dark';

export type ChoreStatus = 'pending' | 'complete' | 'approved' | 'rejected';
export type RecurrenceFrequency = 'none' | 'weekly' | 'biweekly' | 'monthly';
export type EventTag = 'school' | 'sports' | 'family' | 'work';
export type PostTone = 'family' | 'amber';
export type TransactionType = 'earning' | 'spending';
export type WishlistStatus = 'wishing' | 'requested' | 'redeemed' | 'denied';
export type InviteStatus = 'pending' | 'accepted';

/** `families/{familyId}` — replaces the spec's settings/family singleton. */
export interface Family {
  familyName: string;
  createdBy: string; // founding parent uid
  createdAt: number;
}

/**
 * `users/{uid}` — keyed by Auth UID. FAMILY-READABLE doc.
 *
 * Privacy finding 2 (review of Phases 1-2): `email` is adult [PI] and MUST NOT
 * be exposed to other members of the family (children must not see an adult's
 * email). It is therefore NOT on this family-readable doc — it lives on the
 * per-subject `userPrivate/{uid}` doc instead (readable only by the subject and
 * a same-family parent). Do not re-add `email` here.
 */
export interface User {
  name: string; // [PI/PI-child]
  role: Role; // immutable from client
  familyId: string; // immutable from client
  /**
   * INTEGER CENTS (money). The member's running allowance balance in whole
   * cents (e.g. $38.50 is `3850`), `>= 0` and `<= MONEY_MAX_CENTS`. Stored as
   * cents everywhere; format to "$X.XX" only for display. Parent/transaction-
   * written only (firestore.rules `parentAllowanceCredit`).
   */
  allowanceBalance: number;
  isActive: boolean; // parent-written only
  theme: Theme; // self-writable
  /**
   * Audit-only: when the user joined via an invite (not the founding-parent
   * bootstrap), this carries the invite doc id that authorised their join.
   * Required by firestore.rules' `isInviteBootstrap` so the rules can verify
   * the invite is valid for this email/familyId/role. Permanent + read-only
   * after create (both selfUpdate and parentUpdate enforce `immutable('inviteId')`).
   * Absent for founding parents.
   */
  inviteId?: string;
}

/**
 * `userPrivate/{uid}` — per-subject private doc (privacy finding 2).
 *
 * Holds the adult `email` [PI] that was removed from the family-readable `users`
 * doc. Readable ONLY by the subject (uid == auth.uid) and a same-family PARENT;
 * NOT readable by other members (a child cannot read another member's email).
 * `familyId` is carried solely so firestore.rules can scope the parent-read
 * predicate; it is immutable from the client.
 */
export interface UserPrivate {
  email: string; // [PI] adult email (child credential model per ADR-0006 Q3)
  familyId: string; // immutable from client — for rule scoping only
  /**
   * Per-user push notification preferences (PR B — push notifications).
   * Optional so existing users (created before push landed) have implicit
   * safe-by-default behaviour at read time via DEFAULT_NOTIFICATION_PREFERENCES.
   * When absent, the UI treats the user as master-off / all-categories-off.
   */
  notificationPreferences?: NotificationPreferences;
}

/**
 * Notification category keys (PR B). The architect's locked-in set:
 *   - choreApprovalsNeeded   — parent only (kid completed a chore, needs review)
 *   - wishlistApprovalsNeeded — parent only (kid requested an allowance redeem)
 *   - myChoreResolved        — kid only (parent approved/rejected your chore)
 *   - myWishlistResolved     — kid only (parent approved/denied your wish)
 *   - familyBoardPosts       — all members (someone posted to the board)
 *   - familyTodos            — all members (a new to-do landed)
 */
export type NotificationCategoryKey =
  | 'choreApprovalsNeeded'
  | 'wishlistApprovalsNeeded'
  | 'myChoreResolved'
  | 'myWishlistResolved'
  | 'familyBoardPosts'
  | 'familyTodos';

/**
 * Per-subject notification preferences doc shape (PR B). Stored as
 * `userPrivate.notificationPreferences`. Master `pushEnabled` is OFF by
 * default (safe-by-default — no push without explicit opt-in); every
 * category is also OFF by default. `showDetails` is a v1 invariant
 * (always false — title/body never carry PI); v1.1 will introduce a
 * per-device opt-in surface.
 */
export interface NotificationPreferences {
  /** Master switch. Default false — no push at all until the user opts in. */
  pushEnabled: boolean;
  /** Per-category opt-in map. Every category defaults to false. */
  categories: Record<NotificationCategoryKey, boolean>;
  /** v1 invariant: always false (no PI on the lock screen). v1.1 opt-in. */
  showDetails: boolean;
  /** Epoch ms — last time the user mutated their preferences. */
  updatedAt: number;
}

export interface FamilyEvent {
  title: string;
  description: string;
  date: string; // ISO date
  tag: EventTag;
  familyId: string;
  createdBy: string;
  createdAt: number;
  /**
   * Recurring-events fields (PR — Recurring calendar events).
   *
   * The recurrence model is **spawn-on-create-N**: when a parent picks
   * "weekly for 12 weeks" in AddEvent, the service creates 12 separate
   * events docs upfront — each one a real `events/{id}` with the date
   * offset by week N, all three docs sharing a `recurrenceGroupId`. This
   * lets the existing calendar query keep working unchanged and makes
   * "delete this occurrence" trivial. The cost is N rows of storage for
   * an N-occurrence series — bounded at 26 so the worst case is small.
   *
   * All three fields are OPTIONAL so existing one-off events (created
   * before this feature) keep their original 7-field shape without a
   * migration.
   */
  recurrenceFrequency?: RecurrenceFrequency;
  /** Total occurrences in the series. 1-26. Stored on every sibling. */
  recurrenceCount?: number;
  /** Shared UUID linking siblings. Absent for one-off events. */
  recurrenceGroupId?: string;
}

export interface Post {
  content: string; // [PI/PI-child]
  authorId: string;
  authorName: string; // [PI]
  familyId: string;
  createdAt: number;
  tone?: PostTone;
}

export interface Chore {
  title: string;
  assignedTo: string; // uid of a same-family user
  dueDate: string;
  /** INTEGER POINTS (not money). A whole number >= 0; never formatted as money. */
  pointValue: number;
  /**
   * INTEGER CENTS (money). A whole number of cents (e.g. a $3.00 reward is
   * `dollarValue: 300`), `>= 0` and `<= MONEY_MAX_CENTS` ($1,000,000). Stored as
   * cents EVERYWHERE (second-opinion #4 / adversarial Finding 7) to avoid float
   * drift; format to "$X.XX" only for DISPLAY (see formatMoney). NEVER stored as
   * a fractional dollar amount (350.5 is invalid — denied by firestore.rules).
   */
  dollarValue: number;
  status: ChoreStatus;
  rejectionReason?: string;
  /**
   * Optional epoch ms — set when a parent rejects a chore. Paired with
   * `rejectionReason`. Both fields are cleared on the next mark-complete
   * attempt (the kid retries with a fresh submission).
   */
  rejectedAt?: number;
  /**
   * Optional Firebase Storage download URL (Feature 2 — Chore Photo
   * Verification). When the kid attaches a photo on mark-complete, the
   * file is uploaded under `families/{familyId}/chores/{choreId}/proof.jpg`
   * and the resulting download URL is stored here. Visible to same-family
   * callers via storage.rules; chore writers attach via the
   * markCompleteWithProof service. Optional — text-only completion still
   * works.
   */
  proofImageUrl?: string;
  /** Epoch ms when the proof image was attached. Paired with proofImageUrl. */
  proofSubmittedAt?: number;
  familyId: string;
  createdBy: string;
  createdAt: number;
  isRecurring: boolean;
  recurrenceFrequency: RecurrenceFrequency;
}

/**
 * Append-only ledger (ADR-0004).
 *
 * The collection holds two row shapes that share the same required keys:
 *  - `type: 'earning'` — chore-driven credit. `sourceId` + `sourceLabel`
 *    point at the approved chore (chore id + chore title).
 *  - `type: 'spending'` — wishlist-driven debit. `sourceId` + `sourceLabel`
 *    point at the redeemed wishlist item (wishlist-item id + wishlist
 *    title). `amount` is always a positive integer-cents value (the SIGN
 *    is implied by `type`).
 *
 * Note: these fields were originally named `choreId` / `choreTitle` when
 * the ledger only held chore-earning rows. They were generalised to
 * `sourceId` / `sourceLabel` as part of the wishlist-redemption follow-up
 * once both row shapes shared the storage.
 */
export interface Transaction {
  uid: string;
  /** Source identity — chore id for earnings, wishlist-item id for spending. */
  sourceId: string;
  /** Source display label — chore title for earnings, wishlist title for spending. */
  sourceLabel: string;
  /**
   * INTEGER CENTS (positive). For 'earning' this is the chore reward; for
   * 'spending' this is the absolute cost the parent debited. `>= 0`,
   * `<= MONEY_MAX_CENTS`. Money is cents everywhere; format only for
   * display.
   */
  amount: number;
  type: TransactionType;
  familyId: string;
  createdAt: number;
}

/**
 * `wishlistItems/{itemId}` — things a member wants to spend their allowance
 * on. Member CRUDs their own; a same-family parent reads any (for the
 * approval queue) and can flip status to 'redeemed' (with an atomic balance
 * debit + ledger entry) or 'denied' (no balance change).
 *
 * Status state machine:
 *   wishing  → requested  (owner taps "Request to buy")
 *   requested → wishing   (owner cancels; or parent denies → 'denied')
 *   requested → redeemed  (parent approves; balance debited atomically)
 *   requested → denied    (parent denies with a reason)
 */
export interface WishlistItem {
  familyId: string;
  /** UID of the family member the item is FOR. Set ONCE at create. */
  ownerUid: string;
  /** Display title — "Nintendo Switch", "Movie ticket". Trimmed. */
  title: string;
  /**
   * INTEGER CENTS — the cost the kid wants to spend. `> 0` and
   * `<= MONEY_MAX_CENTS`. Stored as cents (ADR-0009).
   */
  costCents: number;
  status: WishlistStatus;
  /** Optional link to a SavingsGoal whose currentAmount should also decrease
   *  on redemption. Same family. */
  savingsGoalId?: string;
  /** Reason a parent rejected the redemption request. Cleared on next request. */
  deniedReason?: string;
  createdAt: number;
  /** Epoch ms when status flipped to 'requested'. */
  requestedAt?: number;
  /** Epoch ms when status flipped to 'redeemed' or 'denied'. */
  resolvedAt?: number;
}

/**
 * The maximum money value (in INTEGER CENTS) the rules + UI accept: $1,000,000.
 * Any `dollarValue`/`amount`/`allowanceBalance` above this is denied at the
 * authorization boundary (adversarial Finding 7 — bound the money fields).
 */
export const MONEY_MAX_CENTS = 100000000;

/**
 * Lifecycle of a savings goal (Feature 1 — savings goals & jars).
 *  - 'active'    : the goal is being saved toward. Default on create.
 *  - 'completed' : the parent has marked the goal as fulfilled (kid bought
 *                  the thing). Terminal — no more contributions allowed.
 *  - 'archived'  : the goal was given up on (kid changed their mind /
 *                  parent retired a stale goal). Terminal — no more
 *                  contributions, can be re-opened by re-creating.
 */
/**
 * Family-scoped ad-hoc task ("To-Do List" — Task Management feature). Distinct
 * from `Chore` (which has allowance + parent approval); a Todo is a personal
 * or shared item with no money attached.
 *
 * Authority model: ANY active same-family caller can create, edit, complete,
 * or delete a Todo (per spec). `createdBy` is recorded for audit but does not
 * restrict edits.
 */
export interface Todo {
  familyId: string;
  /** UID of the family member who created it. Set ONCE at create. */
  createdBy: string;
  /** Optional UID — when set, the Todo is "for" a specific family member. */
  assignedTo?: string;
  title: string;
  description?: string;
  isCompleted: boolean;
  /**
   * Optional ISO `YYYY-MM-DD`. When absent the Todo lives in the
   * "Someday / No Deadline" bucket on the UI. Same date shape as Chore's
   * `dueDate` for consistency.
   */
  dueDate?: string;
  createdAt: number;
  /** Epoch ms when `isCompleted` flipped to true. Cleared on un-complete. */
  completedAt?: number;
}

/**
 * Single item inside a `ChecklistTemplate`. The `id` is a stable client-
 * generated string (UUID-ish) so a `ChecklistInstance.itemsProgress` map
 * keyed by that id survives re-ordering / editing the template later.
 */
export interface ChecklistTemplateItem {
  id: string;
  text: string;
}

/**
 * Repeatable checklist template ("Routine Checklists" — Task Management
 * feature). ANY family member can create their own templates; the creator
 * AND any same-family parent can edit/delete (per Q-A confirmation —
 * deliberately stricter than the spec's literal "anyone-edits-anything"
 * reading to prevent sibling-pranks / accidental destruction).
 *
 * `isSharedWithFamily` defaults to true at create time; a creator can flip
 * it to false to keep a draft private (rules: only the creator reads when
 * shared=false; everyone reads when shared=true).
 */
export interface ChecklistTemplate {
  familyId: string;
  /** UID of the family member who created it. Set ONCE at create. */
  createdBy: string;
  title: string;
  /** Default true — toggle false to keep a draft private to the creator. */
  isSharedWithFamily: boolean;
  /**
   * Ordered list of items. Each carries a stable `id` so the matching
   * `ChecklistInstance.itemsProgress` map can survive template edits
   * (rename, re-order, drop an item).
   */
  items: ChecklistTemplateItem[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Running instance of a `ChecklistTemplate`. Created via "Start New
 * Instance" so the same template can be reused without overwriting past
 * runs. The owner toggles items via `itemsProgress`; isCompleted goes
 * true when every (live) template item is checked OR the owner manually
 * finishes the run.
 *
 * Authority: the running user creates + edits their own instance; any
 * same-family active member READS (so a parent can see kid progress);
 * the owner OR a same-family parent deletes.
 */
export interface ChecklistInstance {
  familyId: string;
  /** Which template this run was launched from. Set ONCE at create. */
  templateId: string;
  /** UID of the family member running this instance. Set ONCE at create. */
  userId: string;
  /**
   * ISO `YYYY-MM-DD` — the day this run is "for" (today by default).
   * Optional secondary axis; the primary identity is (userId, templateId,
   * createdAt). Used by the UI to group runs by day.
   */
  date: string;
  isCompleted: boolean;
  /**
   * Per-item completion. Key is `ChecklistTemplateItem.id`; value is
   * `true` for checked. An absent key reads as unchecked — no need to
   * seed every item to false at create time.
   */
  itemsProgress: { [itemId: string]: boolean };
  createdAt: number;
  /** Epoch ms when `isCompleted` flipped to true. Cleared on re-open. */
  completedAt?: number;
}

export type SavingsGoalStatus = 'active' | 'completed' | 'archived';

/**
 * `shoppingItems/{itemId}` — shared family shopping list.
 *
 * One doc per item (flat collection, familyId-scoped). Per-item docs vs a
 * single list-of-items doc: per-item docs let a checkbox toggle write only
 * the one row, instead of round-tripping the whole list on every change
 * (and let everyone in the family see only the deltas in their listener).
 *
 * Authority: ANY active same-family caller has full CRUD. `addedBy` is
 * recorded for audit but does not restrict edits — anyone in the family
 * can check off, edit, or delete any item.
 */
export interface ShoppingItem {
  familyId: string;
  /** UID of the family member who added it. Set ONCE at create. */
  addedBy: string;
  /** Item name — "Milk", "Whole-grain bread". Trimmed, 1-200 chars. */
  name: string;
  /** Optional quantity/size hint — "2 gallons", "1 dozen", "x3". Trimmed. */
  quantity?: string;
  /** Optional bucket for UI grouping. Open string so we can add new ones. */
  category?: string;
  isChecked: boolean;
  /** Epoch ms when isChecked flipped true. Cleared on un-check. */
  checkedAt?: number;
  /** UID of whoever checked it. Cleared on un-check. */
  checkedBy?: string;
  createdAt: number;
}

/**
 * `birthdays/{birthdayId}` — family birthdays + anniversaries surfaced on the
 * dashboard as a "days until" widget.
 *
 * Authority model: ANY active same-family caller can create / read / update /
 * delete a Birthday (same model as Todos). `createdBy` is recorded for audit
 * but does not restrict edits.
 *
 * Date model: `monthDay` is `"MM-DD"` (e.g. `"06-15"` — June 15) so the
 * widget's "N days until the next occurrence" math works without a known
 * birth year, and avoids the "0 days old" edge. `birthYear` is OPTIONAL —
 * when set, the UI can render a "turning N" badge on the day; when absent
 * the widget just says "Maya's birthday".
 *
 * `type` distinguishes birthdays from anniversaries so the widget can label
 * them differently ("🎂 Maya" vs "💞 Mom + Dad"). Both share the same
 * recurrence shape so they live in one collection.
 */
export type BirthdayType = 'birthday' | 'anniversary';

export interface Birthday {
  familyId: string;
  /** UID of the family member who added it. Set ONCE at create. */
  createdBy: string;
  /** Display name — "Maya", "Grandma Helen", "Mom + Dad". Trimmed. */
  name: string;
  /**
   * Recurrence date as `"MM-DD"` (zero-padded). Year is omitted so the widget
   * computes "days until next occurrence" without surprise. Use birthYear
   * (optional) for the "turning N" affordance.
   */
  monthDay: string;
  /** Optional year-of-birth when known. Drives the "turning N" badge. */
  birthYear?: number;
  /** Free-form note (gift hints, relationship). Trimmed. */
  note?: string;
  type: BirthdayType;
  createdAt: number;
}

export interface SavingsGoal {
  familyId: string;
  /** uid of the SUBJECT (the member whose goal this is). Set ONCE at create. */
  ownerUid: string;
  /** Free-text label the kid picks (e.g. "Nintendo Switch"). Trimmed by service. */
  title: string;
  /** INTEGER CENTS — how much to save in total. `>= 0` and `<= MONEY_MAX_CENTS`. */
  targetAmount: number;
  /** INTEGER CENTS — how much has been allocated/contributed so far. */
  currentAmount: number;
  /**
   * Optional aspirational target date (ISO YYYY-MM-DD). Pure UI hint; no
   * automatic deadline action.
   */
  targetDate?: string;
  createdAt: number;
  updatedAt: number;
  status: SavingsGoalStatus;
}

export interface Invite {
  email: string; // [PI] adult email
  role: Role;
  familyId: string;
  invitedBy: string;
  createdAt: number;
  status: InviteStatus;
  /**
   * Epoch ms after which the invite is no longer redeemable. Optional for
   * backward compatibility with invites created before the TTL feature
   * landed — those default to `createdAt + INVITE_TTL_MS` at read time.
   * New invites always write this explicitly. Client-side enforcement
   * (getInviteById returns null when past expiry); rules-level enforcement
   * is a follow-up.
   */
  expiresAt?: number;
}

/** A user enriched with its document id (uid) for UI lists. */
export interface UserWithId extends User {
  id: string;
}
