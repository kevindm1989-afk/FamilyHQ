# Patterns

Code and design patterns we use consistently in this project.

Append newest on top. Keep entries tight — three sentences plus a short example
beats an essay.

---

## Format

```
## Pattern name

**When to use:** trigger conditions.
**How:** the actual pattern.
**Example:**
\`\`\`
short code example
\`\`\`
**When not to use:** explicit anti-cases.
```

---

## Entries

## One-doc-per-item Firestore collections for live family lists

**When to use:** any "live shared list" of independently-mutable items
scoped by `familyId` — shopping, birthdays/anniversaries, wishlist,
to-do, recurring-event series, chores. Anywhere two members might
touch different items concurrently or any single item flips state
(checked/unchecked, status transitions, edit-in-place).
**How:** one top-level collection `{collectionName}/{itemId}` (auto-id
via `addDoc`), every doc carries an immutable `familyId`. Do NOT embed
items as an array inside a parent doc. A toggle / edit / delete is
one tight `updateDoc(doc(..., itemId), {...})` write; the rule layer
writes a narrow predicate against the single doc. Concurrency is free
("two members add 'Milk' at the same moment" → two distinct docs, not
a lost write). The screen-side `useFamily{Thing}s` hook does the
`where('familyId','==',caller)` query.
**Example:**
```
const ref = await addDoc(
  collection(db, 'shoppingItems').withConverter(shoppingItemConverter),
  { familyId, addedBy, name, isChecked: false, createdAt: Date.now() },
);
await updateDoc(doc(db, 'shoppingItems', itemId), { isChecked: true });
```
**When not to use:** a fixed-shape singleton (e.g. `families/{id}`
itself, settings sub-docs). Also avoid for high-fanout collections
where listing is the wrong access pattern — but at family scale that
threshold is never reached.

## State-machine status fields enforced in firestore.rules, not just the client

**When to use:** any doc whose lifecycle is a small finite state
machine — chore (`pending → complete → approved | rejected`),
wishlist (`wishing ↔ requested → redeemed | denied`), invite
(`pending → accepted | revoked`).
**How:** the rule's `update` predicate inspects `resource.data.status`
(current) AND `request.resource.data.status` (incoming) and allows
only enumerated transitions, gated by role/owner. The client service
mirrors the same transitions (cosmetic + better error messages) but
the server rule is the safety net. Idempotency falls out for free:
a replayed "approve" sees status != the pre-transition value and is
denied (rules) or aborts the transaction (status guard inside
`runTransaction`).
**Example:**
```
// firestore.rules — wishlist owner ↔ parent split
allow update: if isActive() && sameFamily(resource) && (
  (isWishlistOwner()
    && ((resource.data.status == 'wishing'
          && request.resource.data.status in ['wishing','requested'])
       || (resource.data.status == 'requested'
          && request.resource.data.status == 'wishing')))
  || (isParent()
      && resource.data.status == 'requested'
      && request.resource.data.status in ['redeemed','denied'])
);
```
**When not to use:** a status field with no meaningful transitions
(e.g. a boolean `isChecked` on shopping items — there, just gate the
write itself, no transition policy needed).

## Atomic money operation: `runTransaction` re-read + status guard + cross-tenant guard + ledger row

