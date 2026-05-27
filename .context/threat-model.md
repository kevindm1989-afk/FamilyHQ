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
