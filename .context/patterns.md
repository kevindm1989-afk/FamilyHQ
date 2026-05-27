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
