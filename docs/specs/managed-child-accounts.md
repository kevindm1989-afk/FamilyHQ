# Spec — Managed (email-less) child accounts

**Feature:** Tier 0.1 — let a parent create an under-13 child account with a
parent-set password and **no email**, then let that child sign in.
**Implements:** ADR-0003 Option C (decided, never built) + the child-credential
half of ADR-0006.
**Status:** Decisions resolved (§11) — ready to build. Unblocks the core
"children under 13" promise.
**Author:** strategy pass, from a direct read of `main`.

---

## 1. Why this is #1

FamilyHQ markets itself around "children under 13," but the shipped role model is
only `parent | member` (`src/lib/types.ts:14`) and **every** member is created
through `createUserWithEmailAndPassword` — the founding parent
(`authService.ts:81`) and every invitee (`inviteService.ts:205`). There is no way
to onboard a child who doesn't have an email address. ADR-0003 already decided the
fix (a parent-only Cloud Function using the Admin SDK); it was never built. Until
it is, the product's central promise is unshippable and the COPPA/PIPEDA posture
it was designed toward stays theoretical.

**The unlock:** the Firebase **Admin SDK bypasses Firestore security rules**. A
parent-only callable can mint the child's Auth user *and* write its `users` /
`userPrivate` docs server-side, atomically, without disturbing the parent's
session and without needing any new client-side bootstrap rule. That is why this
is a Tier-0 (weeks) effort, not a rewrite: the hard parts already exist as
patterns.

---

## 2. Scope

**In:**
- A parent-only callable `createManagedChild` that creates the Auth user + Firestore docs.
- A parent-only callable `resetManagedChildPassword` (kids forget passwords; without this a parent is stuck).
- A model change marking an account as parent-managed (`accountType`) + a login handle.
- A child sign-in path that needs no email.
- Rules deltas, UI, tests, and the compliance guarantees.

**Out (explicitly):**
- Adult co-parent invite-by-email (that's the *other* half of ADR-0003 — it needs an email subprocessor + DPA, a separate human gate). Children ship first *because* they need no email.
- "Child turns 13 → migrate to a standard email account" flow (fast-follow, noted in §11).
- Real-money / card features (Tier 2).

---

## 3. The one decision that needs your sign-off: how a child signs in

Firebase Auth's client SDK signs in with an **email + password**. A managed child
has no email, so we mint a **synthetic, non-routable login identity** and let the
child authenticate against it. Three options:

| Option | Child types | Pros | Cons |
|---|---|---|---|
| **A — Family code + handle + password** *(recommended)* | a short family code, their handle, password | No server round-trip, no enumeration surface, client SDK unchanged, works on any device | Child memorises 3 things |
| B — QR / deep link + password | scans a parent-generated link, then password | Easiest for young kids | Needs the link present each sign-in; weaker on a fresh device |
| C — On-device managed-profile switch | taps their avatar, password | Frictionless on the household tablet | Doesn't solve a brand-new device |

**Recommendation: ship A as the credential, layer B (QR) on top as convenience.**

Under Option A the client deterministically composes the synthetic email from what
the child types — **no lookup, no resolver, no readable index**:

```
syntheticEmail = `${handle}@${family.loginCode}.familyhq.invalid`
signInWithEmailAndPassword(auth, syntheticEmail, password)
```

- `loginCode` is a short, DNS-safe, high-entropy per-family slug (≈6 base32 chars, ~30 bits).
- `handle` is a parent-chosen username, unique **within** the family, `^[a-z0-9]{2,20}$`.
- `(loginCode, handle)` is therefore unique within the project → a valid, unique synthetic email.
- **`.invalid` is the IETF-reserved TLD (RFC 2606)** — it does not exist in the
  global DNS and never can, so it is *structurally impossible* to ever deliver
  email to a child address (stronger than a no-MX custom domain; nothing to own,
  register, or configure). Firebase email/password auth accepts any well-formed
  address and never checks deliverability, so this "just works." That is the
  technical guarantee behind the "no email to/about children" rule — not a policy
  promise. **No custom domain is required** (the app itself runs on
  `familyhq-68638.web.app`).

This keeps *all* existing auth code paths intact — the child sign-in reuses
`signInWithEmailAndPassword` exactly like every other user; only the email string
is synthesised.

---

## 4. Data model changes (additive, no migration)

All new fields are **optional** so existing docs read unchanged (`accountType`
defaults to `'standard'` at read time).

### `src/lib/types.ts`

```ts
export type Role = 'parent' | 'member';           // UNCHANGED — a child is a member
export type AccountType = 'standard' | 'managed'; // NEW

export interface User {
  name: string;
  role: Role;
  familyId: string;
  allowanceBalance: number;
  isActive: boolean;
  theme: Theme;
  inviteId?: string;
  // NEW ↓
  /** 'managed' = parent-provisioned, no email, password reset by a parent.
   *  Absent/'standard' for every existing account. Immutable from the client. */
  accountType?: AccountType;
  /** Child's parent-chosen username, unique within the family. Present only for
   *  managed accounts. Used with family.loginCode to form the sign-in identity.
   *  Immutable from the client (parents rename via the callable, not directly). */
  loginHandle?: string;
}

export interface Family {
  familyName: string;
  createdBy: string;
  createdAt: number;
  timezone?: string;
  // NEW ↓
  /** Short DNS-safe slug that scopes child sign-in. Created lazily the first
   *  time a parent adds a managed child. Written by the callable (Admin SDK). */
  loginCode?: string;
}
```

**Deliberately NOT storing the child's birth date / age.** COPPA compliance here
comes from *parent-mediated creation* (the parent is the actor), not from
recording the child's age. Storing a birth year is collecting extra children's
PI for no shipped feature. If a later feature genuinely needs "is under 13,"
add `birthYear?: number` to **`userPrivate`** (subject + parent readable only),
never to the family-readable `users` doc. Default: collect nothing.

### Keep the child's synthetic email off the family-readable doc

The child's synthetic login email goes in `userPrivate/{uid}.email` — exactly the
existing shape `{ email, familyId }` (`types.ts:84`), so no `userPrivate` rule
change is needed. Siblings still can't read it (the `userPrivate` read rule already
restricts to subject + same-family parent, `firestore.rules:294`).

