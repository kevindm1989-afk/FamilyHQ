# Family HQ — Threat Model (STRIDE)

**Status:** Proposed planning artifact. No code is written. Produced after the
architect's system design (`design/system-design.md`) and the decisions
(`.context/decisions.md`). The user reviews this at the human gate together with
the design before any implementation begins.

**Author:** threat-modeler agent · **Date:** 2026-05-26

**Inputs consumed:** `design/system-design.md` (§2.3 trust boundaries TB1-TB4,
§2.4 security-rules strategy, §3 failure-mode analysis F1-F10);
`.context/decisions.md` (ADR-0001..0007); `.context/constraints.md` (tenant
isolation #1, PIPEDA in force, children under 13 are users, allowance =
tracked-numbers-only).

**Scope check passed.** The architect produced trust boundaries (TB1-TB4) and
PI/PI-child markings on the data model. PHIPA/PCI/FIPPA are explicitly out of
scope (no health, no real money, no government data) per constraints; this model
does not invent them. Quebec Law 25 / COPPA / GDPR-K are pre-launch triggers and
noted, not modeled in depth.

---

## 0. The one risk that dominates this model

**Cross-tenant leakage of children's personal information.** One Firebase
project holds every family's data; the ONLY thing between family A and family B's
children is `firestore.rules` (ADR-0001 chose field-based isolation over
path-based, so isolation is rule-enforced, not structural). A single missing
`familyId` predicate is a confidentiality breach of children's data across
unrelated households — which crosses PIPEDA's "real risk of significant harm"
line and triggers OPC + individual breach notification (constraints §PIPEDA
s.10.1). Section 3 treats this exhaustively. Everything else is subordinate.

---

## 1. Data flows, classification, residency, retention

### 1.1 Data-flow inventory (source → sink, transport, payload, boundary)

| ID | Flow | Source → Sink | Transport | Payload (classification) | Boundary |
| -- | ---- | ------------- | --------- | ------------------------ | -------- |
| DF1 | Auth login/signup | PWA → Firebase Auth | TLS 1.2+ | email **[PI]** (adults), password (secret), UID | TB-Auth (within Google) |
| DF2 | Family-scoped read/list | PWA → Firestore | TLS 1.2+, SDK, gated by rules | user names **[PI/PI-child]**, post content **[PI/PI-child]**, chores, events, balances | **TB1** |
| DF3 | Family-scoped write/create | PWA → Firestore | TLS 1.2+, SDK, gated by rules | same as DF2 + immutable `familyId` | **TB1** |
| DF4 | Signup bootstrap batch | PWA → Firestore | TLS 1.2+, atomic `writeBatch`, gated by rules | new `families` doc + parent `users` doc (`role=parent`, `familyId`) | **TB1** (the self-create seam, ADR-0006) |
| DF5 | Allowance approval txn | PWA → Firestore | TLS 1.2+, `runTransaction`, gated by rules | chore status flip + `allowanceBalance` increment + `transactions` ledger doc | **TB1** |
| DF6 | Invite call | PWA → Invite Cloud Function | TLS 1.2+, HTTPS callable, auth token | target email **[PI]** (adult) or display name + parent-set password (child), `familyId`, `role` | **TB2** |
| DF7 | Member account mint | Invite Function (Admin SDK) → Auth + Firestore | internal, **bypasses rules** | new Auth user + `users` doc with server-set `familyId`/`role`/`isActive` | inside trusted context, lands at TB1's data |
| DF8 | Adult setup email | Invite Function → email subprocessor | TLS, provider API | adult email **[PI]** + setup link. **No child PI ever.** | **TB3** (cross-border candidate) |
| DF9 | On-device persistence | Firestore SDK → IndexedDB cache | local | all family data the user can read, incl. child names/content **[PI-child]** | **TB4** |
| DF10 | Offline write replay | IndexedDB queue → Firestore | TLS 1.2+, on reconnect, gated by rules | queued mutations, LWW per field | **TB1** (+TB4 origin) |
| DF11 | Function logs / metrics | Function → Cloud Logging | internal | familyId + actor UID + deny counts only — **PII-scrubbed** (§2.8) | observability (not a data sink for PI) |

### 1.2 Store classification, residency, retention

| Store | Classification | Residency | Retention | Deletion mechanism |
| ----- | -------------- | --------- | --------- | ------------------ |
| `families` | low (family name, createdBy) | Firebase region **UNDECIDED — human gate** (default closest Canadian) | life of family; delete on family closure | real delete, tenant-scoped (Task 19) |
| `users` | **PI / PI-child** (name; email for adults; balance) | same | life of membership; deactivation ≠ deletion | deactivate = `isActive:false` (data retained, dignity); guardian deletion = real delete |
| `posts` | **PI / PI-child** (content, authorName) | same | **UNDEFINED — retention schedule is a human gate** | real delete, tenant-scoped |
| `events` | low–PI (titles may name a child) | same | retention schedule TBD | real delete |
| `chores` | low–PI (assignedTo a child) | same | retention schedule TBD | real delete |
| `transactions` | integrity-sensitive (append-only ledger) | same | retention schedule TBD — ledger should not be casually purged | real delete only on family/account deletion |
| `invites` | **PI** (adult email) | same | until accepted or expiry; should auto-expire | real delete on claim/expiry |
| `rateLimits` | low (doc id embeds `callerUid` — a system identifier; payload is `{count, windowStartMs, expiresAt}` only) | `northamerica-northeast1` | **7 days** after `windowStartMs`; enforced via Firestore TTL policy on `expiresAt` (operator activates per ADR-0015) | TTL policy (server-side); no client access (`firestore.rules` deny-all + `test/rules/rateLimits.test.ts`) |
| `userPrivate/{uid}/fcmTokens` | **PI** (FCM device handle; tokenHash is SHA-256/24-hex of token) | same | until stale-token cleanup (M37) or member sign-out | real delete on stale FCM code or sign-out |
| Auth user records | **PI** (email, credential) | Google-managed | life of account | delete on guardian deletion request |
| IndexedDB cache (TB4) | **PI / PI-child** | on-device only | until sign-out / cache clear | `clearIndexedDbPersistence` on sign-out (ADR-0005) |
| Email subprocessor logs | **PI** (adult email) | **provider region — cross-border human gate** | per provider DPA | provider-controlled; require deletion in DPA |
| Breach records | metadata | Canada | **24 months** (PIPEDA s.10.1) | retained, then purge |

**PI-purpose check (constraints §"For any new data field"):** every PI field in
the data model maps to a shipped feature purpose — `name` (display/identify
member), adult `email` (login + invite delivery), `allowanceBalance`/`transactions`
(allowance tracking), `posts.content` (the bulletin board feature). **No
birthdate, location, device ID, or contacts** are collected — consistent with
the children's-data minimization rule. **Open flag:** child `email` shape (ADR-0006
open question Q3) — prefer email-less child credential; a synthetic email is
acceptable only if it carries no real deliverable address. **Retention is
undefined for posts/events/chores/transactions — this is an existing human gate
(design §7 item 6) and must be set before launch; a PI field with no retention
rule is a latent breach.**

### 1.3 Trust boundaries (restated for this model)

- **TB1 client ↔ Firestore.** Client fully untrusted. `firestore.rules` is the
  sole authorization layer. Carries DF2-DF5, DF10. **Highest blast radius.**
- **TB2 client ↔ Invite Function.** Function runs Admin SDK and **bypasses
  rules**; it MUST re-derive trust from the caller's token + their `users` doc.
  Carries DF6.
- **TB3 Function ↔ email subprocessor.** Adult email **[PI]** crosses to a third
  party (DF8). DPA + region scrutiny. **No child PI ever crosses.**
- **TB4 device ↔ on-device cache.** Family data (incl. child PI) at rest in
  IndexedDB (DF9). Must clear on sign-out/account-switch.

---

## 2. STRIDE per trust boundary

Each entry is system-specific and ends in a testable mitigation. Likelihood (L)
and Impact (I) are low/med/high; Priority is the product, flagged if med-high+.
Mitigation IDs (M#) are consumed by the table in §8.

### 2.1 TB1 — client ↔ Firestore

**Spoofing**
- **T1.1** A client forges `familyId` in its request body to read another
  family's docs. *L: high · I: high · Priority: CRITICAL.* The caller's
  `familyId` must be derived server-side from `get(users/$(uid)).data.familyId`
  (`callerFamily()`), **never** trusted from `request.resource` on reads/lists.
  **Mitigation M1:** every read/list rule compares the resource's `familyId`
  against `callerFamily()`; an emulator test signs in as family-A and is denied a
  family-B doc read even when supplying B's `familyId` client-side.
- **T1.2** Unauthenticated client reads any collection. *L: med · I: high.*
  **Mitigation M2:** every rule requires `isSignedIn()`; emulator test: anonymous
  read of each collection → denied.

**Tampering**
- **T1.3** A user edits their own `users` doc to set `role:'parent'`,
  `familyId:<other>`, `isActive:true`, or `allowanceBalance:999`. *L: high · I:
  high · Priority: CRITICAL (F2).* **Mitigation M3:** on subject self-update,
  `immutable('role') && immutable('familyId') && immutable('email') &&
  immutable('isActive') && immutable('allowanceBalance')`; subject may change
  only `name` and `theme`. Tamper tests per field → denied.
- **T1.4** A member writes a chore they are not assigned, or skips the legal
  status transition (e.g. self-approves `pending → approved` to credit
  themselves). *L: high · I: high · Priority: CRITICAL.* **Mitigation M4:** member
  chore writes require `assignedTo == uid` AND status transition `pending →
  complete` only; `approved`/`rejected`/balance changes are parent-only. Tests:
  member self-approve → denied; member edits another's chore → denied.
- **T1.5** `familyId` mutated on any tenant doc after create. *L: med · I: high.*
  **Mitigation M5:** `immutable('familyId')` on every tenant-collection update;
  test mutating `familyId` on a post/chore/event → denied.

**Repudiation**
- **T1.6** A parent denies approving an allowance credit / deactivating a member.
  *L: low · I: med.* **Mitigation M6:** `transactions` is append-only with
  `createdAt` + actor; chore carries `createdBy`; deactivation is parent-only and
  attributable. Test: `transactions` doc update/delete by anyone → denied
  (append-only).

**Information disclosure**
- **T1.7** An unconstrained `list`/collection query returns docs across families
  because the rule allows list without forcing the `familyId` predicate. *L: high
  · I: high · Priority: CRITICAL (F1).* Firestore evaluates list rules against
  the query, not per-doc — a permissive list rule leaks the whole collection.
  **Mitigation M7:** list rules require the query be constrained to
  `where('familyId','==', callerFamily())`; an emulator test issues an
  unconstrained `collection()` list and a cross-family `where` list → both
  denied; only the own-family constrained query succeeds. **Security-critical.**
- **T1.8** Error/exception text leaks internal state or another user's data to the
  client. *L: med · I: med.* **Mitigation M8:** all mutations route through a
  feature service mapping errors to generic PII-free toasts (§2.6); test asserts
  no PII/document content in surfaced error copy.

**Denial of service**
- **T1.9** A signed-in member issues many broad reads to drive Firestore read
  cost / rules `get()` cost up. *L: med · I: low–med.* **Mitigation M9:**
  per-family data is small and queries are family-scoped (bounded result sets);
  Firebase App Check enabled to reject non-app clients; budget alerts (F10).
  Test: App Check required — a request without a valid app token is rejected.
- **T1.10** Cheapest takedown is exhausting Firestore quota via automated writes.
  *L: low · I: med.* **Mitigation M9** (App Check) + write-shape validation in
  rules limits abuse.

**Elevation of privilege**
- **T1.11** A member elevates to parent via self-update (covered T1.3) OR via the
  signup self-create path being replayed (see §4). *L: med · I: high · Priority:
  CRITICAL (F2).* **Mitigation M3 + M10** (see §4 non-generalizability proof).

### 2.2 TB2 — client ↔ Invite Cloud Function

**Spoofing**
- **T2.1** A non-parent or a parent-of-another-family calls the invite Function
  to create an account in a family they don't belong to. *L: high · I: high ·
  Priority: CRITICAL (F6).* The Function bypasses rules, so it must independently
  re-verify. **Mitigation M11:** the Function (a) requires `context.auth`, (b)
  reads the caller's `users` doc server-side, (c) asserts
  `role=='parent' && isActive==true`, (d) asserts the target `familyId` equals the
  caller's own `familyId` (never accepts a `familyId` from the request payload as
  authority). Tests: non-parent caller → rejected; parent of family A passing
  family B's id → rejected; deactivated parent → rejected.

