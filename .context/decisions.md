# Decisions

Architectural choices made for this project and why.

Append newest on top. Don't delete old entries — superseded decisions get a note
pointing to the new one. The history is the value.

---

## Format

```
## YYYY-MM-DD — Short decision title

**Context:** what we were choosing between and why it mattered.
**Decision:** what we picked.
**Rationale:** why this one over the alternatives.
**Reversibility:** how hard it would be to change later (low / medium / high).
**Superseded by:** (only if applicable, link to newer entry)
```

---

## Entries

---

## ADR-0001 — Multi-tenant data model: top-level collections, `familyId` on every doc

**Status:** Proposed (awaiting human gate — touches tenant model)
**Date:** 2026-05-26
**Decider(s):** architect (proposed); user (approval pending)

**Context:** Family HQ is a single-deployment, multi-tenant SaaS. The product
spec was written for a single-family app (`settings/family` singleton, no tenant
key). We must reconcile that to a model where one Firestore project holds many
unrelated families, including children's data, with cross-tenant leakage as the
#1 risk (`constraints.md` lines 29-47).

**Decision drivers:**
- Tenant isolation enforceable in `firestore.rules` server-side.
- Spec preference (`preferences.md`) explicitly forbids deep nesting that forces
  a restructure when collections are added.
- Queries must be cheaply scopeable to one family.
- `familyId` immutable from client.

**Options considered:**
- **A — Subcollections under `families/{familyId}/...`** (e.g.
  `families/{fid}/chores/{id}`). Pro: isolation is path-structural, rules are
  short, `familyId` is implicit in the path. Con: collection-group queries
  needed to ever aggregate across families (ops/admin), spec preference warns
  against deep nesting, and every read path must carry the full ancestor path.
- **B — Top-level collections with a `familyId` field on every doc** (chosen).
  Pro: matches the spec's stated collection list and the locked preference;
  flat paths; tenant scope enforced by a `familyId == caller's familyId` rule
  predicate on every read/list/write. Con: isolation is rule-enforced not
  path-enforced — a missing predicate is a leak, so rules need rigorous tests.
- **C — One Firebase project per family.** Pro: hardest isolation. Con:
  spec explicitly says single deployment serves many families; operationally
  absurd at any scale. Rejected outright.

**Decision:** Option B. Top-level collections (`families`, `users`, `events`,
`posts`, `chores`, `transactions`, `invites`); every non-`families` doc carries
an immutable `familyId`. `users/{uid}` keyed by Auth UID. The caller's
`familyId` is read from their own `users/{uid}` doc inside the rules via
`get()`, never trusted from the request.

**Rationale:** Matches the locked preference and spec shape; keeps paths flat
for future collections; isolation is achievable in rules with disciplined helper
functions (ADR-0002). Accepts that rule discipline (not path structure) is the
isolation mechanism — mitigated by mandatory emulator tests for cross-tenant
denial (Task 5).

**Reversibility:** **Hard.** Changing the tenant model after data exists is a
full migration. This is why it is a human gate.

**Consequences:** (+) flat, spec-aligned, extensible. (-) every rule must
re-assert family scope; one forgotten predicate is a breach. Risk mitigated by
isolation test suite and security-critical review (no autonomous merge).

**Compliance check:** Aligns with `constraints.md` tenant-isolation section.
Threat-modeler must enumerate cross-tenant paths. No cross-border transfer
added here. No new subprocessor.

---

## ADR-0002 — Security rules as the authorization boundary: shared helper functions

**Status:** Proposed (awaiting human gate — touches firestore.rules / role model)
**Date:** 2026-05-26
**Decider(s):** architect (proposed); user (approval pending)

**Context:** `firestore.rules` is THE authorization boundary (`constraints.md`).
We need a consistent, testable way to enforce: tenant scope, role (parent vs
member), own-doc-vs-any-doc, active status, and immutability of `role`/`familyId`.

**Decision drivers:** correctness over cleverness; every collection re-uses the
same predicates; immutability and no-self-elevation are the highest-value rules.

**Options considered:**
- **A — Inline checks per collection.** Con: copy-paste drift, the exact failure
  mode that causes a leak. Rejected.