**When to use:** any client-side write that mutates an
`allowanceBalance` AND must leave an immutable ledger trail
(`transactions/{id}`). Currently: chore approval (credit), wishlist
redemption (debit).
**How:** ONE `runTransaction`. Inside it:
  1. Re-read the source doc (chore / wishlist item). Abort unless
     its status equals the expected pre-transition value
     (idempotency: a replayed approve sees the post-transition value
     and aborts cleanly).
  2. Re-read the affected `users/{uid}` doc. Validate
     `isValidMoneyCents(balance)` and (for debit) sufficient funds.
     Assert `user.familyId == source.familyId` (defense-in-depth
     cross-tenant guard; the rule layer is authoritative).
  3. Three writes in the SAME transaction: update source status,
     `increment` (credit) or compute-and-`update` (debit) the
     balance, `set` one `transactions/{auto}` row.
  4. On any thrown error inside the transaction, re-throw a
     PII-free generic action error (never echo a raw Firebase code
     / the source id / a child's name).
**Example:**
```
await runTransaction(deps.db, async (tx) => {
  const snap = await tx.get(itemRef);
  const item = snap.data() as Item;
  if (!snap.exists() || item.status !== 'requested') throw new XError(NOT_REQUESTED);
  if (!isValidMoneyCents(item.costCents)) throw new XError();
  const userSnap = await tx.get(userRef);
  const user = userSnap.data() as { allowanceBalance?: number; familyId?: string };
  if (!isValidMoneyCents(user.allowanceBalance) || user.allowanceBalance < item.costCents)
    throw new XError(INSUFFICIENT);
  if (user.familyId !== item.familyId) throw new XError(); // cross-tenant guard
  tx.update(userRef, { allowanceBalance: user.allowanceBalance - item.costCents });
  tx.update(itemRef, { status: 'redeemed', resolvedAt: Date.now() });
  tx.set(doc(collection(db, 'transactions')), {
    uid: item.ownerUid, choreId: itemId, choreTitle: item.title,
    amount: item.costCents, type: 'spending', familyId: item.familyId,
    createdAt: serverTimestamp(),
  });
});
```
**When not to use:** a non-money flip with no ledger trail (chore
member `pending → complete`, wishlist owner cancel) — a single
`updateDoc` is the right tool there.

## Pure tolerant selectors for dashboard / widget surfaces (the F5 pattern)

**When to use:** any widget that derives a small UI list from a Firestore
collection that may contain malformed, in-flight, or missing fields.
**How:** a pure `selectX(docs, opts) => view[]` function lives next to the
hook, accepts the raw snapshot shape, tolerates missing / malformed fields
without throwing (e.g. non-string `dueDate`, undefined optional, empty
string), and is unit-tested with explicit bad-input fixtures. The
component renders only what the selector returns. Compose buckets / sort
keys inside the selector — never inline in the render function — so the
ordering rules are testable in isolation.
**Example:**
```
// src/features/dashboard/dashboardSelectors.ts
export function selectTopOpenTodos(items, todayISO, limit) {
  const dueKey = (v) => typeof v === 'string' && v !== ''
    && !Number.isNaN(new Date(v).getTime()) ? v : null;
  return items.filter((t) => !t.isCompleted)
              .map((todo, index) => ({ todo, index, due: dueKey(todo.dueDate) }))
              .sort(/* overdue → upcoming → no-date, stable ties */)
              .slice(0, limit)
              .map(({ todo }) => todo);
}
```
**When not to use:** writes, or any path where a malformed doc is a true
error to surface to the user — selectors must never silently swallow data
loss that the user needs to know about.

## Exact-payload write contract for constrained user-doc updates

**When to use:** any client write whose firestore.rules contract is
`affectedKeys().hasOnly([...])` — i.e. a tightly bounded update on a
broadly-readable doc (typical for `users/{uid}`: rename, isActive flip;
future: theme, profile edit).
**How:** the service function builds a literal object with EXACTLY the
allowed keys; never spread the full doc, never merge an "incoming patch"
shape. Validate input type + bounds BEFORE the write (a non-string name, a
non-boolean isActive, an over-length value rejects with a generic PII-free
error — `updateDoc` is never called on bad input). Test the payload shape
with `Object.keys(captured.data).sort()` deeply equal to the allowed set,
PLUS a forbidden-keys loop asserting per-field absence (catches both extras
and a future full-doc spread regression). Map any Firestore failure to a
single generic user-safe message; never echo input (name, uid) into the
error.
**Example:**
```
// service
await updateDoc(doc(db, 'users', uid), { name: trimmed }); // EXACTLY {name}
// test
expect(Object.keys(captured.data).sort()).toEqual(['name']);
for (const k of ['role','familyId','isActive','email','allowanceBalance','theme']) {
  expect(Object.prototype.hasOwnProperty.call(captured.data, k)).toBe(false);
}
```
**When not to use:** unbounded admin writes (parent-on-own-doc theme, etc.
that the rule does not constrain) or transactional multi-field writes (e.g.
chore approval) — those have a different contract shape.

## Multi-tenant Firestore: flat top-level collections + immutable `familyId`, isolation in rules

**When to use:** a single Firebase project serving many independent tenants
(families) where cross-tenant leakage is the dominant risk.
**How:** every non-`families` doc carries an immutable `familyId`; tenant scope
is enforced ENTIRELY in `firestore.rules` via shared helper functions
(`isSignedIn`/`isActive`/`isParent`/`sameFamily(res)`/`incomingSameFamily()`/
`immutable(field)`). The caller's family is read SERVER-SIDE from their own
`users/{uid}` doc (`callerFamily()`), never trusted from the request. List rules
scope per-returned-resource (`sameFamily(resource)`) — they do NOT inspect
`request.query`, because per-resource scoping reliably denies an unconstrained or
cross-family query while allowing a `where('familyId','==', ownFamily)` query.
**Example:**
```
function sameFamily(res) { return res.data.familyId == callerFamily(); }
allow get:  if isActive() && sameFamily(resource);
allow list: if isActive() && sameFamily(resource);   // per-doc, not request.query
allow create: if isActive() && incomingSameFamily();
```
**When not to use:** when path-structural isolation (subcollections) is acceptable
and you don't need flat top-level collections — there, the path is the backstop;
here, a single missing predicate is the only thing between tenants, so rule tests
are mandatory.

## Keep sensitive PI out of broadly-readable docs — split into a per-subject private collection

**When to use:** a doc is readable by a whole tenant (e.g. a family member list)
but carries a field only some members should see (e.g. an adult's email), and your
datastore rules are document-level, not field-level.
**How:** Firestore rules cannot field-mask, so a child member's client receives
the WHOLE `users` doc. Move the sensitive field into a separate
`userPrivate/{uid}` collection written atomically in the same signup batch;
restrict its read rule to the subject (active) OR a same-family parent; deny
`list`. The broadly-readable doc keeps only non-sensitive fields.
**Example:**
```
match /userPrivate/{userId} {
  allow get:  if (isPrivateSubject() && isActive()) || isSameFamilyParentOf();
  allow list: if false;          // no enumeration of emails
}
```
**When not to use:** when the field is safe for the whole audience, or your store
supports per-field access control natively.

## Clearing the Firestore IndexedDB cache: terminate before clear, and fail closed

**When to use:** sign-out, account switch, or any startup uid-change on a shared
device where stale tenant data must not leak to the next user.
**How:** `clearIndexedDbPersistence(db)` REJECTS on a running client, so call
`terminate(db)` FIRST, then clear, then force a full page reload so a fresh
Firestore client is built (the terminated singleton is unusable). Fail CLOSED: if
terminate/clear rejects, propagate the rejection — never resolve to a "safe to
proceed" state, and do not advance the last-cached-uid marker. On sign-out the
cache MUST still be cleared even if `signOut()` itself fails. Also guard at
startup (compare authenticated uid to a persisted marker) for sessions that ended
without a clean sign-out (crash, token expiry).
**Example:**
```
await signOut(auth).catch(e => signOutError = e); // capture, don't abort
await terminate(db);
await clearIndexedDbPersistence(db);
deps.reload();                                     // fresh client
if (signOutError) throw signOutError;              // surface after clearing
```
**When not to use:** memory-only Firestore caches (nothing persists on device).