**Tampering**
- **T2.2** Caller passes `role:'parent'` to mint a co-parent without authority, or
  injects an arbitrary `familyId`/`uid`. *L: med · I: high.* **Mitigation M12:**
  the Function sets `familyId`, `role`, `isActive`, `allowanceBalance:0`
  server-side from verified caller context; request-supplied authority fields are
  ignored. Test: payload with forged `familyId`/elevated `role` → server values
  used, not payload values.

**Repudiation**
- **T2.3** A parent denies sending an invite / creating a child account. *L: low ·
  I: med.* **Mitigation M13:** Function logs each invite attempt with
  `familyId` + actor `uid` + outcome (never invitee child name/email content,
  §2.8). Test: log assertion present; log scrub test (§2.5).

**Information disclosure**
- **T2.4** Function error or response leaks whether an email already exists / leaks
  internal IDs (account enumeration). *L: med · I: med.* **Mitigation M14:**
  Function returns a generic success/failure; no enumeration oracle; logs scrub
  PII. Test: same response shape for new vs existing email.

**Denial of service / abuse**
- **T2.5** Invite spam: a parent (or compromised parent session) floods invites,
  driving email cost and creating junk accounts. *L: med · I: med · Priority:
  flagged (F6).* **Mitigation M15:** per-parent + per-family rate limit on the
  Function AND a per-family member cap. Tests: N+1th invite within the window →
  rejected; invite beyond member cap → rejected.

**Elevation of privilege**
- **T2.6** Caller tricks the Function into creating a `role:'parent'` account in
  another family, or into attaching a member to a family the caller doesn't own.
  *L: med · I: high · Priority: CRITICAL.* **Mitigation M11 + M12** (server-derived
  family + role authority).

### 2.3 TB3 — Function ↔ email subprocessor

**Spoofing**
- **T3.1** A spoofed/compromised provider endpoint receives adult emails. *L: low ·
  I: med.* **Mitigation M16:** provider API over TLS with a server-held API key
  (secret-managed, never client-side); pin the provider domain. Test: outbound
  email path uses configured provider host over TLS.

**Tampering / Information disclosure**
- **T3.2** Adult email **[PI]** crosses to a third party / possibly cross-border.
  Child PI must never cross. *L: med (data exposure inherent to the integration) ·
  I: med · Priority: cross-border human gate.* **Mitigation M17:** child invite
  path sends NO email and passes NO child PI to TB3; only adult email + a setup
  link cross. **Cross-border transfer flagged for human approval (see §6).** Test:
  child-invite flow makes zero calls to the email subprocessor.

**Denial of service**
- **T3.3** Subprocessor outage blocks adult invites. *L: low · I: low (F7).*
  **Mitigation M18:** adult-email path is non-critical and disabled until
  approved; child-member creation (no email) is unaffected. Test: with email
  provider disabled, child invite still succeeds.

**Repudiation / EoP:** N/A at this boundary — the Function is the only caller and
is attributable via DF11 logs.

### 2.4 TB4 — device ↔ on-device Firestore cache

**Spoofing**
- **T4.1** After sign-out or account-switch on a shared device, the next user (or
  a different family member) reads the previous user's cached family data —
  including child PI — from IndexedDB. *L: med · I: high · Priority: CRITICAL.*
  **Mitigation M19:** on sign-out AND on account switch, terminate Firestore and
  call `clearIndexedDbPersistence()` before the next auth session initializes.
  Test (integration): after sign-out, IndexedDB Firestore cache contains no
  family documents; signing in as a different family shows none of the prior
  family's data.

**Information disclosure**
- **T4.2** Cached child PI persists at rest on a lost/stolen/shared device. *L: low
  · I: high.* **Mitigation M20:** cache holds only data the signed-in user is
  entitled to (never cross-family — TB1 guarantees the cache is populated only by
  authorized reads); rely on OS disk encryption; M19 clears on sign-out. Test:
  cache never contains a doc whose `familyId` ≠ the signed-in user's family.

**Tampering**
- **T4.3** A user edits IndexedDB directly to forge a cached doc (e.g. fake
  `role:parent`), then the app trusts it for UI gating. *L: low · I: med.*
  **Mitigation M21:** the cache is a read accelerator only; all authority
  decisions are re-enforced server-side by rules on the next op. UI gating is
  cosmetic — never the security boundary. Test: a tampered cached `role` does not
  grant any server-side write (rules deny).

**Denial of service / Repudiation / EoP at the device layer:** out of scope —
local-device compromise is the user's own data; cross-tenant reach is prevented
by TB1, not TB4.

---

## 3. Deepest treatment — every cross-tenant leakage path (F1)

This is the #1 risk. Below is the exhaustive enumeration the brief demands. Each
path → the precise rule/code defect that causes it → a testable mitigation. All
are **security-critical: no autonomous merge.**