### New server-only uniqueness ledger

`familyLoginCodes/{code}` → `{ familyId }`. Purely a server-side reservation so
two families can't collide on a `loginCode`. Never read or written by clients.

---

## 5. The callable: `createManagedChild`

Mirrors `notifyChoreApproved.ts` line-for-line in structure (region, App Check,
rate-limit-first, tolerant snapshot reads, PI-free logs, generic errors).

### Contract

```ts
// Request
{ displayName: string; handle: string; password: string }
// Response
{ childUid: string; loginCode: string; handle: string }   // parent tells the child code+handle; they already set the password
```

### Ordered logic (fail-closed, cheapest checks first)

```
region: 'northamerica-northeast1', enforceAppCheck: true   // literal — add to the C-T1 CI grep

 1. request.auth present ................................. else UNAUTHENTICATED
 2. rate limit  rateLimits/createChild__{uid}  5 / 3600s .. else RESOURCE_EXHAUSTED
    (reuse the exact runTransaction limiter from notifyChoreApproved.ts:161)
 3. caller users/{uid} exists && isActive && role=='parent' else PERMISSION_DENIED
 4. validate input:
       displayName  trim, 1..50 chars
       handle       ^[a-z0-9]{2,20}$
       password     length >= 8            .................. else INVALID_ARGUMENT (generic)
 5. per-family member cap: count active users in family < 12 else FAILED_PRECONDITION
 6. ensure family.loginCode:
       read families/{callerFamily}
       if no loginCode:
         generate 6-char base32; reserve familyLoginCodes/{code}={familyId}
         (retry ≤5x on collision via create-if-absent); set families/{id}.loginCode
 7. handle uniqueness within family:
       query users where familyId==callerFamily && loginHandle==handle → must be empty
       else ALREADY_EXISTS (generic "that name is taken")
 8. syntheticEmail = `${handle}@${loginCode}.familyhq.invalid`   // RFC 2606 reserved TLD — never routable
 9. adminAuth.createUser({ email: syntheticEmail, password, emailVerified:false,
                           displayName })                    // Admin SDK — no parent session disturbance
10. adminDb batch (atomic):
       users/{childUid} = { name: displayName, role:'member', familyId,
                            isActive:true, allowanceBalance:0, theme:'light',
                            accountType:'managed', loginHandle:handle }
       userPrivate/{childUid} = { email: syntheticEmail, familyId,
                            notificationPreferences: DEFAULT_NOTIFICATION_PREFERENCES }
11. COMPENSATION: if step 10 throws, adminAuth.deleteUser(childUid)   // no orphan auth user
12. structured log (allow-list ONLY): { kind:'createChild', familyId, actorUid, durationMs }
    NEVER log handle, displayName, syntheticEmail, or password.
13. return { childUid, loginCode, handle }
```

**Why Admin SDK, not a client batch:** creating a second user via the *client*
SDK signs the parent out and in as the new user (ADR-0003 Option A, rejected). The
Admin SDK is the only context that mints another account without touching the
caller's session — and, as a bonus, its Firestore writes bypass rules, so the
child's docs need no bootstrap-rule carve-out.