- **B — Shared `function` helpers in rules** (chosen): `isSignedIn()`,
  `callerDoc()` = `get(/databases/$(db)/documents/users/$(request.auth.uid))`,
  `callerFamily()`, `isActive()`, `isParent()`, `isMember()`,
  `sameFamily(resource)` = `resource.data.familyId == callerFamily()`,
  `incomingSameFamily()` for creates, and `immutable(field)` =
  `request.resource.data[field] == resource.data[field]`.

**Decision:** Option B. Concretely:
- Every read/list/write on a tenant collection requires
  `isSignedIn() && isActive() && sameFamily(...)`.
- `users` create allowed only for own UID during signup bootstrap with
  `role == 'parent'` and `familyId` == newly created family (see ADR-0006);
  invited members' `users` docs are created by the claim flow (ADR-0003).
- `users` update: a user may edit own `name`/`theme` only; `role`, `familyId`,
  `email`, `isActive`, `allowanceBalance` are NOT client-writable by the subject
  (`immutable('role')`, `immutable('familyId')`). `isActive` and member
  `allowanceBalance` writable only by a parent of the same family.
  `allowanceBalance` writes also gated by the transaction batch shape (ADR-0004).
- `chores`: member may write only docs where `assignedTo == uid` and only the
  status transition `pending -> complete`; parents write any chore in-family
  (incl. approve/reject). `pointValue`/`dollarValue`/`assignedTo` immutable after
  create except by a parent.
- `invites`: create/read/delete only by a parent of the same family; the claim
  path (ADR-0003) reads a single invite by id.
- `families`: read by any active member of that family; write only by a parent
  of that family.
- No unauthenticated access to any collection.

**Reversibility:** **Medium** — rules are deployable independently, but a model
change cascades to client queries. Changes are human-gated regardless.

**Consequences:** (+) DRY, testable, auditable. (-) `get()` calls in rules cost
one document read each and add latency; mitigated because the caller doc is read
once per evaluation and the access pattern is low-RPS (family-scale).

**Compliance check:** Core to `constraints.md` access-control baseline. Requires
the emulator isolation/role/immutability test suite (Task 5) before any merge.
Security-critical: no autonomous merge.

---

## ADR-0003 — Invite / member account creation: Cloud Function + invite-doc claim

**Status:** Proposed (HUMAN GATE — adds Cloud Functions, Blaze plan, email subprocessor)
**Date:** 2026-05-26
**Decider(s):** architect (proposed); user (approval pending)

**Context:** A parent invites a member or co-parent by email; the system "creates
an account and sends a setup email." In a pure client-side Firebase app you
**cannot** create another user's Auth account without signing the parent out,
and you cannot send email from an untrusted client. This is the hardest
architectural decision in the app.

**Decision drivers:** parental consent at the tenant boundary (children never
self-register); no parent sign-out side effects; no PII in transit to untrusted
parties; cost; reversibility; the children's-data rule against marketing email.

**Options considered:**
- **A — Pure client-only, parent creates a second Auth user.** Fails: creating a
  user via the client SDK signs the parent out / in as the new user. Unworkable
  for co-parents and clumsy for children. Rejected.
- **B — Invite-doc + recipient self-claims via Firebase Auth email link.** Parent
  writes an `invites/{id}` doc; recipient gets an emailed link, creates their own
  Auth credential, then a client/Function step attaches them to the family by
  consuming the invite. Pro: no extra backend if using Auth's built-in email
  actions. Con: **children under 13 cannot self-register or operate an email
  inbox** — this breaks the parent-mediated-creation constraint for the primary
  member type. Workable only for adult co-parents. Rejected as the general
  mechanism.
- **C — Cloud Function with Admin SDK + transactional email provider** (chosen).
  A parent-only callable Function (a) verifies the caller is an active parent of
  the family, (b) creates the member's Auth user server-side (children: a
  parent-set credential, no email required; adults: a setup/reset email), (c)
  atomically creates the `users/{uid}` doc with the correct `familyId`/`role`/
  `isActive`, and (d) writes/clears the `invites` doc. The Admin SDK is the only
  trusted context that can mint another user's account without disturbing the
  parent's session.

**Decision:** Option C, with a hybrid recipient experience:
- **Child member:** parent provides display name + a parent-set initial password
  in the Family Management UI. The Function creates the Auth user + `users` doc
  server-side; no email is sent to or about the child (honors the
  no-outbound-email-to-children rule). The child signs in with credentials the
  parent communicates in person.