| Path | How the leak happens | Testable mitigation |
| ---- | -------------------- | ------------------- |
| **P1 — missing `familyId` predicate on read** | A `get`/read rule for a collection omits the `sameFamily(resource)` check; any signed-in user reads any doc by id. | **M1.** Emulator test per collection: family-A user reads a known family-B doc id → **denied**. Every read rule asserts `isSignedIn() && isActive() && sameFamily(resource)`. |
| **P2 — unconstrained list query** | A `list` rule allows `allow list: if isSignedIn()` without forcing the query to filter by `familyId`; Firestore returns the whole collection. | **M7.** Test: unconstrained `collection(x).get()` → denied; `where('familyId','==', otherFamily)` → denied; only `where('familyId','==', myFamily)` → allowed. List rules require the query carry the own-family equality filter. |
| **P3 — `get()`-based rule tricked** | A rule trusts `request.resource.data.familyId` (client-supplied) instead of `callerFamily()` (server-read from the caller's own user doc), so a forged incoming `familyId` matches itself. | **M22.** Reads/lists derive family ONLY from `callerFamily()`. Creates use `incomingSameFamily()` (`request.resource.data.familyId == callerFamily()`) so the new doc's family must equal the caller's real family. Test: create with a foreign `familyId` → denied. |
| **P4 — create writes into another family** | A `create` rule checks `isParent()` but not that the new doc's `familyId == callerFamily()`. | **M22 + M23.** Every create requires `incomingSameFamily()`. Test: parent of A creates a chore/post/event with `familyId:B` → denied. |
| **P5 — Function acts on the wrong family (TB2)** | The Admin-SDK Function trusts a `familyId` from the request and mints/attaches a user into a family the caller doesn't own. | **M11 + M12.** Function derives target `familyId` from the verified caller's own `users` doc; ignores request-supplied family/role. Tests: parent-of-A invites into family B → rejected; payload `familyId` ignored. |
| **P6 — on-device cache survives sign-out / account switch (TB4)** | IndexedDB retains family-A docs; a family-B login on the same device surfaces stale A data. | **M19.** `clearIndexedDbPersistence()` on sign-out and before a new auth session. Test: post-sign-out cache empty; new-family login shows zero prior-family docs. |
| **P7 — `users` doc cross-family read** | `users` read rule lets any signed-in user read any `users/{uid}` (member lists, balances) regardless of family. | **M1 applied to `users`.** A `users` read requires `sameFamily`. Test: family-A user reads family-B `users/{uid}` → denied. |
| **P8 — `families` doc cross-read** | `families/{id}` readable by any authenticated user, not just that family's active members. | **M24.** `families` read requires caller be an active member of THAT family (`callerFamily() == familyId`). Test: read another family's `families` doc → denied. |
| **P9 — `invites` cross-family read/list** | Invite docs (adult emails) readable across families. | **M25.** `invites` read/list/write parent-only AND `sameFamily`. Test: read another family's invite → denied; member reads own-family invite → denied (parent-only). |
| **P10 — `transactions`/`allowanceBalance` cross-read** | Ledger or balances of another family's child readable. | **M1 applied to `transactions` + `users`.** Test: cross-family `transactions` list/read → denied. |
| **P11 — deactivated user retains read reach** | `isActive()` omitted from a read predicate; a removed member still lists family data. | **M26.** `isActive()` is part of EVERY authenticated predicate (read, list, write, create). Test: `isActive:false` user → every op denied (see §5). |
| **P12 — query result leak via aggregate/count** | A count or aggregate query bypasses the family filter. | **M7 extended.** Aggregate queries also require the `familyId` filter; test count over another family → denied. |

**Defense-in-depth note:** ADR-0001 deliberately chose field-based isolation, so
there is no path-structural backstop — P1/P2/P3 are the live failure modes and
their tests are mandatory before merge (design Task 5, security-critical). A
future hardening option (noted, not required now) is caching `familyId`/`role` in
a custom Auth claim to reduce reliance on `get()` and shrink the trick surface of
P3.

---

## 4. Proof that the signup self-create predicate (ADR-0006) is non-generalizable

**The danger:** the founding-parent bootstrap (DF4) is the ONE place a client may
self-create a `users` doc with `role=='parent'` and self-set a `familyId`. If
that rule generalizes, any existing member could replay it to (a) elevate
themselves to parent, (b) reassign themselves to / create a second family, or (c)
join another family. This is the single most dangerous predicate in the app.

**The exact properties the rule + tests MUST guarantee (all conjunctive):**

The `allow create` on `users/{uid}` with `role=='parent'` is permitted **only
when ALL hold**:

1. **Self-keyed:** `uid == request.auth.uid`. (You can only create your own user
   doc.) — blocks creating a doc for someone else.
2. **No pre-existing user doc:** `!exists(/databases/$(db)/documents/users/$(request.auth.uid))`.
   This is the linchpin — an *existing* member, by definition, already has a
   `users` doc, so the create can never fire for them. This is what makes the
   rule **non-replayable by an existing member**: the predicate is structurally
   unavailable to anyone who already exists in the system.
3. **Family freshly created in the same atomic batch by this caller:** the
   referenced `families/{familyId}` is being created in the same write with
   `createdBy == request.auth.uid`. The rule asserts
   `request.resource.data.familyId == <the family created in this batch>` and the
   `families` create rule asserts `createdBy == request.auth.uid`. — blocks
   attaching yourself to a pre-existing/other family.
4. **Bootstrap field shape fixed:** `isActive == true`, `allowanceBalance == 0`,
   `role == 'parent'`, and no extra authority fields. — blocks smuggling state.

**Why each abuse is impossible:**

- *Existing member self-elevates to parent* → blocked by **(2)**: they already
  have a `users` doc, so `!exists()` is false; the create rule never applies, and
  an *update* to `role` is blocked by `immutable('role')` (M3). There is no path.
- *Existing user creates/joins a second family* → blocked by **(2)** (can't
  re-create their own user doc) and **(3)** (the family must be created in the
  same batch with `createdBy == self`, and their existing user doc's `familyId` is
  `immutable` per M5/M3). They cannot point themselves at a new or other family.
- *Attacker creates a parent doc for another UID* → blocked by **(1)**.
- *Member becomes parent of their OWN existing family* → blocked by **(2)** +
  `immutable('role')`.

**Testable mitigation M10 (security-critical, no autonomous merge):**
- Test A: a fresh UID with no `users` doc creates `families` + `users(role=parent)`
  in one batch, `familyId` matching the new family → **allowed**.
- Test B: same fresh UID attempts to self-create `users` pointing at an
  *existing* `familyId` (not created in this batch) → **denied** (property 3).
- Test C: an existing member (already has a `users` doc) replays the bootstrap
  create → **denied** (property 2, `!exists`).
- Test D: an existing member updates own `role` to `parent` → **denied** (M3).
- Test E: bootstrap with `isActive:false` or `allowanceBalance != 0` or extra
  fields → **denied** (property 4).
- Test F: create a `users` doc for a *different* UID → **denied** (property 1).
- Test G: signup batch where the `families` doc has `createdBy != request.auth.uid`
  → **denied** (property 3).

---

## 5. The other named failure modes — testable mitigations

### 5.1 Role / familyId immutability (F2)
Covered by **M3** (subject self-update: `role`, `familyId`, `email`, `isActive`,
`allowanceBalance` immutable; only `name`/`theme` editable) and **M5**
(`immutable('familyId')` on all tenant docs). Tests: per-field tamper on own
`users` doc → denied; `familyId` mutation on any tenant doc → denied.

### 5.2 Deactivated user (`isActive:false`) access (F3)
**M26:** `isActive()` is part of every authenticated predicate, not just UI
gating. The deactivation itself is parent-only and writes `isActive:false`
(retains data — dignity, per constraints). Tests: a user with `isActive:false`
attempts each op (read/list/create/update on each collection, and an invite call)
→ **all denied**. UI bounce is cosmetic and not the boundary.

### 5.3 Allowance double-credit / race (F4)
**M27 (security-relevant):** approval is a single `runTransaction` that (1)
re-reads the chore and aborts unless `status == 'complete'` and `sameFamily`, (2)
flips `complete → approved`, (3) `increment(allowanceBalance, dollarValue)`, (4)
appends one `transactions` doc. Idempotency is the status guard — a second
approve sees status ≠ `complete` and aborts. Rules additionally require the
balance writer be a same-family parent and the delta non-negative. Tests:
- Double-approve (sequential) credits **exactly once**; second yields no balance
  change and no second ledger doc.
- Concurrent-approve (two parallel transactions) credits **exactly once** (one
  commits, the other aborts on the status guard).
- Reject path sets `status='rejected'` + `rejectionReason`, **no** balance write,
  no ledger doc.
- A non-parent or cross-family parent attempting the balance write → denied.
- A balance write **not** accompanied by the matching chore transition + ledger
  doc → denied (M28: balance writes gated by the transaction shape).

### 5.4 Invite abuse — spam + cross-family account creation (F6)
Covered by **M11** (server-verified active-parent-of-own-family), **M12**
(server-set authority fields), **M15** (rate limit + per-family member cap),
**M17** (no email/PI to children at TB3). Tests as listed in §2.2.

### 5.5 Offline write conflict (F5)
**M29 (accepted-risk, documented):** Firestore resolves offline replays
last-write-wins per field (ADR-0005). At family scale this is accepted. The
*integrity-sensitive* path (allowance) is NOT exposed to silent LWW loss because
approval runs in a transaction with a status guard (M27) — a stale offline
"approve" replayed after another parent approved will find `status != complete`
and abort rather than double-credit. Tests:
- An offline-queued allowance approval replayed after a server-side approval →
  aborts (no double credit) — this is the security-relevant assertion.
- Document (ADR-0005) that concurrent offline edits to non-integrity fields
  (e.g. a post body) resolve LWW; surfaced, not silently lost beyond LWW.

---

## 6. Cross-border transfers (human-gate, never silent)

| Transfer | Data | Destination | Safeguards required | Status |
| -------- | ---- | ----------- | ------------------- | ------ |
| **CB1 — Firebase region** | ALL family data incl. child PI (DF2-DF5, DF9 origin) | Google Cloud region **UNDECIDED** (permanent at project creation) | Choose closest Canadian region; document if not in Canada | **HUMAN GATE — design §7 item 2.** Default Canadian region. |
| **CB2 — Email subprocessor** | adult email **[PI]** + setup link only (DF8); **never child PI** | provider region (likely US unless Canadian/configurable region chosen) | DPA, vendor risk assessment, configurable/Canadian region preferred, TLS, key in secret store | **HUMAN GATE — design §7 item 4.** Adult-email path stays disabled until approved. |

Both transfers are flagged for explicit human approval. CB2 must not be enabled
in code until the DPA and region are approved; CB1 must be set before any data
exists.

---

## 7. Breach scenarios & PIPEDA notification triggers

PIPEDA s.10.1 requires notifying the **OPC** and **affected individuals** as soon
as feasible when a breach creates a **real risk of significant harm (RROSH)**, and
keeping **breach records for 24 months** regardless of severity (constraints
§PIPEDA). Quebec Law 25 adds a parallel CAI notification if a Quebec resident is
ever served (pre-launch trigger).

- **B1 — Cross-tenant child-data exposure (from P1-P12, F1).** *Crosses RROSH —
  YES, notify.* A missing `familyId` predicate lets family B read family A's
  children's names, post content, chores, and balances. Children's PI exposed
  across unrelated households is significant harm (humiliation, safety,
  identity). **Triggers OPC + individual (guardian) notification, breach record
  (24 mo), and an OPC-response decision (human gate).** This is the scenario the
  whole model is built to prevent.
- **B2 — Role elevation / tenant reassignment (F2).** *Crosses RROSH if it yields
  cross-tenant read — YES.* A member who elevates to parent or jumps families
  gains unauthorized access to others' (possibly other-family) child data. Notify
  if any cross-family data was reachable.
- **B3 — Function mints/attaches an account in the wrong family (F6, P5).**
  *Crosses RROSH — YES.* An account created inside family A by an outsider can
  read family A's children's data. Notify.
- **B4 — On-device cache leak after account switch (TB4, P6).** *RROSH —
  context-dependent.* Family data exposed to the next device user. If the next
  user is outside the family (shared/lost device), treat as RROSH and notify;
  record regardless.
- **B5 — Adult email exposure at subprocessor (TB3, F7).** *RROSH — likely no for
  email alone, but record and assess.* Adult emails only; no child PI. Lower
  severity; still a recordable breach and a DPA-incident trigger.
- **B6 — Allowance ledger corruption (F4).** Integrity, not confidentiality; not
  a PI breach (tracked numbers, no real money). Record as a data-integrity
  incident, not a privacy breach, unless tied to a confidentiality leak.

**Mitigation M30:** a breach-record store (design Task 19) captures every B1-B5
incident with 24-month retention; notification decisions are a human gate
(constraints §Human gates). The rules-deny-rate metric (§2.8) is the early-warning
signal for B1/B2 probing.

---

## 8. Prioritized mitigations table (test-writer & reviewers consume this)

**SC = security-critical, no autonomous merge.** Owner: **test** = test-writer
writes the assertion; **impl** builds it; **sec** = security-reviewer verifies in
diff; **priv** = privacy-reviewer verifies compliance.

| Pri | Threat | Mitigation (testable assertion) | How tested | Owner | SC? |
| --- | ------ | ------------------------------- | ---------- | ----- | --- |
| 1 | P1/P7/P10 cross-tenant read (T1.1) | Every read rule: `isSignedIn() && isActive() && sameFamily(res)`; family-A denied family-B doc by id | emulator per-collection deny test | test+impl, sec | **SC** |
| 1 | P2/P12 unconstrained list (T1.7) | List rules require own-family `where` filter; unconstrained & cross-family list → denied | emulator list/aggregate deny test | test+impl, sec | **SC** |
| 1 | P3/P4 forged/foreign `familyId` on create (T1.1) | `incomingSameFamily()` on every create; foreign-family create → denied | emulator create deny test | test+impl, sec | **SC** |
| 1 | F2 role/tenant self-mutation (T1.3, T1.11) | `immutable('role'/'familyId'/'email'/'isActive'/'allowanceBalance')` on subject update; per-field tamper → denied | emulator update deny test | test+impl, sec | **SC** |
| 1 | ADR-0006 signup self-create generalizes (T1.11) | Properties 1-4 (§4); existing member replay → denied; foreign/existing familyId → denied; other-UID create → denied | emulator tests A-G (§4) | test+impl, sec | **SC** |
| 1 | P5/T2.1/T2.6 Function wrong-family / non-parent | Function verifies active-parent-of-own-family; derives family/role server-side; ignores payload authority | Function unit/integration deny tests | test+impl, sec | **SC** |
| 1 | P6/T4.1 cache survives sign-out/switch | `clearIndexedDbPersistence()` on sign-out & before new session; post-sign-out cache empty; new family sees no prior data | integration test | test+impl, sec, priv | **SC** |
| 2 | P11/F3 deactivated user acts (T?) | `isActive()` in every authenticated predicate; `isActive:false` → all ops denied | emulator deny test all collections | test+impl, sec | **SC** |
| 2 | F4 allowance double/concurrent credit | `runTransaction` + `complete→approved` status guard; balance write gated by txn shape | double-approve, concurrent-approve, reject tests | test+impl, sec | **SC** (allowance integrity) |
| 2 | T2.2/T2.6 invite role/family injection | Function sets authority fields server-side; forged payload ignored | Function test | test+impl, sec | **SC** |
| 2 | T1.4 member illegal chore write/self-approve | Member writes only `assignedTo==uid` + `pending→complete`; self-approve → denied | emulator deny test | test+impl, sec | **SC** |
| 3 | F6/T2.5 invite spam | Per-parent/per-family rate limit + member cap; over-limit → rejected | Function test | test+impl, sec | yes |
| 3 | T1.2 unauthenticated access | every rule requires `isSignedIn()`; anon read → denied | emulator deny test | test+impl, sec | yes |
| 3 | T3.2/CB2 adult-only email, no child PI to TB3 | child invite → zero subprocessor calls | Function test + diff review | test+impl, priv | yes |
| 3 | P8 `families` cross-read | read requires active member of that family | emulator deny test | test+impl, sec | yes |
| 3 | P9 `invites` cross/member read | invites parent-only + sameFamily | emulator deny test | test+impl, sec | yes |
| 4 | F5/T offline LWW double-approve | offline-replayed approve after server approve → aborts (no double credit) | offline-replay test | test+impl | yes |
| 4 | T1.8/T2.4 error/enumeration leak | generic PII-free errors; no email-exists oracle | unit test on error mapping | test+impl, priv | no |
| 4 | T2.3/T1.6 repudiation / log scrub | append-only `transactions`; logs carry familyId+uid only, no child PI/email | log-scrub test; ledger-immutability deny test | test+impl, priv | no |
| 4 | T1.9/T1.10 DoS | App Check enabled; non-app token rejected; budget alerts | App Check integration test | impl, sec | no |
| 5 | B1-B5 breach handling | breach-record store, 24-mo retention; notification = human gate | record-write test; process doc | impl, priv | no |
| 5 | CB1 Firebase region / CB2 subprocessor | closest Canadian region; DPA before enable | human gate (not autotestable) | user, priv | gate |

---

## 9. Top 5 risks (ordered)

1. **Cross-tenant read/list of children's data (F1; P1-P12).** Catastrophic, the
   reason this product is the strictest posture. Mitigations: family predicate on
   every read; own-family `where` on every list; `incomingSameFamily()` on every
   create. Security-critical, emulator-tested, no autonomous merge. → **B1 breach,
   OPC + guardian notification.**
2. **Role self-elevation / tenant reassignment, incl. signup-bootstrap replay
   (F2; §4).** A member becomes parent or jumps families. Mitigations: field
   immutability (M3) + the four non-generalizability properties of the bootstrap
   create (M10). Security-critical.
3. **Invite Function acting on the wrong family / non-parent caller (F6; P5).**
   The Admin SDK bypasses rules, so the Function must re-derive trust. Mitigations:
   server-verified active-parent-of-own-family + server-set authority fields
   (M11/M12). Security-critical.
4. **Deactivated user still acting (F3; P11).** Mitigation: `isActive()` in every
   authenticated predicate, tested across all collections (M26). Security-critical.
5. **Allowance double-credit / race (F4) + on-device cache leak on account switch
   (TB4; P6).** Integrity of the ledger via transaction+status-guard (M27); cache
   cleared on sign-out (M19). Both tested; both security-critical.

---

## 10. Handoffs

### → test-writer (required tests, grouped by priority)
- **P1 (must pass before any feature):** §8 rows priority 1 — the cross-tenant
  read/list/create deny tests, role/familyId immutability tamper tests, the
  signup self-create tests A-G (§4), the Function wrong-family/non-parent tests,
  and the cache-clear-on-sign-out integration test. These map to design Task 5
  (rules suite) and Task 15 (Function).
- **P2:** deactivated-user deny tests, allowance double/concurrent/reject tests
  (design Task 11), invite injection tests, member illegal-chore-write tests.
- **P3-P4:** rate-limit/member-cap, unauthenticated deny, child-invite-no-email,
  families/invites cross-read, offline-replay-no-double-credit, error/enumeration,
  log-scrub, App Check.
- Every assertion above is phrased as allow/deny so it converts directly to an
  emulator or Function test.

### → security-reviewer (verify in the diff)
- Top STRIDE findings to confirm in code: T1.1/T1.7 (family predicate on every
  read AND list, no unconstrained query), T1.3 (immutability on subject update),
  the §4 bootstrap predicate (properties 1-4 present and conjunctive), T2.1/T2.6
  (Function re-derives family+role server-side, ignores payload authority), F3
  `isActive()` ubiquity, F4 transaction+status-guard, T4.1 cache clear.
- Enforce: SC rows in §8 do not merge autonomously. Any rule that omits a family
  predicate, any list rule without an own-family filter, or any Function that
  trusts a request-supplied `familyId`/`role` is a blocking finding.

### → privacy-reviewer (PI flows, compliance, human gates)
- PI flows: DF1, DF2/DF3 (PI/PI-child), DF6/DF8 (adult email to TB3), DF9 (child
  PI in cache). Confirm every PI field maps to a stated purpose (§1.2) and that
  **retention is set** for posts/events/chores/transactions (currently undefined —
  human gate, blocks launch).
- PIPEDA: minimization holds (no birthdate/location/device-id/contacts);
  no behavioural tracking/analytics SDKs (verify none added); no outbound
  marketing email; child path sends no email (M17). Breach triggers B1-B5 (§7);
  24-month breach records (M30); access/deletion paths guardian-mediated
  (design Task 19).
- Cross-border: CB1 (Firebase region) and CB2 (email subprocessor) flagged below.

### → user (human-gate decisions required before code)
1. **Approve the Firebase region (CB1)** — permanent at project creation; default
   to the closest Canadian region; document if not in Canada.
2. **Approve the email subprocessor (CB2)** — DPA + vendor assessment + region;
   adult-invite email stays disabled until approved. (e.g. "approve transfer of
   adult invitee email addresses to <provider> <region> under <DPA-id>".)
3. **Approve the data-retention schedule** for posts/events/chores/transactions —
   currently undefined; a PI field with no retention rule is a latent breach.
4. **Approve `firestore.rules` / role model / tenant model / invite flow** (ADR-
   0001/0002/0003/0006) — security-critical, no autonomous merge.
5. **Confirm child credential model (ADR-0006 Q3)** — prefer email-less child
   credential so no child PI ever reaches TB3.
6. **Note future-trigger reviews:** Quebec Law 25 / COPPA / GDPR-K before any
   non-Canadian or Quebec exposure.

---

## Addendum (2026-05-27) — deferred control: last-active-parent invariant

Surfaced by adversarial review of the Phase 1-2 fixes. The `firestore.rules`
`notSelfDeactivation()` guard blocks a parent from deactivating **themselves**,
but a parent can still deactivate the **other** parent. The full "a family must
always retain ≥1 active parent" invariant cannot be enforced in security rules
alone (it requires an aggregate count of active parents per family).

**Status:** DEFERRED to Phase 3 (Family Management + the invite Cloud Function,
TB2). Enforcement options recorded for that phase: (a) a transactionally
maintained `activeParentCount` on the `families` doc, deny-on-zero; or (b) route
deactivation through the parent-only Cloud Function which counts active parents
server-side. Until then the self-deactivation guard is defense-in-depth only,
and the deactivation UI itself does not ship until Phase 3 — so the lockout
vector is not reachable by an end user in Phases 0-2. New mitigation id: **M31
(deferred)**. Test owed in Phase 3: a two-parent fixture proving the last active
parent cannot be deactivated.

---

## Addendum (2026-06-09) — Push notifications (FCM + Cloud Functions + budget kill-switch)

**Status:** Appended after the architect produced ADR-0013, ADR-0014, and
`/home/user/FamilyHQ/.context/push-notifications-design.md` on
`design/push-notifications`. This addendum models ONLY the deltas the push
feature introduces. All M1-M31, F1-F10, B1-B6, TB1-TB4, CB1-CB2 above remain
in force.

**Inputs consumed:** push-notifications-design.md §3-§9, §12; ADR-0013 §§1-11;
ADR-0014 (trigger model). Constraints.md children's-data rule, PIPEDA s.10.1,
the secrets-handling section, and the §0 cross-tenant-leakage-of-children
risk continue to dominate the priority ordering.

**Scope check:** the architect produced trust boundaries (TB5/TB6 named with
what crosses, what authenticates, who's the subprocessor) and PI markings on
every new flow (DF12-DF17). PHIPA/PCI/FIPPA remain out of scope. The
`fcmTokens` doc body holds the FCM registration token — that is a
**credential-class** value (anyone with it can send a push to that device via
FCM Admin), and is classified accordingly below.

---

### A.1 New data-flow inventory (extends §1.1)

| ID | Flow | Source → Sink | Transport | Payload (classification) | Boundary |
| -- | ---- | ------------- | --------- | ------------------------ | -------- |
| DF12 | FCM token register / refresh | PWA → Firestore `userPrivate/{uid}/fcmTokens/{tokenHash}` | TLS 1.2+, Firestore SDK, gated by rules | **token (credential)**, userAgent (PI-adjacent device fingerprint), timestamps | **TB1** |
| DF13 | Notify callable | PWA → notify-* HTTPS-callable Function | TLS 1.2+, callable, auth token + App Check token | `{kind, targetDocId}` ONLY — NEVER notification body content | **TB2** (extends invite-Function pattern) |
| DF14 | FCM send (Admin SDK) | Function (runtime SA) → FCM Admin API | internal Google API over TLS, SA auth | vague body + click-target URL + recipient tokens (credential) | **TB5 (NEW)** |
| DF15 | Push delivery | FCM → Apple APNs / Mozilla autopush / Android-FCM transport → device | TLS 1.2+ | vague body + click-target URL (rendered on lock-screen / OS shelf) | **TB6 (NEW)** — cross-border for APNs (US) and Mozilla (US/EU) |
| DF16 | Budget alert | Cloud Billing → Pub/Sub `billing-budget-alerts` → `billingKillSwitch` | internal | costAmount, budgetAmount, project metadata (no PI) | internal — no PI surface |
| DF17 | Billing detach | `billingKillSwitch` (kill-switch SA) → Cloud Billing `updateBillingInfo` | internal, SA auth | project ID + empty `billingAccountName` | internal — no PI surface |

### A.2 New stores — classification, residency, retention (extends §1.2)

| Store | Classification | Residency | Retention | Deletion mechanism |
| ----- | -------------- | --------- | --------- | ------------------ |
| `userPrivate/{uid}/notificationPreferences` (field) | low — booleans + timestamps; no PI but reveals which categories a member subscribes to | `northamerica-northeast1` (Montreal) — same project as Firestore | life of account | real delete on account deletion; subject can flip booleans |
| `userPrivate/{uid}/fcmTokens/{tokenHash}` (subcollection) | **credential** (FCM registration token) + low (userAgent) | `northamerica-northeast1` | (a) until permission revoked → client deletes; (b) until FCM returns 404/410 → server deletes (**M37**); (c) until sign-out on that device → client deletes; (d) account deletion → tenant-scoped real delete | real delete; idempotent; see M37 |
| Cloud Functions logs (push) | low (familyId, actor uid, counts, durationMs); **MUST NOT** contain child names, chore/wishlist/post titles, FCM tokens, email | Cloud Logging in `northamerica-northeast1` | per Cloud Logging default (30 days) | provider-controlled |
| `userPrivate/{uid}/iosPwaHintDismissedAt` (field) | low (timestamp) | Montreal | life of account | account deletion |
| FCM message in transit at Google FCM | vague body + token (credential) | global Google FCM (CB3) | not at rest in FCM beyond delivery TTL | provider-controlled |
| Push payload at APNs / Mozilla / Android-FCM transport | vague body + opaque device handle | US (APNs), US/EU (Mozilla autopush), global (Android FCM) | provider-controlled, transport-only | provider-controlled |

**PI-purpose check for new fields:**
- `fcmTokens.token`: required to deliver push to a specific device.
- `fcmTokens.userAgent`: required so a user can identify and revoke an old/lost device from the preferences UI ("Chrome on macOS, last seen 3 days ago"). If the preferences UI never surfaces the device list, this field MUST be dropped (data minimization, constraints §"For any new data field").
- `notificationPreferences.categories.*`: required for opt-in per category.
- `iosPwaHintDismissedAt`: required to avoid nagging the user.

**No** child name, age, location, device id, contact list, or push history is collected. Every new field maps to a shipped purpose.

---

### A.3 New trust boundaries

#### TB5 — Cloud Function ↔ Google FCM Admin API

- **What crosses:** vague notification body + click-target URL + a per-recipient list of FCM registration tokens (credentials).
- **Authentication on the far side:** the Functions runtime service account (default 2nd-gen Functions SA) calls `admin.messaging().sendEachForMulticast()` via the FCM Admin SDK; auth is the SA's metadata-server-fetched OAuth token. No long-lived key file in code.
- **Encryption:** TLS 1.2+ on the Google internal API; payload at rest at Google FCM only for the duration of the delivery TTL.
- **Logging on the far side:** FCM emits delivery/error metadata; the **token value** is treated by Google as a credential and is not exposed to operators outside the Google control plane.
- **Subprocessor identity:** Google LLC (same legal subprocessor as Firebase Authentication and Firestore — already disclosed under the Firebase relationship per ADR-0013 §11). **No new processor added by TB5.**
- **Same GCP project, same region (Montreal) for compute** — but it is still a trust boundary because (a) the Admin SDK runs under a distinct service account, (b) the FCM data plane is global (the body egresses Canada at this hop — see CB3), and (c) a compromised FCM Admin call can push to any device whose token the caller knows.

#### TB6 — Google FCM ↔ device push transport (APNs / Mozilla autopush / Android FCM transport)

- **What crosses:** vague body + click-target URL + an opaque device push handle. **This payload is what lands on the lock-screen.**
- **Authentication on the far side:** Apple APNs accepts FCM's signed delivery requests via Apple's own auth (Google ↔ Apple integration); Mozilla autopush via VAPID (the SAME public/private VAPID keypair we register on the client — server-side handled by Admin SDK); Android FCM transport is fully internal to Google.
- **Encryption:** TLS 1.2+ for FCM↔transport. Payload at the OS shelf is **plaintext to the device user** (lock-screen rendering); this is intentional, but it means **anyone who picks up an unlocked-or-glanceable phone reads the body**. This is the entire reason for vague-body-by-default (M34).
- **Logging on the far side:** APNs and Mozilla autopush retain delivery metadata; vendors assert payloads are not retained at rest beyond delivery, but a threat model treats this as **worst-case visible to the transport operator**.
- **Subprocessor identity (NEW, may require disclosure):**
  - **Apple Inc.** — for iOS push (APNs).
  - **Mozilla Corporation** — for Firefox push (autopush).
  - **Google LLC (Android FCM transport)** — already disclosed as part of Firebase.
  Flag for the privacy lawyer (see F11 and human gates) — APNs and Mozilla autopush may need explicit subprocessor disclosure in the privacy policy. Do NOT auto-decide.
- **Cross-border:** Yes (CB3 + CB4). See §A.7.

---

### A.4 STRIDE for the new boundaries

#### A.4.1 TB5 — Function ↔ FCM Admin API

**Spoofing**
- **T5.1** A non-functions caller obtains the runtime SA credentials (compromised SA key, log leak, dependency-injection of `GOOGLE_APPLICATION_CREDENTIALS`) and uses the FCM Admin SDK to send arbitrary pushes to any device whose token they can guess or harvest. *L: low (no key file is created or stored; ADC via metadata server) · I: high · Priority: med-high.* **Mitigation M32** (see §A.5).
- **T5.2** A compromised dependency in the Functions runtime calls `admin.messaging()` to send rogue pushes from inside the trusted process. *L: low · I: high · Priority: med-high.* **Mitigation M33** (least-privilege SA + no `roles/owner`); **Mitigation M40** (dependency audit on every CI build, already constraint).

**Tampering**
- **T5.3** A man-in-the-middle on the Google internal API path tampers with the notification body or recipient list. *L: very low (TLS + Google backbone) · I: low · Priority: low.* Accepted, no specific control beyond TLS.

**Repudiation**
- **T5.4** A push send is later disputed ("I never approved this chore — why was a notification sent?"). *L: low · I: low.* **Mitigation M38** — structured per-send log carries `{kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs}` and the corresponding state-change `transactions`/`chores` doc is already attributable via existing rules (M6). Together they reconstruct who fired what.

**Information disclosure**
- **T5.5** Recipient tokens are logged at `info` level or returned in a callable response, leaking credentials that allow rogue pushes. *L: med · I: high · Priority: HIGH.* **Mitigation M38** — log scrubber asserts no field named `token`, `body`, `name`, `email`, `choreTitle`, `wishlistTitle`, or any value matching the FCM token shape is emitted at any level. Callable response shape is `{ sent: number, cleaned: number }` only — no token echo.
- **T5.6** Error path returns the FCM error code verbatim to the client (e.g. `messaging/registration-token-not-registered`), giving the caller a token-validity oracle. *L: med · I: med.* **Mitigation M39** — callable maps all FCM errors to the generic `{ sent: 0, cleaned: 0 }` shape (no `reason` field per PR D privacy hardening; the reason classification appears only in the structured server log as `skipReason`); only server logs carry the detail.

- **T5.6b** Callable response shape leaks recipient preference state via a discriminable `reason` field (`'opted_out'` vs `'no_tokens'`); a caller flips a recipient's toggle, observes which `reason` returns, and exfiltrates aggregate preference state of other family members. *L: med · I: med (acute for under-13 recipients per Law 25 sensitive-info baseline).* **Mitigation M39 (revised PR D)** — drop `reason` from the response across all 7 notify-callables; skip classification is preserved server-side as the `skipReason` M38 allow-listed log field only. Test: every skip branch returns exactly `{ sent: 0, cleaned: 0 }`.

**Denial of service**
- **T5.7** An attacker spams a notify-callable from a script (no real app) to mint Function invocations, burn invocation count, and trip the $5 kill-switch — taking ALL push (and any future Blaze feature) down for the project. *L: med · I: high · Priority: HIGH.* **Mitigation M32** — App Check (Firebase App Check with reCAPTCHA Enterprise on web) **mandatory** on every notify-callable; missing-or-invalid App Check token → callable rejects before doing any work. **Mitigation M36** — per-actor + per-family rate limit on each callable (cheap in-memory token bucket keyed on actor uid; on cold start the bucket resets, which is fine because the kill-switch is the ultimate ceiling).
- **T5.8** An attacker with a stolen valid App Check token + valid user session abuses the callable directly. *L: low · I: med.* **Mitigation M36** (rate limit) + **M35** (cross-tenant guard; even an authenticated abuser cannot fan out beyond their own family).

**Elevation of privilege**
- **T5.9** A bug in one notify-callable allows it to call other Google APIs the runtime SA also has rights to (e.g. Firestore-rules-bypass writes, billing changes). *L: low · I: high · Priority: HIGH.* **Mitigation M33** — Functions runtime SA is granted FCM send rights and Firestore data-access rights (Admin SDK still bypasses rules, that is unavoidable for the callable to read recipient `userPrivate`), but **explicitly NOT** `roles/owner`, `roles/billing.*`, or `roles/iam.serviceAccountTokenCreator`. The kill-switch SA is a SEPARATE identity (M33b) with `roles/billing.projectManager` ONLY.

#### A.4.2 TB6 — FCM ↔ device push transport

**Spoofing**
- **T6.1** An attacker who has obtained a target's FCM token (from a leaked log, a stolen device backup, or — pre-mitigation — a permissive Firestore rule) sends crafted pushes to the device by impersonating our Functions environment. *L: low (requires a separate compromise to get a token AND FCM Admin credentials) · I: low (vague body; click-target opens our app which re-authenticates) · Priority: low.* Accepted: the token alone, without our SA, cannot reach FCM Admin. See B7 for the full attack-surface analysis.

**Tampering**
- **T6.2** A transport-layer operator (APNs, Mozilla autopush) modifies the body before delivery. *L: very low · I: low.* Accepted; transport is a trusted Google→Apple/Mozilla path.

**Repudiation**
- N/A — the transport is not an actor in our system.

**Information disclosure**
- **T6.3** The notification body, rendered on a locked screen, is read by a bystander, a shared-device user, or a parent over a kid's shoulder, and leaks PI (child name, chore title, wishlist title, dollar amount, post content). *L: high (lock screens are designed to render bodies) · I: med (child PI exposure to a household-adjacent third party) · Priority: HIGH.* **Mitigation M34** — body constants in `functions/src/notificationBodies.ts` are vague-by-construction; a CI assertion fails if any constant value contains a template (`${`, `{{`) OR any of the forbidden substrings `name`, `kid`, `child`, `parent`, `chore`, `wishlist`, `title`, `amount`, `balance`, `dollar`, `$`, `email`, `body`, `content` (case-insensitive). The assertion is the construction-time guarantee, not a runtime check.
- **T6.4** The transport operator (APNs / Mozilla) logs the payload at rest. *L: low (vendors assert no payload retention beyond delivery) · I: low (vague body — no PI to retain) · Priority: low under M34.* Without M34 this becomes HIGH.
- **T6.5** The click-target URL itself leaks PI (e.g. `?choreTitle=Take+out+trash`). *L: med (developer convenience temptation) · I: med.* **Mitigation M34 extended** — CI assertion also checks every emitted `data.url` for the same forbidden substrings; only opaque route paths are allowed (e.g. `/inbox`, `/chore/{id}` where id is an opaque docId, not a title).

**Denial of service**
- **T6.6** Transport outage (APNs / Mozilla) blocks delivery to a class of devices. *L: low · I: low (push is non-essential).* Accepted, F-PN-6.

**Elevation of privilege**
- N/A.

#### A.4.3 Kill-switch Function (`billingKillSwitch`)

**Spoofing**
- **T-KS.1** An attacker publishes a forged message to the `billing-budget-alerts` Pub/Sub topic, tricking the kill-switch into detaching billing (DoS). *L: low (Pub/Sub publish requires `roles/pubsub.publisher` on the topic — restricted) · I: high (all Blaze features down until billing re-attached) · Priority: med.* **Mitigation M41** — Pub/Sub topic `billing-budget-alerts` is configured to accept publishes ONLY from `cloud-billing-notifications@system.gserviceaccount.com` (the Cloud Billing-managed publisher); IAM on the topic restricts `publisher` to that account; runbook documents the verification step.

**Tampering**
- **T-KS.2** A bug in the payload parser interprets a low-cost alert as a breach and detaches billing prematurely. *L: med · I: high · Priority: HIGH.* **Mitigation M42** — kill-switch asserts `costAmount > budgetAmount` strictly before the detach call; unit tests cover (a) below threshold → no-op, (b) at threshold → no-op, (c) above threshold → detach, (d) malformed payload → no-op + structured warn log; idempotency test confirms second invocation after detach is a no-op.

**Repudiation**
- **T-KS.3** A detach later disputed. *L: low · I: med.* **Mitigation M38** — kill-switch logs `{action:'billing_detached', costAmount, budgetAmount, billingAccountBefore, timestamp}` (NO PII — billing metadata only). Cloud Logging retention covers post-hoc audit.

**Information disclosure**
- N/A — payload is project + cost metadata, no PI.

**Denial of service**
- **T-KS.4** Kill-switch IAM is misconfigured (granted `roles/owner` instead of `roles/billing.projectManager`); a compromise of the kill-switch SA hands the attacker project-wide write authority. *L: low · I: critical · Priority: HIGH.* **Mitigation M33b** — runbook in `docs/runbooks/billing-killswitch.md` mandates `roles/billing.projectManager` on the billing account ONLY; CI/runbook verification step asserts the binding shape. Misconfiguration failure mode is documented.
- **T-KS.5** Kill-switch FAILS TO FIRE — budget breached, function did not disable billing (deployment regression, IAM revoked, Pub/Sub subscription missing). *L: low · I: high (financial exposure beyond the $5 cap) · Priority: med-high.* **Mitigation M43** — a synthetic monthly test in staging publishes a fake threshold-breach payload and asserts billing is detached; runbook step in §A5/A. **Finding F13** (residual) — this is a financial-control failure, NOT a PI breach; document the notification path (notify the project owner / operator) but do NOT classify as a PIPEDA/Law 25 breach unless paired with PI exposure.

**Elevation of privilege**
- **T-KS.6** Compromise of the kill-switch SA → attacker can detach billing (DoS) but CANNOT read Firestore, send pushes, or exfiltrate any data, because the SA has billing rights only. *L: low · I: med (DoS only) · Priority: low under M33b.* See B8 for breach classification.

#### A.4.4 Per-callable + cross-callable STRIDE (notify-* functions)

**Spoofing**
- **T-C.1** A caller invokes a notify-callable with a forged `targetDocId` pointing at another family's chore/wishlist/post/todo, to make the system send a push into family B. *L: med · I: high · Priority: HIGH.* **Mitigation M35** — every callable enforces the **three-way familyId equality**: `caller.familyId == sourceDoc.familyId == recipient.familyId`. All three reads are server-side (Admin SDK against Firestore, not request-supplied). Any mismatch → reject with generic error.
- **T-C.2** A deactivated parent (`isActive:false`) invokes a notify-callable. *L: low · I: med.* **Mitigation M35 extends:** callable rejects unless `caller.isActive == true` AND, for parent-only categories, `caller.role == 'parent'`.
- **T-C.3** A client without a callable's auth context calls it via the unauthenticated HTTP endpoint. *L: med · I: med.* **Mitigation M32** — App Check required; missing or invalid `context.auth` → reject UNAUTHENTICATED.

**Cross-callable concerns (specific question from the brief)**
- **T-C.4** App Check key reuse: the same Firebase App Check key/site key is used across all 7 callables (it is project-scoped, not per-callable). A leak of the App Check site key + the attestation provider's reCAPTCHA key would compromise App Check for all 7 callables simultaneously, not just one. *L: low (App Check site keys are public; the attestation chain is the protection) · I: med · Priority: med.* **Finding F14** (accepted, documented) — App Check is one layer; the cross-tenant guard (M35) is the actual confidentiality control. Defense-in-depth: a leak of App Check does NOT, by itself, enable cross-tenant data exposure.
- **T-C.5** Token-leak blast radius: an FCM token leaked from `fcmTokens` for user X allows pushing to X's device (assuming the attacker also has FCM Admin auth). It does NOT expose tokens for any other category or any other user. Each `fcmTokens/{tokenHash}` doc is scoped to one device of one subject; a single leak ≠ project-wide exposure. *L: low · I: low–med per device · Priority: low.* Documented as F12.
- **T-C.6** A single rate-limit bypass on one callable does NOT bypass others — M36's token bucket is per-callable-kind keyed on actor uid. A burst on `notifyChoreApproved` doesn't free up budget on `notifyBoardPost`.

**Tampering**
- **T-C.7** Caller passes `{kind, targetDocId, recipientUid}` with `recipientUid` they chose, to direct a push at a specific person. *L: med · I: med.* **Mitigation M35** — the callable IGNORES any client-supplied `recipientUid`. Recipients are derived ENTIRELY server-side from the source doc + family membership query.

**Repudiation**
- Covered T5.4 / M38.

**Information disclosure**
- **T-C.8** Callable response leaks recipient identities (e.g. echoes the list of UIDs that got pushed). *L: med · I: med.* **Mitigation M39** — response shape is `{ sent: number, cleaned: number }` only.
- **T-C.9** A misconfigured log emits `chore.title` or `post.content` while structuring the log payload. *L: med · I: med · Priority: med.* **Mitigation M38** — structured-logger wrapper accepts an explicit allow-list of field names; an attempt to log a non-allow-listed key throws in dev and drops the field in prod, plus a CI test enumerates every `logger.info|warn|error` call site and asserts only allow-listed keys.

**Denial of service**
- Covered T5.7 / M32 / M36.

**Elevation of privilege**
- **T-C.10** A kid invokes `notifyChoreApproved` directly (without going through the parent-only `approveChore` mutation), to trick the system into pushing a "your chore was approved" message — possibly as social engineering. *L: low · I: low (the recipient sees a vague push; opens the app; sees no actual approval in Firestore; no balance change). Priority: low.* **Mitigation M35** — server reads `chores/{choreId}` and rejects unless `chore.status == 'approved'` (the actual state change must have happened). The notify-callable is a SIGNAL, never an AUTHORITY.

---

### A.5 New mitigations (M32-M44)

Each is a testable assertion the test-writer converts directly into a test.

- **M32 — App Check mandatory on every notify-callable AND on the `fcmTokens` write path.**
  Every notify-* callable declares `enforceAppCheck: true`. Every Firestore write to `userPrivate/{uid}/fcmTokens/{tokenHash}` requires App Check (rule: `request.auth != null && request.app != null` or equivalent App Check assertion in rules). Test (callable): an invocation without a valid App Check token → rejected with `unauthenticated` (or `failed-precondition`) before any business logic runs. Test (rules): a Firestore write to own `fcmTokens` without App Check → denied. Owner: test+impl, sec. **SC.**

- **M33 — Functions runtime SA: least-privilege; no `roles/owner`, no `roles/billing.*`, no `roles/iam.serviceAccountTokenCreator`.**
  The 2nd-gen Functions default SA has only FCM send rights (`roles/firebasecloudmessaging.admin` or equivalent) and Firestore data access (`roles/datastore.user`). Runbook step: `gcloud projects get-iam-policy` post-deploy asserts the runtime SA's role list does NOT include `roles/owner`, `roles/billing.admin`, `roles/billing.projectManager`, `roles/iam.serviceAccountTokenCreator`, or any `roles/cloudbilling.*`. Test: runbook-attached IAM assertion script.

- **M33b — Kill-switch SA: `roles/billing.projectManager` on the BILLING ACCOUNT only; NO Firestore, FCM, IAM, or project-level rights.**
  Runbook step asserts `gcloud beta billing accounts get-iam-policy <billingAccount>` shows the kill-switch SA bound at `roles/billing.projectManager` AND `gcloud projects get-iam-policy <project>` shows the kill-switch SA NOT bound to any project-level role. Test: runbook-attached IAM assertion script; documented failure if misconfigured.

- **M34 — Notification-body and click-target-URL forbidden-substring CI assertion.**
  A unit test in `functions/src/__tests__/notificationBodies.test.ts` iterates every value in `NOTIF_TITLES`, `NOTIF_BODIES`, and any constant URL template, and asserts:
  - no `${` and no `{{` substring (no template substitution slot),
  - no occurrence (case-insensitive) of any of: `name`, `kid`, `child`, `parent`, `chore`, `wishlist`, `title`, `amount`, `balance`, `dollar`, `$`, `email`, `body`, `content`, `post`, `message`,
  - length < 80 characters,
  - all values are `Object.freeze`-d.
  The test is required to pass in CI before any `deploy-functions` step runs. Adding a new body constant requires updating the test list explicitly. Owner: test+impl, sec, priv. **SC for the lock-screen rule.**

- **M35 — Three-way familyId equality + role + isActive + source-doc-state guard on EVERY notify-callable.**
  Every callable, in order, asserts:
  1. `context.auth` present (else UNAUTHENTICATED).
  2. App Check token present and valid (M32).
  3. `users/{context.auth.uid}` exists, `isActive == true`. For parent-only categories: `role == 'parent'`.
  4. Source doc (`chores/{id}` / `wishlistItems/{id}` / `posts/{id}` / `todos/{id}`) exists.
  5. `sourceDoc.familyId == caller.familyId`.
  6. Source doc's state matches the expected post-mutation state (e.g. `chore.status == 'approved'` for `notifyChoreApproved`).
  7. For each computed recipient: `recipient.familyId == caller.familyId` AND `recipient.isActive == true` AND (for self-exclusion categories) `recipient.uid != caller.uid`.
  8. The client-supplied payload is `{kind, targetDocId}` ONLY; any other field is ignored.
  Tests per callable: cross-family caller with foreign target doc → reject; deactivated parent → reject; kid invokes parent-only callable → reject; forged `recipientUid` in payload → ignored, server-derived recipients used; source doc in wrong state → reject; tokenless (no auth) → reject; App-Check-less → reject. Owner: test+impl, sec. **SC.**

- **M36 — Per-actor + per-family rate limit on every notify-callable + per-family member cap on `fcmTokens`.**
  Token bucket: max 10 invocations per actor uid per 60 seconds per callable kind; max 50 invocations per family per 60 seconds across all callables. Over-limit → reject with `resource-exhausted`. `fcmTokens` write rule denies create when the subject's existing token doc count is ≥ 20 (per-user device cap; clients clean stale tokens via F-PN-2). Tests: 11th invocation within 60s by same actor → rejected; 21st `fcmTokens` create by same subject → denied at rules.

- **M37 — Stale-token cleanup on FCM 404/410.**
  Every notify-callable, on `sendEachForMulticast` response, iterates per-recipient response array; for each response with `error.code` in `{messaging/registration-token-not-registered, messaging/invalid-registration-token}` (404/410 class), the callable deletes the corresponding `userPrivate/{uid}/fcmTokens/{tokenHash}` doc. Idempotent (delete of missing doc is no-op). Test: mock `sendEachForMulticast` returns one success + one 404 → assert exactly one `fcmTokens` doc deleted; second invocation with same input → no-op (already deleted). Without this, dead tokens accumulate and (in the worst case) a future device that re-acquires a recycled FCM token receives pushes meant for the prior owner. Owner: test+impl, sec, priv. **SC for stale-token hygiene.**

- **M38 — Log scrubber with allow-list (`functions.logger.*` only, no `console.log`).**
  Static rule (eslint or AST test) asserts no `console.log/info/warn/error` in `functions/src/**`. All logging goes through a `safeLogger` wrapper that accepts only an allow-listed set of field names: `{kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs, skipReason, action, costAmount, budgetAmount, billingAccountBefore, timestamp, errorCode}`. Any other key is dropped in prod and throws in dev. CI test enumerates every `logger.*` call site (via AST) and asserts no string literal field name in `{token, body, name, email, choreTitle, wishlistTitle, postContent, todoTitle, content, message, title}` is passed. Per Lesson 2026-06-08 #2 — no field unknown to the primitive is silently honored. The `skipReason` field added by PR D carries the values `'opted_out' | 'no_tokens' | 'send_failed'` — operational discrimination preserved server-side after the field was dropped from the M39 response shape. Owner: test+impl, priv. **SC for the children's-data log-hygiene rule.**

- **M39 — Generic callable responses; no enumeration oracles (response shape collapsed in PR D).**
  Every notify-callable returns `{ sent: number, cleaned: number }` on success AND on every skip / FCM-throw branch (PR D dropped the `reason` field — see T5.6b for the disclosure path it closed). Errors from the FCM provider are caught and surface as the same generic shape; FCM error codes are NEVER returned to the client. The reason classification IS preserved server-side via the `skipReason` M38 allow-listed log field. Test: every skip branch returns exactly `{ sent: 0, cleaned: 0 }` and the `skipReason` value appears in the structured info-log payload only.

- **M40 — Dependency audit gate (existing constraint, re-asserted for `functions/`).**
  `npm audit --omit=dev --audit-level=high` runs in CI for `functions/` on every PR; high-severity CVEs block merge. Already a constraint baseline; M40 pins it to the new `functions/` workspace. Test: CI step present and failing on a deliberate poisoned dependency.

- **M41 — `billing-budget-alerts` Pub/Sub topic publisher restriction.**
  Topic IAM grants `roles/pubsub.publisher` ONLY to `cloud-billing-notifications@system.gserviceaccount.com`. Runbook step verifies the binding via `gcloud pubsub topics get-iam-policy billing-budget-alerts`. Test: runbook-attached assertion.

- **M42 — Kill-switch threshold + idempotency unit tests.**
  Required unit tests:
  - `costAmount < budgetAmount` → billing API NOT called.
  - `costAmount == budgetAmount` → billing API NOT called (strict greater-than).
  - `costAmount > budgetAmount` → billing API called with `billingAccountName: ''`.
  - Second invocation with billing already detached → no-op (idempotent).
  - Malformed payload → structured warn log, no API call.

- **M43 — Synthetic kill-switch verification in staging.**
  Quarterly (calendar-driven) runbook step: publish a fake threshold-breach message to staging's `billing-budget-alerts`, observe function execution log, observe billing detachment, re-attach billing. Documented in `docs/runbooks/billing-killswitch.md`. NOT an autotest; calendar reminder owned by operator.

- **M44 — Subprocessor disclosure (privacy policy) — HUMAN GATE.**
  Privacy lawyer reviews whether Apple Inc. (APNs) and Mozilla Corporation (autopush) require explicit subprocessor disclosure in the privacy policy in addition to the existing Firebase/Google disclosure. Until reviewed, the privacy policy MUST include placeholder language: "Push notifications are delivered through Apple (APNs) for iOS devices and Mozilla (autopush) for Firefox; notification bodies do not contain personal information by default." Privacy-reviewer + user own this; do NOT auto-decide.

---

### A.6 New findings (F11-F15) — open/accepted residual risks

- **F11 — Subprocessor disclosure for APNs / Mozilla autopush is undecided.**
  ADR-0013 §11 names APNs and Mozilla autopush as transport-layer processors but defers the disclosure-language question. Risk: a privacy regulator (OPC, CAI Quebec) could view APNs/Mozilla as undisclosed subprocessors. **Status: HUMAN GATE — M44.** Mitigation: placeholder disclosure language in the privacy policy until lawyer review. Severity: low (vague-body design means no PI flows through these processors).

- **F12 — PI on a misconfigured lock screen — ongoing vigilance.**
  M34's CI assertion catches today's body constants. A future code change could (a) introduce template substitution to `notificationBodies.ts`, (b) add a new body constant that bypasses the test list, or (c) add a new `data.url` template that leaks a title. The CI assertion is enforced at the construction site; the residual risk is the maintenance discipline of keeping the forbidden-substring list current as the product vocabulary grows. **Status: ACCEPTED, with ongoing vigilance.** Owner: security-reviewer must re-examine the constants list on every PR touching `functions/src/notificationBodies.ts`. Trigger for re-review: any push-related feature beyond the v1 + PR F set.

- **F13 — Kill-switch FAILING TO FIRE is a financial-control failure, NOT a PI breach.**
  If the kill-switch is misconfigured, undeployed, or its Pub/Sub subscription is broken, a runaway Function bug can rack up cost beyond $5. Notify: project owner / operator (already on the Cloud Billing alert). Do NOT notify OPC, CAI, or affected individuals — no PI is exposed by this failure mode alone. PIPEDA s.10.1 trigger: NO. Recordkeeping: internal-only financial incident log (not the breach-record store). **Status: ACCEPTED — operational risk, financial only.** Mitigation: M43 (quarterly synthetic verification).

- **F14 — App Check key reuse across all 7 callables (defense-in-depth note).**
  A leak of the App Check site key + reCAPTCHA Enterprise key would compromise App Check for all 7 callables simultaneously. M35 (the cross-tenant guard) is the actual confidentiality control; App Check is a DoS-and-abuse control. A compromise of App Check does NOT, by itself, enable cross-tenant data exposure. **Status: ACCEPTED — documented defense-in-depth posture.**

- **F15 — iOS-without-PWA silent delivery failure (privacy-relevant UX gap).**
  iOS Safari without "Add to Home Screen" silently fails to deliver web push. From the user's perspective, the system accepts the permission grant, registers a token, then never delivers — leading the parent to make a wrong inference (the kid didn't submit the chore for approval) or vice versa. **Not a security threat per se**, but a privacy-relevant case where the user is misled about the system's behavior. **Status: ACCEPTED LIMITATION — E2 banner in the design + onboarding-tour copy documents the requirement.** Privacy-reviewer signs off that the banner copy is honest about the limitation.

---

### A.7 New cross-border transfers (CB3, CB4) — HUMAN GATE

| Transfer | Data | Destination | Safeguards required | Status |
| -------- | ---- | ----------- | ------------------- | ------ |
| **CB3 — FCM (Google) push-payload transport** | vague body + opaque device token | Google FCM global data plane (likely US for delivery; control plane in our region but data egresses Canada at this hop) | Existing Google/Firebase DPA; vague-body design (M34) is the actual PI safeguard | **HUMAN GATE — ADR-0013 §11.** Already-named Firebase relationship; no new DPA required; user to confirm. |
| **CB4 — APNs (Apple, USA) and Mozilla autopush (USA/EU)** | vague body + opaque push handle | Apple (USA) for iOS; Mozilla (USA + EU mirrors) for Firefox | Vague-body design (M34); placeholder subprocessor language in privacy policy (M44) until lawyer review | **HUMAN GATE — ADR-0013 §11 + M44.** Possible new disclosure obligation; do NOT enable production push to iOS / Firefox until M44 is resolved. |

**Privacy-policy disclosure language (placeholder, pending lawyer review):**
> "Push notifications are delivered through Google Firebase Cloud Messaging
> (FCM). For iOS devices, FCM uses Apple Push Notification service (APNs,
> operated by Apple Inc., USA). For Firefox browsers, FCM uses Mozilla
> autopush (operated by Mozilla Corporation, USA/EU). Notification bodies
> shown on your device do not contain personal information by default.
> Device push tokens are stored encrypted-in-transit and at rest in
> `northamerica-northeast1` (Montreal, Canada)."

---

### A.8 New breach scenarios (B7-B10) — extends §7

PIPEDA s.10.1 trigger is RROSH (real risk of significant harm). Quebec Law 25 parallel trigger if served (pre-launch).

- **B7 — FCM token compromise (`fcmTokens/{tokenHash}` doc leak).**
  *Actual attack surface analysis:*
  - **Can the attacker send a push to that device?** Only if they ALSO have valid FCM Admin SDK credentials (our runtime SA). The token alone is insufficient — FCM rejects sends from anonymous callers. So: yes IF paired with M33 SA compromise; no otherwise.
  - **Can the attacker receive someone else's pushes?** No. Tokens are device-bound; they identify a delivery endpoint, not a credential to read. The attacker would need to install our SW on a device they control AND register their device under the victim's UID — both blocked by M32 and Firestore rules.
  - **Can they enumerate other tokens?** No, the `fcmTokens` rule allows read/list only by `request.auth.uid == uid` (B2 in design).
  *RROSH:* **NO if the token leak is alone** (no PI exposed; tokens are opaque); **YES if paired with runtime-SA compromise** (rogue pushes could carry attacker-crafted content, including phishing). Recordkeeping: 24 months regardless (PIPEDA). OPC/individual notification: only if paired with the SA compromise OR if a misconfigured M34 caused PI to enter the body before the leak. **Sev: Low alone; High if paired.** Trigger M37 (cleanup) review.

- **B8 — Kill-switch SA / IAM compromise.**
  Attacker controls the kill-switch SA via `roles/billing.projectManager` on the billing account. Capability: detach billing (DoS for ALL Blaze features); CANNOT read Firestore, send pushes, list IAM, or escalate.
  *RROSH:* **NO** — no PI is reachable from this identity. **Not a PIPEDA/Law 25 notifiable breach.** Record as a security incident; notify project owner / operator; rotate the SA; investigate the access vector. **Sev: Medium (DoS only).** If paired with ANOTHER compromise that DID expose data, the combined incident is notifiable; the SA compromise alone is not.

- **B9 — Kill-switch FAILED TO FIRE (budget breached, function did not detach billing).**
  Mode: undeployed kill-switch, IAM revoked, Pub/Sub subscription broken, payload-parser bug (T-KS.2 in reverse). Result: cost exceeds $5/mo cap.
  *RROSH:* **NO** — no PI exposure. **Not a PIPEDA notifiable breach.** Notification path: project owner / operator (financial-control failure). Record in an internal financial-incident log (NOT the PI breach store). Trigger M43 review and runbook tightening. **Sev: Low-Medium financial only.**

- **B10 — PI accidentally lands in a notification body (M34 regression).**
  Mode: a code change introduces a template substitution to `notificationBodies.ts` AND the M34 CI assertion's forbidden-substring list is out of date AND the change ships to prod. Result: child names, chore titles, wishlist titles, or dollar amounts render on lock screens for some/all users.
  *RROSH:* **YES** — child PI exposed on lock screens visible to bystanders / household-adjacent third parties; the violation is at the scale of "every push for the affected category until rolled back". **Triggers OPC + guardian notification** (PIPEDA s.10.1), breach record (24 months), and an OPC-response decision (human gate). **Sev: HIGH.** Mitigation post-incident: roll back the function, revoke the bad body constant, audit logs for the window of exposure, notify all affected family guardians.

---

### A.9 Updates to the prioritized mitigations table (extends §8)

| Pri | Threat | Mitigation (testable assertion) | How tested | Owner | SC? |
| --- | ------ | ------------------------------- | ---------- | ----- | --- |
| 1 | T-C.1 cross-family notify | M35 three-way familyId equality + role + isActive + source-doc-state | callable unit/integration deny tests | test+impl, sec | **SC** |
| 1 | T6.3 PI on lock screen | M34 forbidden-substring CI assertion on body constants + click-target URLs | CI unit test | test+impl, sec, priv | **SC** |
| 1 | T5.7 callable DoS / kill-switch burn | M32 App Check mandatory on every notify-callable + on `fcmTokens` write | callable + rules deny tests | test+impl, sec | **SC** |
| 1 | T5.9 / T-KS.6 SA over-privilege | M33 runtime SA scope; M33b kill-switch SA scope | runbook IAM assertion scripts | impl, sec | **SC** (runbook) |
| 2 | T5.5 token / body in logs | M38 log scrubber + allow-list + AST CI test | AST + unit test | test+impl, priv | **SC** (children's-data log hygiene) |
| 2 | F-PN-3 stale tokens accumulate | M37 cleanup on FCM 404/410 | callable unit test with mocked responses | test+impl, sec, priv | **SC** |
| 2 | T-KS.2 kill-switch threshold bug | M42 unit-test matrix (below/at/above/idempotent/malformed) | unit tests | test+impl, sec | **SC** |
| 3 | T5.8 / T6.5 rate-limit + per-user token cap | M36 token bucket + `fcmTokens` count cap at rules | callable + rules deny tests | test+impl, sec | yes |
| 3 | T-KS.1 Pub/Sub topic publisher | M41 topic IAM restricted to Cloud Billing publisher | runbook IAM assertion | impl, sec | yes |
| 3 | T5.6 / T-C.8 enumeration / oracle | M39 generic responses, no FCM error echo | unit test | test+impl, priv | yes |
| 4 | M43 synthetic kill-switch verification | quarterly runbook exercise | runbook (manual) | operator | gate |
| 4 | F11 / M44 subprocessor disclosure | privacy-policy placeholder + lawyer review | human gate | user, priv | gate |
| 4 | F-PN-7 / F15 iOS-without-PWA | E2 banner + onboarding-copy honesty | UI test (banner shows iff iOS+!standalone+granted) | test+impl, priv | no |

---

### A.10 Test-writer handoff — required test cases per PR (mandatory; no PR ships without its row)

**PR A — Functions scaffold + kill-switch**
- A-T1. Kill-switch unit: `costAmount > budgetAmount` → billing-API mock called with `billingAccountName: ''` (M42).
- A-T2. Kill-switch unit: `costAmount < budgetAmount` → billing-API NOT called (M42).
- A-T3. Kill-switch unit: `costAmount == budgetAmount` → billing-API NOT called (strict greater-than) (M42).
- A-T4. Kill-switch unit: malformed Pub/Sub payload → no API call + structured warn log (M42, M38).
- A-T5. Kill-switch unit: second invocation after detach → no-op (idempotent) (M42).
- A-T6. Runbook assertion: `gcloud beta billing accounts get-iam-policy` shows kill-switch SA bound to `roles/billing.projectManager` ONLY (M33b).
- A-T7. Runbook assertion: `gcloud projects get-iam-policy` shows kill-switch SA NOT bound to any project-level role (M33b).
- A-T8. Runbook assertion: `gcloud pubsub topics get-iam-policy billing-budget-alerts` shows publisher restricted to `cloud-billing-notifications@system.gserviceaccount.com` (M41).
- A-T9. CI assertion: `--only` list in `deploy-functions` step contains `functions:billingKillSwitch` and NOTHING ELSE in PR A; `firestore:rules` step is unchanged (PR #84 lesson).
- A-T10. Log scrub static check: no `console.log` in `functions/src/billingKillSwitch.ts`; only `functions.logger.*` (M38).

**PR B — Token storage + preferences**
- B-T1. Rules emulator: own user reads own `fcmTokens/{tokenHash}` → ALLOWED.
- B-T2. Rules emulator: same-family parent reads child's `fcmTokens/{tokenHash}` → DENIED.
- B-T3. Rules emulator: other-family user reads `fcmTokens/{tokenHash}` → DENIED.
- B-T4. Rules emulator: unauthenticated reads `fcmTokens/{tokenHash}` → DENIED.
- B-T5. Rules emulator: subject lists own `fcmTokens` subcollection → ALLOWED.
- B-T6. Rules emulator: subject lists another user's `fcmTokens` subcollection → DENIED.
- B-T7. Rules emulator: subject writes `fcmTokens/{tokenHash}` without App Check → DENIED (M32, rules-level).
- B-T8. Rules emulator: subject writes `fcmTokens/{tokenHash}` with `isActive:false` → DENIED.
- B-T9. Rules emulator: 21st `fcmTokens` create by same subject (existing count >= 20) → DENIED (M36 per-user cap).
- B-T10. Client unit: `registerToken` → upserts `fcmTokens/{tokenHash}` doc with `{token, userAgent, createdAt, lastSeenAt}`; `tokenHash` is first 24 hex of SHA-256(token).
- B-T11. Client unit: `unregisterToken` → calls `deleteToken(messaging)` AND deletes the device's `fcmTokens` docs; idempotent on second call.
- B-T12. Client unit: `getToken()` returns null (permission denied) → no Firestore write, no token doc created.
- B-T13. Integration: master-off toggle in preferences UI → `unregisterToken` invoked; master-on → permission prompt + `registerToken`.
- B-T14. AODA: preferences UI keyboard-operable, 44px targets, visible focus, screen-reader labels (per Lesson 2026-06-08 #1 — primitive-level a11y test).

**PR C — First chargeable callable (`notifyChoreApproved`) + body-constant audit**
- C-T1. Callable unit: invocation without `context.auth` → UNAUTHENTICATED reject (M35.1).
- C-T2. Callable unit: invocation without valid App Check token → reject (M32).
- C-T3. Callable unit: caller's `users` doc missing → reject (M35.3).
- C-T4. Callable unit: caller `isActive:false` → reject (M35.3).
- C-T5. Callable unit: `chores/{choreId}` missing → reject (M35.4).
- C-T6. Callable unit: `chore.familyId != caller.familyId` (cross-family chore) → reject (M35.5).
- C-T7. Callable unit: `chore.status != 'approved'` → reject (M35.6).
- C-T8. Callable unit: recipient `userPrivate/{assignedTo}.familyId != caller.familyId` → reject (M35.7 defense-in-depth).
- C-T9. Callable unit: recipient `notificationPreferences.myChoreResolved == false` → returns `{ sent: 0, reason: 'opted_out' }`, no FCM call (M35).
- C-T10. Callable unit: recipient has no `fcmTokens` docs → returns `{ sent: 0, reason: 'no_tokens' }`, no FCM call (M35).
- C-T11. Callable unit: client supplies forged `recipientUid` in payload → IGNORED; server-derived recipient used (M35.8).
- C-T12. Callable unit: 11th invocation by same actor within 60s → `resource-exhausted` (M36).
- C-T13. Callable unit: `sendEachForMulticast` returns one success + one `registration-token-not-registered` → exactly one `fcmTokens` doc deleted (M37).
- C-T14. Callable unit: `sendEachForMulticast` throws → response is `{ sent: 0, reason: 'send_failed' }`; FCM error code in server log only, NOT in response (M39).
- C-T15. Callable unit: response shape on success is `{ sent: number, cleaned: number }` ONLY; no recipient UIDs echoed (M39).
- C-T16. Callable unit: log payload contains only `{kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs}`; attempt to log `chore.title` or recipient name throws in dev (M38).
- C-T17. **Body-constants CI test** (`notificationBodies.test.ts`): iterates every value in `NOTIF_TITLES` and `NOTIF_BODIES`; asserts no `${`, no `{{`, no occurrence of forbidden substrings, length < 80, `Object.freeze` enforced (M34). **Mandatory CI gate before deploy.**
- C-T18. Body-constants CI test: every `data.url` template is an opaque route path; no PI in query string (M34 extended).
- C-T19. CI assertion: `deploy-functions` `--only` list now `functions:billingKillSwitch,functions:notifyChoreApproved`; kill-switch precedes (M-design).
- C-T20. Integration: `approveChore` tx succeeds + callable mock fails → user sees CHORE_APPROVE_SUCCESS toast (no rejection thrown to UI).

**PR D — Remaining v1 events (D1, D3-D7)**
- D-T1. For each of `notifyChoreSubmitted`, `notifyWishlistRequested`, `notifyWishlistResolved`, `notifyBoardPost`, `notifyTodoCreated`, `notifyTodoCompleted`: replicate C-T1 through C-T17 with the appropriate source-doc collection and preference key. (One test file per callable; shared test helper for the M35 + M38 + M39 checks.)
- D-T2. Per-callable: parent-only callables (`notifyChoreSubmitted` and `notifyWishlistRequested` are kid-initiated → parents receive; check the inverse rejection paths) — kid invokes a parent-only callable (no inverse parent-only callable in current set; assert kid can invoke kid-fired callables and is in the recipient list for parent-fired) and assert M35.3 role gate where applicable.
- D-T3. Cross-callable: a single actor exceeding the 50/min/family cap (across two different kinds) → 51st call rejected (M36 per-family cap).
- D-T4. Recipient-exclusion: for `notifyBoardPost`, `notifyTodoCreated`, `notifyTodoCompleted` — the author/creator/completer is NEVER in the recipient list; assert via callable unit test (M35.7 self-exclusion).
- D-T5. `notifyWishlistResolved`: caller passes `wishlistItemId`; server reads status to pick `wishlistApproved` vs `wishlistDenied` body constant; rejection-reason text NEVER appears in the notification body (M34).
- D-T6. CI deploy-list assertion grows monotonically; kill-switch remains first.
- D-T7. App Check enforced on every D-series callable (replicate C-T2).

**PR E — Observability + iOS-PWA hint**
- E-T1. AST/eslint: no `console.log` anywhere in `functions/src/` (M38).
- E-T2. AST/eslint: every `logger.*` call uses only allow-listed field names (M38).
- E-T3. iOS-PWA banner: iOS UA + permission granted + `navigator.standalone !== true` → banner shows once per session; dismiss persists 30 days via `iosPwaHintDismissedAt` (F15).
- E-T4. iOS-PWA banner: non-iOS UA → banner NEVER shows.
- E-T5. iOS-PWA banner: iOS UA + `navigator.standalone === true` → banner NEVER shows.
- E-T6. Dashboard config asserts the four required series: invocations/kind, success ratio, token cleanups, kill-switch invocations.

**PR F — Scheduled events (deferred fast-follow, separate ADR)**
- Threat-modeler will re-engage when PR F's design lands; expect new threats around: Cloud Scheduler IAM, time-window-based recipient selection (privacy: who is in the family at the moment the scheduler fires), and digest body shape (digests are likely PI-vague-resistant — separate ADR per design §7 cliffs).
- Placeholder: any scheduled-trigger callable MUST re-use M32 (App Check is N/A for Pub/Sub-triggered functions; M41-style topic-publisher restriction applies instead), M34, M35 (re-derive familyId server-side), M37, M38.

---

### A.11 Security-reviewer handoff

Confirm in the diff for each PR:
- **PR A:** kill-switch unit-test matrix (M42) is present and passing; runbook IAM steps (M33b, M41) are documented and verifiable; `deploy.yml` `deploy-functions` step is FLAG-GATED and separate from `firestore:rules`; no `roles/owner` on the kill-switch SA.
- **PR B:** `fcmTokens` rules enforce `request.auth.uid == uid` AND `isActive()` on every operation; cross-user / cross-family deny tests present; App Check required on writes; no token value in any log.
- **PR C:** every M35 condition (1-8) is present in the callable in the documented order; the body-constants CI test is wired into the deploy gate; the callable response shape is exactly `{ sent, cleaned }`; FCM errors are NOT echoed to the client; `approveChore` does NOT propagate callable rejection to the UI.
- **PR D:** the M35 enforcement is identical across all 6 new callables (suggest a shared `verifyNotifyCaller(kind, sourceCollection, sourceId, recipientResolver)` helper to make the audit grep-able); body constants for the new categories pass M34; recipient self-exclusion enforced.
- **PR E:** no `console.log` in `functions/src/`; allow-list logger is enforced; iOS-PWA banner copy is honest about the limitation (per F15).

**Blocking findings (no merge):** any rule that omits the App Check assertion on `fcmTokens`; any callable that trusts a client-supplied `recipientUid` or `familyId`; any body constant containing a template marker; any logger call passing a non-allow-listed field; any IAM binding that grants the runtime SA or kill-switch SA beyond their documented scope.

---

### A.12 Privacy-reviewer handoff

- **PI flows touched:** DF12 (token at rest in Firestore Montreal — credential class; tenant-scoped; cleanup on revoke / 404 / sign-out / delete). DF14 (vague body + token to FCM, CB3). DF15 (vague body + opaque handle to APNs/Mozilla/Android-FCM transport, CB4). DF13 carries NO body content (purely `{kind, targetDocId}`).
- **PIPEDA principles:**
  - (3) Consent: contextual permission prompt + per-category preferences in B5/B6.
  - (4) Limiting collection: the only new PI is the FCM token (credential) and userAgent (device label); both have stated purposes; no profiling, no analytics added.
  - (5) Use/disclosure/retention: tokens deleted on revoke/404/sign-out/delete; logs retained per Cloud Logging default; no marketing use.
  - (7) Safeguards: M32, M34, M35, M37, M38 are the listed controls.
  - (8) Openness: privacy policy must disclose FCM (existing), APNs, Mozilla autopush (NEW — M44 human gate).
- **Children's-data:** no child name / chore title / wishlist title / amount / post content / todo title ever crosses TB5 or TB6 by construction (M34). Verify body constants and click-target URLs on every review.
- **Cross-border:** CB3 (FCM) and CB4 (APNs/Mozilla) are flagged human gates. Do NOT enable production push to iOS/Firefox until M44 is resolved.
- **Breach scenarios:** B7 (token leak alone NOT notifiable; paired with SA compromise IS), B8 (SA compromise — DoS only, NOT notifiable), B9 (kill-switch fail — financial, NOT notifiable), B10 (M34 regression putting PI in body — NOTIFIABLE under PIPEDA s.10.1, guardian + OPC).
- **F15 acknowledgment:** confirm the iOS-PWA banner copy is honest about the silent-delivery limitation.

---

### A.13 User-facing human-gate items (NEW, surface alongside §10 above)

The following items REQUIRE the user to decide / approve before implementer touches the code:

1. **Approve subprocessor disclosure approach for APNs (Apple, USA) and Mozilla autopush (USA/EU).** Either (a) commit to lawyer review before launch with placeholder language in the privacy policy, or (b) draft the disclosure language now. **M44.**
2. **Confirm IAM scopes** documented in the runbook before A3:
   - Kill-switch SA: `roles/billing.projectManager` on the billing account ONLY (M33b).
   - Functions runtime SA: NO `roles/owner`, NO `roles/billing.*` (M33).
3. **Confirm App Check is enabled on the Firebase project** (reCAPTCHA Enterprise for web), with the site key provisioned, before PR C ships. Without App Check, M32 is a no-op and T5.7 (callable abuse → kill-switch burn) becomes a live attack path.
4. **Approve the per-user device cap of 20 `fcmTokens` and per-actor rate limit of 10 calls / 60s / callable kind** (M36). These are tunable; the threat-modeler picked defaults but the operator owns the call.
5. **Acknowledge B7-B10 breach classifications** (especially: kill-switch SA compromise is DoS-only, NOT a PIPEDA breach; M34 regression putting PI on a lock screen IS).
6. **Reconfirm ADR-0013 §11 subprocessor list** is complete with FCM + APNs + Mozilla autopush + Android FCM transport before the privacy-policy update.

---

### A.14 Architect-design pushback (sharpening items)

The architect's design is a draft; threat-modeler authority to flag changes before implementer touches code:

1. **App Check on the `fcmTokens` write path is NOT explicit in the design (B2 lists only `request.auth.uid == uid` AND `isActive()`).** Add App Check enforcement to the B2 rule shape AND to the callable declarations. Without this, a script with a stolen Firebase user session token can register attacker-controlled tokens against the victim's UID and receive their pushes (subject to M35's recipient.familyId check on send, but the threat is real). **Required change to PR B2 acceptance criteria.**
2. **The design lists `userAgent` on `fcmTokens` without a stated purpose-of-collection in the design.** If the preferences UI does NOT surface a "manage your devices" view in v1, drop `userAgent` per constraints §"For any new data field" (data minimization). If it DOES surface device management, add that view to PR B5 acceptance criteria explicitly. **Architect: clarify before PR B ships.**
3. **The design's §3 description of `notifyChoreApproved` does NOT pin the App Check requirement at the callable declaration.** Add `enforceAppCheck: true` to every notify-callable's options object. **Required change to PR C1 acceptance criteria.**
4. **The design's §8 F-PN-3 mitigation says "Function receives per-recipient response array; for each failed token, deletes the corresponding `fcmTokens/{tokenHash}` doc" — but does NOT pin the precise error-code set that triggers deletion.** Pin to `messaging/registration-token-not-registered` and `messaging/invalid-registration-token` (the FCM Admin SDK error-code constants). Deleting on other error codes (e.g. `messaging/server-unavailable`) would cause spurious churn. **Required change to PR C1 acceptance criteria (specifically the F-PN-3 row).**
5. **The design's §9 logs allow-list does NOT include all the forbidden field names that M38 enforces.** Update §9 to reference M38's allow-list explicitly (`{kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount, durationMs, action, costAmount, budgetAmount, billingAccountBefore, timestamp, errorCode}`) and the forbidden-substrings list. **Required change to E1 acceptance criteria.**
6. **The architect's task list does not have a PR-A acceptance criterion that asserts the runtime SA has been audited for the NEGATIVE bindings (no `roles/owner` etc.).** Add A-T6 / A-T7 (M33 / M33b assertions) to the A3 runbook acceptance criteria as a verification gate before A4 deploy.
7. **The §12 PR-F deferred work needs an explicit threat-modeler re-engagement gate**, because Cloud Scheduler + scheduled trigger changes the auth model (no `context.auth`, no App Check). Pin a "threat-model PR F before code" gate in the design.

---

### A.15 Self-validation checklist (A-addendum)

- [x] Every NEW component (kill-switch, 7 notify-callables, FCM Admin path, FCM↔transport path) has a STRIDE pass (§A.4).
- [x] Every NEW PI / credential flow has classification, residency, retention, and purpose (§A.1, §A.2).
- [x] Every NEW threat has a testable mitigation (M32-M44) phrased as a deny/allow assertion the test-writer can convert (§A.5, §A.10).
- [x] Every NEW cross-border transfer (CB3, CB4) is on the human-gate list (§A.7, §A.13).
- [x] PIPEDA s.10.1 trigger explicitly surfaced for B7 / B10 (notifiable) AND explicitly NOT triggered for B8 / B9 (with reason) (§A.8).
- [x] The children's-data rule is enforced by construction (M34 CI assertion) not by review discipline (§A.5).
- [x] Top 5 NEW risks ordered by priority (below).

---

### A.16 Top 5 NEW risks (ordered)

1. **PI on lock screen (T6.3, B10).** A future code change templating a child name / chore title / amount into the notification body, rendered on a locked screen visible to bystanders. **Mitigation: M34 forbidden-substring CI assertion + ongoing vigilance F12.** Notifiable breach (B10).
2. **Cross-family notify (T-C.1, T-C.7).** A caller invokes a notify-callable against a foreign family's source doc or forges a `recipientUid`, leaking the fact-of-existence + the click-target URL into a foreign family's devices. **Mitigation: M35 three-way familyId equality + server-derived recipients.** Security-critical, no autonomous merge.
3. **Callable DoS burning the $5 kill-switch (T5.7).** Script abuse of a callable mints Function invocations, trips the cap, takes ALL push (and any future Blaze feature) down. **Mitigation: M32 App Check on every notify-callable + on `fcmTokens` writes; M36 rate limits.** Requires App Check enablement gate (human-gate item 3).
4. **SA over-privilege (T5.9, T-KS.6).** A bug or compromise of the runtime SA or kill-switch SA grants more than the documented scope. **Mitigation: M33 + M33b + runbook IAM assertions (A-T6, A-T7).** A misconfiguration here is invisible until exploited.
5. **Stale token accumulation → wrong-owner push (F-PN-3 + B7 paired).** A dead token left in `fcmTokens` belongs (eventually) to whoever the FCM transport recycles the device handle to; a future push intended for the prior owner could land on a stranger's device. **Mitigation: M37 cleanup on FCM 404/410.** Security-critical for hygiene; combined with M34 the body is vague so the worst case is "someone gets a confusing 'Family HQ has an update' push", but the principle of least-surprise + the stale-credential class of issue makes this top-5.

---

### A.17 Next handoff

**NEXT: test-writer.** Inputs:
- §A.10 (test cases per PR — mandatory, no PR ships without its row);
- §A.5 (mitigation IDs M32-M44 with their testable assertions);
- §A.4 (STRIDE entries with threat IDs T5.*, T6.*, T-KS.*, T-C.* — every entry maps to a test in §A.10);
- §A.11 (security-reviewer's blocking-findings list — informs which tests are gating).

After test-writer, the orchestrator routes to implementer for PR A only (kill-switch + scaffold), then re-engages threat-modeler + security-reviewer if any of the human-gate items (§A.13) change the design before PR B.