### Second callable: `resetManagedChildPassword`

```ts
// Request:  { childUid: string; newPassword: string }   Response: { ok: true }
 1. auth + App Check
 2. rate limit  rateLimits/resetChildPw__{uid}  10 / 3600s
 3. caller is active parent
 4. child = users/{childUid}: exists && familyId==callerFamily && accountType=='managed'
                                                              else PERMISSION_DENIED
 5. adminAuth.updateUser(childUid, { password: newPassword })
 6. PI-free log; return { ok: true }
```

Both exported from `functions/src/index.ts` alongside the existing nine.

---

## 6. Firestore rules deltas (small — Admin writes bypass rules)

The Admin SDK creates the child docs, so **no new create rule** is required. The
only deltas guard what a *client* can do afterward:

1. **`users` self-update** (`firestore.rules:190` `selfUpdateAllowed`) — add three
   immutability guards so a child can't self-promote or rename their handle:
   ```
   && immutable('accountType')
   && immutable('loginHandle')
   ```
   (Existing guards already lock `role`, `familyId`, `isActive`, `allowanceBalance`.)

2. **`users` parent-update** (`firestore.rules:234` `parentUpdateAllowed`) — no
   change needed. Its `affectedKeys().hasOnly(['name','isActive'])` already denies
   any client write to `accountType`/`loginHandle`. Parents rename a child through
   `parentUpdateAllowed` (name only) exactly as they rename anyone else.

3. **New `familyLoginCodes/{code}`** — fully server-only:
   ```
   match /familyLoginCodes/{code} { allow read, write: if false; }
   ```
   The child sign-in composes the synthetic email from what the parent told them;
   nothing client-side ever reads this ledger.

4. **`families`** — no change. `loginCode` is written by the callable (Admin,
   bypass) and is readable by family members through the existing family read rule
   (it's a family handle, not a secret; sign-in still needs the password).

Everything else — `isFoundingBootstrap`, `isInviteBootstrap`, the money predicates
— is untouched. That's the point of modelling a child as a `member` + metadata
rather than a new `role`: zero blast radius on the 1,200-line rules file.

---

## 7. Client / UI changes

1. **Family Management → "Add a child"** (`FamilyManagementScreen` /
   `FamilyManagementRoute.tsx`, parent-only, beside the existing invite flow):
   form = display name, handle (with live "taken/available" hint), password (twice).
   On success show a **one-time hand-off card**: "Tell {name}: family code
   `abc123`, username `{handle}`, and the password you set." (Password is never
   re-displayed — the parent set it.)
   Wire it in `FamilyManagementRoute.tsx` next to `handleCreateInvite`
   (`FamilyManagementRoute.tsx:72`) via `httpsCallable(getFunctions(undefined,
   FUNCTIONS_REGION), 'createManagedChild')` — the exact pattern already used in
   `choresParentService.ts:240`.

2. **Child sign-in** (extend `LoginScreen`): a "Kid sign-in" tab with three fields
   — family code, username, password — that composes the synthetic email and calls
   the existing `signIn` (`authService.ts:130`). No new auth primitive.

3. **Parent "reset password"** on each managed-child row → `resetManagedChildPassword`.

4. **Feature flag** `VITE_MANAGED_CHILD_ENABLED` (mirror `featureFlag.ts` /
   `VITE_FCM_ENABLED`) gating the "Add a child" UI for staged rollout.

All parent-facing error copy stays generic + PI-free (reuse the
`InviteActionError` / `AuthActionError` convention — no raw Firebase codes, no
handle/email echoed).

---

## 8. Security & privacy

**Compliance posture (COPPA / PIPEDA / Québec Law 25):**
- **Verifiable parental consent at the tenant boundary** — the account is created
  *by* an authenticated active parent through an App-Check-enforced callable. A
  child never self-registers.
- **No email to or about a child, guaranteed structurally** — synthetic address on
  the reserved `.invalid` TLD (RFC 2606), which cannot exist in DNS; this path
  invokes **no email subprocessor** (which is exactly why it ships before the
  adult-invite email path and its DPA gate).
- **Data minimisation** — no DOB, no real email, no marketing surface. The child's
  only PI is a display name + a synthetic handle, on the least-exposed docs.
- **Least exposure** — synthetic email lives on `userPrivate` (subject + parent
  only); siblings can't read it.

**Threat model additions (extend the existing M-series in `.context/threat-model.md`):**