- **Adult member / co-parent:** Function creates the account and sends a single
  transactional setup/password email via the chosen provider.

**Email subprocessor:** flagged human gate. Recommend a provider with a Canadian
or configurable region and a DPA (e.g. a transactional ESP); final choice is the
user's. Until approved, the adult-invite email path stays disabled; child-member
creation (no email) can ship first.

**Reversibility:** **Medium.** Adding the Function requires the **Blaze**
(pay-as-you-go) plan — that step is itself a human gate and is hard to walk back
operationally once families depend on it. The email provider is **Easy** to swap.

**Consequences:** (+) honors parent-mediated creation for children; no parent
sign-out; server-side enforcement of role/family on creation; (-) introduces a
backend surface (Function), Blaze billing, and an email subprocessor — three
flagged decisions. Risk: Function is a new trust boundary and abuse vector
(invite spam) — mitigate with parent-only auth check + rate limiting + per-family
member cap (threat-modeler to detail).

**Compliance check:** Children's-data rule (no email to/about children) honored
by the no-email child path. Email subprocessor requires DPA + vendor assessment
+ human approval (`constraints.md` third-parties). Blaze plan = cost gate.
Function logs must scrub PII.

---

## ADR-0004 — Allowance atomicity: Firestore transaction couples balance + ledger

**Status:** Proposed
**Date:** 2026-05-26
**Decider(s):** architect

**Context:** On chore approval the member's `allowanceBalance` must increase AND
a `transactions` ledger doc must be written — both or neither — with no
double-credit if a parent taps Approve twice or two parents approve concurrently.

**Decision drivers:** correctness (no lost or duplicated money-tracking),
idempotency, server-enforceable.

**Options considered:**
- **A — Two separate client writes.** Con: partial failure leaves balance and
  ledger inconsistent; no atomicity. Rejected.
- **B — Client-side `runTransaction`** reading the chore (assert status ==
  `complete`), flipping it to `approved`, incrementing `users.allowanceBalance`,
  and creating the `transactions` doc — all in one Firestore transaction
  (chosen). Idempotency from the status guard: a second approve sees status !=
  `complete` and aborts.
- **C — Do it inside a Cloud Function.** Stronger trust boundary, but the
  transaction's correctness is already enforceable in rules + the status guard,
  and we avoid forcing the Function/Blaze dependency onto the core loop. Keep as
  a future hardening option if abuse appears.

**Decision:** Option B now. The transaction: (1) re-read chore; abort unless
`status == 'complete'` and same family; (2) set `status = 'approved'`; (3)
`increment(users/{assignedTo}.allowanceBalance, dollarValue)`; (4) create
`transactions/{id}` with `type:'earning'`, `amount`, `choreId`, `choreTitle`,
`familyId`. Rules additionally require: balance writer is a same-family parent,
the delta direction is non-negative, and the matching chore transition is valid.
Rejection path: set `status='rejected'` + `rejectionReason`, no balance write.

**Reversibility:** **Easy** — can be promoted into a Function (Option C) later
without data migration.

**Consequences:** (+) atomic, idempotent, no extra infra. (-) correctness leans
on the rules + status guard rather than a server-only writer; covered by tests
(double-approve, concurrent-approve, reject-then-approve).

**Compliance check:** No real money (`constraints.md` Money section unchanged —
tracked numbers only). No new subprocessor.

---

## ADR-0005 — Offline persistence: Firestore IndexedDB cache + Workbox app-shell

**Status:** Proposed
**Date:** 2026-05-26
**Decider(s):** architect

**Context:** Offline-first PWA is a locked preference: Firestore offline
persistence, app-shell cache, offline fallback page, pull-to-refresh on Dashboard
and Board.

**Decision drivers:** offline read/write of family data; multi-tab safety;
children's-data minimization (cache lives on-device only).

**Options considered:**
- **A — No persistence (memory cache only).** Fails the offline-first
  requirement. Rejected.
- **B — `persistentLocalCache` with `persistentMultipleTabManager`** for
  Firestore + `vite-plugin-pwa`/Workbox for the app shell and an offline
  fallback route (chosen). Firestore queues writes offline and replays on
  reconnect; last-write-wins per field on the server.

**Decision:** Option B. Enable Firestore persistent cache with multi-tab manager.
Workbox precaches the app shell, runtime-caches static assets, and serves an
offline fallback page for navigations. Pull-to-refresh on Dashboard and Board
forces a server fetch. Document the LWW conflict behavior (ADR consequence) for
the rare concurrent-edit case.

**Reversibility:** **Easy** — a config flag on the Firestore instance and the PWA
plugin.

**Consequences:** (+) works offline, fast warm loads. (-) cached family data
(incl. a child's name/content) persists in the device's IndexedDB — acceptable
because it never leaves the device and is the same data the user is entitled to;
sign-out should clear the cache. (-) offline edits resolve last-write-wins, which
can silently overwrite a concurrent field change; acceptable at family scale,
surfaced to threat-modeler.

**Compliance check:** No third party. On-device only; clear cache on sign-out.
TLS in transit, AES-256 at rest are Firebase-provided.

---

## ADR-0006 — Family bootstrap at signup: atomic create of family + parent user

**Status:** Proposed (touches role/tenant model — human gate)
**Date:** 2026-05-26
**Decider(s):** architect (proposed); user (approval pending)

**Context:** Signup by a founding parent must create the `families/{familyId}`
doc AND the `users/{uid}` doc (role=parent, the new familyId) together. This is
the ONLY path where `role == 'parent'` is self-assigned, and the only legitimate
self-set of a `familyId`.

**Decision drivers:** atomicity (no orphan family or orphan parent), no
self-elevation loophole that generalizes beyond signup, immutability afterward.

**Options considered:**
- **A — Client `writeBatch` after Auth signup** (chosen, no-Function path):
  after `createUserWithEmailAndPassword`, a single batch creates
  `families/{newId}` (`createdBy == uid`) and `users/{uid}`
  (`role:'parent', familyId:newId, isActive:true, allowanceBalance:0`). Rules
  permit a `users` self-create with `role=='parent'` ONLY when the request also
  establishes the caller as the family creator and the doc is keyed to the
  caller's own UID and the familyId is freshly created. Co-parents/members never
  use this path (they come through ADR-0003).
- **B — Cloud Function bootstrap.** Stronger, but forces the Blaze dependency on
  the very first user action. Defer; revisit if the client-rule guard proves
  insufficient under threat-modeling.

**Decision:** Option A, with the signup-only self-create carefully bounded in
rules so it cannot be replayed to elevate an existing member. The exact rule
predicate is security-critical and a threat-modeler focus.

**Reversibility:** **Hard** (it is the tenant-creation seam). Human-gated.

**Consequences:** (+) no extra infra for the core onboarding. (-) the
"self-create as parent" rule is the single most dangerous predicate in the app;
must be proven to be non-generalizable (cannot create a second family for an
existing user, cannot flip an existing member). Heavy test coverage required.

**Compliance check:** Parental consent established at this boundary (founding
parent consents for the family). ToS/Privacy acceptance captured here (the
signup fine-print) — privacy policy/ToS content is a separate human gate.

---

## ADR-0007 — Design tokens to Tailwind: tokens are the single source of truth

**Status:** Proposed
**Date:** 2026-05-26
**Decider(s):** architect

**Context:** Design tokens are locked and pixel-perfect (`preferences.md`). BUT
the repo's `design-tokens.json` is largely placeholder content (generic blue
`#0066cc` accent, "TO BE SET" everywhere, no dark mode) and **does not match**
the design handoff (`design/handoff/README.md`), which specifies indigo `#3730A3`
brand, amber accent, the slate-based ink/surface palette, the 4/6/8/10/12/14/16/
20/24/32/44 spacing scale, and a specific type scale. **This mismatch is flagged,
not silently resolved.**

**Decision drivers:** one source of truth; no magic numbers in components; the
handoff is described as the high-fidelity finalized reference.

**Options considered:**
- **A — Treat the existing `design-tokens.json` as truth.** Wrong: it is
  placeholder scaffolding, contradicts the finalized handoff. Rejected.