| Vector | Mitigation |
|---|---|
| Child-creation spam / resource abuse | parent-only + App Check + rate limit (5/hr) + per-family member cap (12) |
| Stolen child session mints siblings | callable requires `role=='parent'`; a child is a member → denied |
| `loginCode`/handle enumeration | `familyLoginCodes` server-only; ~30-bit code; sign-in still needs the password; Firebase Auth throttles brute force; Auth errors are generic |
| Orphaned Auth user on partial failure | compensating `deleteUser` on batch failure (step 11) |
| Cross-family password reset | reset callable re-derives family server-side; `childUid` must be same-family + `managed` |
| PII in logs/errors | allow-list logging (kind/familyId/actorUid/durationMs); generic caller errors; add both callables to the App-Check-literal CI grep |

No change to `.context/constraints.md` — this operates within the existing
children's-data baseline.

---

## 9. Testing plan (matches the existing gate stack)

- **`functions/test/createManagedChild.test.ts`** (mirror
  `notifyChoreApproved.test.ts`): App Check literal present (source-scan);
  UNAUTHENTICATED without auth; RESOURCE_EXHAUSTED past the limit; non-parent →
  PERMISSION_DENIED; bad handle/short password → INVALID_ARGUMENT; member cap →
  FAILED_PRECONDITION; duplicate handle → ALREADY_EXISTS; **happy path** writes the
  exact `users` + `userPrivate` shapes and returns `{childUid, loginCode, handle}`;
  **orphan cleanup** — batch failure triggers `deleteUser`; **PI-free logs** — no
  handle/name/email/password in any logged payload.
- **`functions/test/resetManagedChildPassword.test.ts`**: parent-only, same-family,
  managed-only, rate-limited, PI-free.
- **`test/rules/managed-child.test.ts`**: child self-update can't change
  `accountType`/`loginHandle`/`role`/`familyId`; parent can rename/deactivate a
  child but not flip `accountType`; `familyLoginCodes` client read+write denied;
  sibling can't read another child's `userPrivate`.
- **`e2e/authed/managed-child.spec.ts`**: parent adds child → child signs in with
  code+handle+password → dashboard → parent resets password → child signs in with
  the new one.
- **CI**: add `createManagedChild` + `resetManagedChildPassword` to the
  `enforceAppCheck: true` source-scan; coverage thresholds already enforced.

---

## 10. Rollout

- **No new billing gate** — Functions/Blaze are already live (nine deployed).
- **No new subprocessor** — the child path emails no one.
- **No data migration** — every new field is optional; `accountType` reads as
  `'standard'` for existing users.
- **No domain to buy or configure** — the synthetic identity uses the reserved
  `.invalid` TLD, so there is *no* DNS/ops step and no dependency on a custom
  domain (the app runs on `familyhq-68638.web.app`).
- **Deploy order:** rules (tolerate new fields) → functions → hosting; then flip
  `VITE_MANAGED_CHILD_ENABLED` for a staged cohort. `deploy.yml` is already
  human-gated with a smoke check.

---

## 11. Decisions — RESOLVED

1. **Child login UX** — ✅ **Family code + username + password** (Option A) is the
   credential; QR is a later convenience layer, not a replacement.
2. **Store `birthYear`?** — ✅ **No.** No age/DOB collected at all; parent-mediated
   creation is what carries consent. (Do not add the field.)
3. **Synthetic identity domain** — ✅ **Reserved `.invalid` TLD** (RFC 2606). No
   custom domain, no DNS, no purchase. Format `${handle}@${loginCode}.familyhq.invalid`.
4. **Ship `resetManagedChildPassword` in v1?** — ✅ **Yes.**
5. **Caps** — ✅ Defaults: member cap **12**, create-rate **5/hr/parent**, password
   min length **8**. (Tunable constants; revisit if real usage argues otherwise.)
6. **Fast-follow (out of scope):** "child turns 13 → convert to a real email
   account" migration — tracked as Tier-1, not built here.

---

## 12. Work breakdown (maps to the agent roster)

| # | Owner | Deliverable |
|---|---|---|
| T1 | architect + threat-modeler | lock §11 decisions; add the M-series rows to `threat-model.md` |
| T2 | test-writer | types + failing function/rules/e2e tests per §9 (read-only for the implementer) |
| T3 | implementer | model fields + converters; both callables; rules deltas (§6); Add-a-child + kid-login + reset UI; feature flag |
| T4 | security-reviewer + privacy-reviewer | review vs constraints (children's data, PI-free logs/errors, App Check literal) |
| T5 | verifier | full gate stack incl. new rules + functions suites |
| T6 | deployer | no-MX domain; rules → functions → hosting; staged flag flip + smoke check |

**Estimate:** ~1 sprint. The two callables and rules deltas closely mirror existing
patterns; the only genuinely new surface is the kid sign-in UX.