- **B — Reconcile `design-tokens.json` to the handoff, then build the Tailwind
  theme from the reconciled token file** (chosen). The handoff README is the
  authoritative palette/type/space/radius/shadow source; the JSON is updated to
  match (a designer-agent task, human-reviewed since tokens are "locked"), then
  `tailwind.config.ts` `theme.extend` consumes ONLY those token values.

**Decision:** Option B. The PWA manifest theme color is `#3730A3` per spec. Note
the handoff has **no dark-mode palette** despite `preferences.md` requiring dark
mode and `users.theme` supporting `dark` — this gap is surfaced to the designer
as an open item (do not invent dark values here).

**Reversibility:** **Easy** — regenerating the Tailwind theme from tokens is
mechanical.

**Consequences:** (+) single source of truth, pixel-perfect. (-) the token
reconciliation must be human-approved because tokens are "locked"; the missing
dark palette blocks full dark-mode delivery until the designer fills it.

**Compliance check:** AODA/WCAG 2.1 AA contrast must be re-audited after
reconciliation in both light and dark (the JSON's contrast audit is currently
light-only and based on the wrong palette). No data/privacy impact.

---

## ADR-0008 — Adult email moves out of the family-readable `users` doc into `userPrivate/{uid}`

**Status:** Accepted (implemented Phases 1-2; arose from the privacy review)
**Date:** 2026-05-27
**Decider(s):** orchestrator (proposed from privacy-reviewer finding); user (PR gate)

**Context:** The original model put `email` on `users/{uid}`, which is readable
by every active member of a family (the member list, "The Fam" row, etc.).
Firestore rules are document-level, not field-level, so a child member's client
would receive every adult's full `users` doc — including their email **[PI]**.
The privacy review flagged this as over-disclosure of adult PI to children
(PIPEDA Principles 4/5; constraints §Children's-data). The exploit becomes real
once child members exist (Phase 3), but the model seam is set now.

**Decision:** Remove `email` from the family-readable `users` doc. Store it in a
new `userPrivate/{uid}` collection, written atomically in the same signup batch.
Rules: a `userPrivate` doc is readable only by (a) the subject themselves
(active) or (b) a same-family parent; `list` is denied; `create` is self-keyed
(works for the founding-parent bootstrap, who has no `users` doc yet); `update`
is self-keyed with immutable `familyId`; `delete` denied. Firebase Auth still
holds the email for login, so `users` does not need it. Parent-only features
that must show member emails (Family Management, Phase 3) read `userPrivate`.

**Rationale:** Data minimization by construction — children's clients never
receive adult email. Cheaper to set the seam now (only the founding parent
exists) than to migrate after child accounts are created. Keeps document-level
rules sufficient (no need for field-level masking that Firestore can't do).

**Reversibility:** Medium — it is a collection split; reverting after data
exists is a migration. Done before any child data exists, so cost is near-zero
now.

**Consequences:** (+) adult PI not exposed to child members; (+) clean
parent-only read path for emails. (-) one extra doc per user; (-) `email` is now
absent on `User`, so any future feature needing it on the member list must
re-justify the purpose (and must not expose it to children).

**Compliance check:** PIPEDA minimization/limiting-disclosure satisfied;
constraints §Children's-data honored. The child-credential model (ADR-0006 Q3 —
whether children even have an email) remains an open invite-phase decision; this
ADR only governs where an adult's email lives.

---

## ADR-0009 — Allowance money stored as integer cents

**Status:** Accepted (Phase 3, chores-parent feature)
**Date:** 2026-05-27
**Decider(s):** orchestrator (from second-opinion + adversarial review); user (approved)

**Context:** The allowance fields (`chores.dollarValue`, `transactions.amount`,
`users.allowanceBalance`) were initially JS floats (dollars). Independent
second-opinion and adversarial reviews flagged floating-point drift: repeated
`increment()`s of values like $0.10 accumulate IEEE-754 error, the stored
balance can diverge from the ledger sum, and `Intl` formatting cosmetically
masks it. Fixing the representation after live balances exist is a migration
over real data.

**Decision:** Store all money as **integer cents** (whole numbers). `pointValue`
stays integer points. Display formats to "$X.XX" via `formatMoney(cents)`.
Firestore rules require these fields to be `is int && >= 0 && <= MONEY_MAX_CENTS`
($1,000,000 cap). The Add Chore form accepts dollars and converts to cents
(`Math.round(dollars*100)`) at the boundary.

**Rationale:** Integer cents is standard money handling — exact arithmetic, no
drift. Done now (before any real allowance accumulation) it costs a contained
refactor; deferred it becomes a live-data migration.

**Reversibility:** Hard once balances accumulate — which is exactly why it was
done now.

**Consequences:** (+) exact balances/ledger; (-) every money read/write/display
goes through cents↔dollars conversion; a value cap is enforced.

**Compliance check:** Allowance remains tracked-numbers-only (no real money,
PCI out of scope, ADR-0004 / constraints unchanged).

---

## ADR-0004 addendum — balance/ledger is not a rules-enforced invariant

**Date:** 2026-05-27 (consequence noted from the second-opinion review)

ADR-0004 chose a client `runTransaction` for chore approval (the Cloud Function
was deferred with the Blaze gate). Because Firestore rules cannot distinguish
the approval transaction's `allowanceBalance` write from a bare write, the rule
(`parentAllowanceCredit`) permits a same-family parent to write
`allowanceBalance` (non-negative) WITHOUT a matching ledger entry.

**Consequence the owner accepted:** "balance == sum of earning ledger entries"
is **not** an enforceable invariant. The `transactions` ledger is a record of
**approval-driven** credits, not an authoritative audit trail of the balance — a
manually-adjusted balance would show unexplained deltas. Integrity of the
normal approval path rests on the transaction's status-guard + tests, not rules.
Revisit if/when the approval moves to a Cloud Function (server-only balance
writes would let the rules deny all client balance writes). Tracked-numbers-only
and fully tenant-isolated, so the blast radius is one family's own numbers.

---

## ADR-0010 — Stay on Firebase Spark; tier-gated features ship dormant

**Date:** 2026-06-08
**Status:** Accepted.
**Decision owner:** the user.

### Context

Two features built for v1 require the Blaze (pay-as-you-go) billing plan to
function in production:

  - **Chore Photo Verification** (PRs #76/#77/#79) uses Firebase Storage to
    hold proof images. Storage requires Blaze to initialize a bucket.
  - **Recurring chores via Cloud Function** (originally scoped for ADR-0003)
    was deferred because Functions require Blaze.

Project default is Spark (free tier, no billing account). The user has
explicitly said Blaze is a separate human decision tied to actual usage.

### Decision

**Stay on Spark.** Tier-gated features ship in the codebase (typed,
tested, reviewed) but are **dormant in production**: the deploy step that
would activate the gated service is excluded from `deploy.yml`.

  - `storage:rules` is NOT in the `firebase deploy --only` list for either
    the staging or production job (PR #84).
  - Cloud Functions has no `functions` deploy step.
  - The application code (`chorePhotoService`, the `markCompleteWithProof`
    UI, the storage emulator rules-test suite) is fully present in the
    bundle and the rules-test suite still gates it locally on every
    `make verify`.

### Consequence

  - A user who tries to attach a chore photo on production will hit a
    Firebase-side error because the bucket doesn't exist. We accept this:
    the affordance is reachable, and the failure is honest. The UI surface
    is small and the feature is "advanced" (parent-discoverable, not on
    the primary path).
  - Activating any tier-gated feature is a one-PR change (revert PR #84
    for Storage; analogous step for Functions) PAIRED with a Firebase
    Console action (enable Blaze, initialize Storage on the project).
    Documented in PR #84's body and in `deploy.yml`'s comment.
  - **Never silently couple a deploy step to a Blaze feature.** A deploy
    that mixes tier-gated services with always-on ones (Firestore,
    Hosting) creates a billing-plan trap — Firestore changes get blocked
    because Storage isn't initialized. Each Firebase service gets its own
    `--only <service>` invocation. See lessons.md (2026-06-08).

Cross-references: ADR-0003 (Blaze human-gate for invites originally),
ADR-0004 addendum (allowance moves to a Cloud Function if/when Blaze
lands).

---

## ADR-0011 — Checklist authorship model: creator + parents edit; instances pin `userId` to `auth.uid`

**Date:** 2026-06-08
**Status:** Accepted.
**Decision owner:** the user (Q-A this session).

### Context

The Task Management feature (PRs #81/#82/#83) introduces two new
authorization shapes that don't fit ADR-0002's existing parent-or-creator
defaults:

  - **`checklistTemplates`:** repeatable routines a family member creates
    (morning routine, sports bag). The literal spec said "anyone in the
    family can edit anything," but that opens a sibling-prank surface: a
    younger sibling renames an older sibling's morning routine to "Eat
    worms" and the morning routine breaks. The user explicitly chose a
    stricter model.
  - **`checklistInstances`:** a live run of a template ("this morning's
    routine"). Could plausibly be created by a parent on behalf of a kid
    ("I'm starting your routine for you") OR strictly by the kid. The
    user chose the strict model.

### Decision

**Templates: creator + same-family parent edit and delete.** Any active
same-family caller CREATES; READ is gated by `isSharedWithFamily` (shared
→ whole family; draft → only the creator); UPDATE and DELETE are
restricted to the creator OR any same-family parent. Rules enforced in
`firestore.rules` (`checklistTemplates` match block); UI mirrors the
predicate so the affordance is hidden when the rule would deny.

**Instances: `userId` MUST equal `request.auth.uid` on CREATE.** A
parent cannot create an instance on behalf of a kid. UPDATE is
owner-only (the running user). DELETE is owner OR same-family parent
(for cleanup of stale runs). Rules enforced in `firestore.rules`
(`checklistInstances` match block); the service always passes
`currentUser.id`.

### Consequence

  - Sibling pranks on templates are blocked at the rule layer. A parent
    who needs to clean up a malformed template still has the affordance
    (covers the "kid abandoned a half-built routine" case).
  - "Parents don't impersonate" is a real authorization boundary: parents
    can READ a kid's instances (to see kid progress) but cannot CREATE
    one as the kid. This matches the rest of the app's authorship model
    — every doc's `createdBy` / `userId` ties to the actual caller.
  - The rules-test suite (`test/rules/checklists.test.ts`) pins both
    branches: 52 cases covering the cross-product of role × verb ×
    same-family / cross-tenant.

Cross-references: ADR-0002 (rules-as-authorization-boundary; this is a
new concrete pattern under that umbrella).

## ADR-0012 — Recurring events: spawn-on-create-N siblings sharing `recurrenceGroupId`

**Status:** Accepted (Feature 3, PRs #93/#94)
**Date:** 2026-06-09
**Decider(s):** orchestrator (proposed); user (approved at PR gate)

**Context:** "Recurring calendar events" was on the v1 list. Two
architectural shapes were on the table:
  - **Virtual instances:** persist ONE source event + recurrence
    rule; expand to occurrences at read time in the client.
  - **Materialized siblings:** at create time, spawn N concrete
    `events/{id}` docs (one per occurrence), tied together by a
    shared `recurrenceGroupId`.

**Decision:** Materialized siblings, capped at 26 occurrences
(`RECURRENCE_MAX` in `calendarService.ts`, mirrored as
`recurrenceCount <= 26` in `firestore.rules`). One `writeBatch`
spawns the whole series.

**Rationale:**
  - The one-doc-per-item pattern (see `patterns.md`) is the
    project's default — edits, deletes, and per-item rule
    predicates work the same as a one-off event.
  - No client-side expansion code path means the calendar +
    dashboard widgets reuse the existing event hooks unchanged —
    a recurring instance IS an event.
  - Cap-at-26 = ~6 months weekly / 2 years monthly. Beyond that,
    "make a new series" is the better UX anyway.
  - Avoids the "rules can't reliably gate a virtual-instance
    write" trap: every materialized instance has a `familyId` the
    rule layer can scope.

**Reversibility:** Medium. Adding virtual instances later would
require migrating existing materialized series (or letting them
coexist). 26-doc series are cheap to delete and re-spawn during
a transition.

**Consequences:** (+) reuses the existing event read/write/rule
machinery; per-instance edits are trivial. (-) up to 26x write
fanout at create time; "edit the whole series" is N writes; a
26-instance series consumes 26 doc-reads on the agenda view (still
trivial at family scale). Series delete uses a
`recurrenceGroupId` + `familyId` filter so cross-tenant deletes
are impossible.

Cross-references: ADR-0001 (top-level collections), patterns.md
(one-doc-per-item).
