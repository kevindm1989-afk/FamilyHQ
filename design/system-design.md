# Family HQ — System Design (for the approval gate)

**Status:** Proposed. No application code is written. This plan must be approved
at the human gate before any implementation begins, and the threat-modeler runs
next on approval.

**Author:** architect agent · **Date:** 2026-05-26

---

## 0. One-page summary (read this first)

Family HQ is a commercial, multi-tenant SaaS PWA on a **fixed** stack: React 18
+ Vite + TypeScript, Firebase v10 (Firestore + Auth), Tailwind, React Router v6,
vite-plugin-pwa/Workbox. One Firebase project serves many independent families.
Children under 13 are users, created and managed by a parent guardian.

The design rests on six load-bearing decisions (full ADR-0001..0007 in
`.context/decisions.md`):

1. **Flat top-level collections, `familyId` on every doc** (ADR-0001). Matches
   the spec and the locked preference; tenant isolation is enforced by
   `firestore.rules` predicates, not path structure.
2. **Security rules with shared helper functions** as THE authorization boundary
   (ADR-0002) — `isParent`, `isActive`, `sameFamily`, `immutable(field)`.
3. **Invite via a parent-only Cloud Function + Admin SDK** (ADR-0003). This is
   the hardest decision: a pure client app cannot create another user's account
   without signing the parent out, and cannot send email from an untrusted
   context. The Function forces the **Blaze** plan and (for adult invites) an
   **email subprocessor** — both human gates. Children are created with no email
   (parent-set credential), honoring the no-email-to-children rule.
4. **Allowance atomicity via a Firestore transaction** coupling balance increment
   + ledger write, idempotent by a status guard (ADR-0004).
5. **Offline-first** via Firestore persistent IndexedDB cache + Workbox app shell
   (ADR-0005).
6. **Family bootstrap at signup** via an atomic client batch — the only place
   `role=parent` is self-assigned (ADR-0006).
7. Plus: **design tokens are the single source of truth**, and the repo's
   `design-tokens.json` is placeholder scaffolding that **does not match** the
   finalized handoff — flagged, not silently changed (ADR-0007).

**The single worst failure mode is cross-tenant leakage of children's data.**
Every design choice below is subordinate to preventing it.

---

## 1. Non-functional requirements (stated + inferred)

The spec does not give explicit scale/latency numbers. Firebase's model and the
"family" unit bound them, so I state assumptions rather than invent precision:

| NFR | Position | Basis |
| --- | --- | --- |
| **Scale** | Many families, each ~2-8 members. MVP: low hundreds of families. 10x: low thousands. Per-family data is small (tens-to-hundreds of docs). | Firebase scales horizontally; the constraint is rules-read cost, not row count. |
| **Latency** | Interactive reads from local cache are instant; server round-trips target <500ms p95. Not a hard-RT product. | Offline-first cache absorbs most reads. |
| **Availability** | Best-effort on Firebase's SLA. No custom HA. Downtime cost is low (family scheduling app, not life-safety). | No requirement justifies multi-region. |
| **Durability** | `transactions` ledger and `users.allowanceBalance` must never be silently lost or double-counted. Posts/events/chores are important but regenerable by re-entry. | Allowance is the integrity-sensitive data. |
| **Compliance** | **PIPEDA** (in force), **Ontario AODA/WCAG 2.1 AA**, children's-data minimization. PHIPA/FIPPA/PCI **not** in scope (no health, no government, no real money). Quebec Law 25 / COPPA / GDPR-K = launch-gate triggers. | `constraints.md`. |
| **Budget** | No ceiling stated. Free (Spark) plan covers everything **except** Cloud Functions. The invite Function forces **Blaze** (pay-as-you-go). Flag cost at the gate. | ADR-0003. |
| **Lifecycle** | Long-lived production SaaS. Bias hard-to-reverse choices to boring. | Commercial product. |

**If any of these are wrong, correct them at the gate — the invite mechanism and
the Blaze decision in particular depend on the lifecycle answer.**

---

## 2. System design

### 2.1 Components & responsibilities

- **PWA client (React/Vite/TS).** The whole UI and most logic. Feature modules
  own their Firestore access. Talks to Firebase Auth and Firestore directly.
  Interface to backend: Firebase JS SDK v10 (modular).
- **Firebase Auth.** Identity. Email/password. Issues the UID that keys
  `users/{uid}`. Interface: SDK.
- **Cloud Firestore.** System of record. Top-level collections, `familyId`-scoped.
  Interface: SDK + `firestore.rules` as the authorization boundary.
- **`firestore.rules`.** The authorization layer. Not a component you call — it
  gates every Firestore op. Enforces tenant isolation, roles, immutability,
  active-status. (ADR-0002.)
- **Invite Cloud Function (parent-only callable, Admin SDK).** The only trusted
  context. Creates member/co-parent accounts, sends adult setup email, manages
  `invites`. (ADR-0003.) Interface: HTTPS callable.
- **Email subprocessor (adult invites only).** Sends one transactional setup
  email. Human-gated, DPA required. Disabled until approved. (ADR-0003.)
- **Workbox service worker.** App-shell precache, runtime asset cache, offline
  fallback navigation. (ADR-0005.)

### 2.2 Data model (core entities)

`familyId` is on every non-`families` doc and is **immutable from the client**.
PI markers: **[PI]** personal info, **[PI-child]** may belong to a child.

- **`families/{familyId}`** — `familyName`, `createdBy` (uid), `createdAt`.
  Replaces the spec's `settings/family` singleton.
- **`users/{uid}`** — `name` **[PI/PI-child]**, `email` **[PI]** (parents/adults;
  children may have a synthetic/no email — see open question Q3),
  `role` (`parent`|`member`, **immutable from client**),
  `familyId` (**immutable**), `allowanceBalance` (number, parent/transaction-
  written only), `isActive` (parent-written only), `theme` (`light`|`dark`, self-
  writable). Keyed by Auth UID.
- **`events/{id}`** — `title`, `description`, `date` (ISO), `tag`
  (`school`|`sports`|`family`|`work`), `familyId`, `createdBy`, `createdAt`.
- **`posts/{id}`** — `content` **[PI/PI-child]**, `authorId`, `authorName`
  **[PI]**, `familyId`, `createdAt`.
- **`chores/{id}`** — `title`, `assignedTo` (uid), `dueDate`, `pointValue`,
  `dollarValue`, `status` (`pending`|`complete`|`approved`|`rejected`),
  `rejectionReason`, `familyId`, `createdBy`, `createdAt`, `isRecurring`,
  `recurrenceFrequency` (`none`|`weekly`|`biweekly`).
- **`transactions/{id}`** — `uid`, `sourceId`, `sourceLabel`, `amount`,
  `type` (`earning`|`spending`), `familyId`, `createdAt`. Append-only ledger.
- **`invites/{id}`** — `email` **[PI]**, `role`, `familyId`, `invitedBy`,
  `createdAt`, `status` (`pending`|`accepted`). Parent-written only.

**Relationships:** a `family` has many `users`; a `user` belongs to exactly one
`family`. `chores.assignedTo` -> a `user` in the same family. `transactions.uid`
-> a `user`; `transactions.sourceId` -> a `chore` (earning) or `wishlistItem` (spending). `posts.authorId`,
`events.createdBy`, `chores.createdBy`, `invites.invitedBy` -> `users`.

**Role naming:** spec/handoff say `teen`; we use **`member`** everywhere (parent
vs member). The handoff's Sarah/David/Maya/Ben are reference only — never
hardcoded; member lists derive from live `users` of the caller's family, active
only.

### 2.3 Data flow & trust boundaries

```
[Family member device / PWA]  --TLS-->  [Firebase Auth]      (identity)
        |                                       |
        |  (Firestore SDK, every op gated by firestore.rules)
        v                                       v
  [Cloud Firestore] <======= rules: tenant + role + active + immutability
        ^
        |  (Admin SDK, bypasses rules — trusted)
  [Invite Cloud Function]  --->  [Email subprocessor]  (adult invites only)
```

**Trust boundaries (feed the threat-modeler):**

- **TB1 client <-> Firestore.** The client is untrusted. `firestore.rules` is the
  only thing standing between a family and another family's children's data.
- **TB2 client <-> Invite Function.** The Function runs with Admin privileges and
  bypasses rules; it must re-verify the caller is an active parent of the family
  it acts on. Abuse vector: invite spam, creating accounts in another family.
- **TB3 Function <-> email subprocessor.** PI (an adult email) crosses to a third
  party. DPA + region scrutiny. No child PI ever crosses here.
- **TB4 device <-> on-device cache.** Firestore IndexedDB cache holds family data
  (incl. child names/content) at rest on the device. Clear on sign-out.

### 2.4 Security-rules strategy (ADR-0002, the heart of the system)

Helper functions, used uniformly:
- `isSignedIn()` — `request.auth != null`.
- `callerDoc()` — `get(.../users/$(request.auth.uid))`.
- `callerFamily()` — `callerDoc().data.familyId`.
- `isActive()` — `callerDoc().data.isActive == true`.
- `isParent()` — `isActive() && callerDoc().data.role == 'parent'`.
- `isMember()` — `isActive() && callerDoc().data.role == 'member'`.
- `sameFamily(res)` — `res.data.familyId == callerFamily()`.
- `incomingSameFamily()` — `request.resource.data.familyId == callerFamily()`.
- `immutable(f)` — `request.resource.data[f] == resource.data[f]`.

Enforcement summary (full predicates are a Task-5 deliverable, security-critical):
- **Tenant isolation:** every tenant-collection read/list/write requires
  `isSignedIn() && isActive() && sameFamily(...)` (and `incomingSameFamily()` on
  create). No query may omit the family predicate. List queries must be
  constrained to `where('familyId','==',myFamilyId)`.
- **No role self-elevation / no tenant reassignment:** on `users` update by the
  subject, `immutable('role') && immutable('familyId') && immutable('email') &&
  immutable('isActive') && immutable('allowanceBalance')`. Subject may change
  only `name` and `theme`.
- **Signup self-create (ADR-0006):** the ONLY `users` create with `role=='parent'`
  is the founding-parent bootstrap, bounded so it cannot create a second family
  for an existing user nor flip an existing member. Threat-modeler must prove
  non-generalizable.
- **Active gating:** `isActive()` is part of every authenticated predicate, so
  `isActive:false` users are denied beyond the UI.
- **Roles:** members write only own chore docs (`assignedTo == uid`) and the
  `pending -> complete` transition; parents write any in-family doc. `invites`
  and `families` writes are parent-only, family-scoped.
- **Allowance (ADR-0004):** `allowanceBalance` writable only by a same-family
  parent, and the approval transaction must move a chore `complete -> approved`
  and append a matching `transactions` doc.

### 2.5 Feature-module layout

```
src/
  firebase/config.ts            # SDK init, persistentLocalCache, exports
  components/                   # shared primitives (Avatar, Card, Button,
                                #   Badge, TextField, TopBar, BottomNav, FAB,
                                #   Toast, BottomSheet, EmptyState, Skeleton)
  hooks/                        # cross-cutting: useAuth, useFamily, useToast,
                                #   useOnlineStatus, usePullToRefresh
  lib/                          # converters, query helpers, validators
  features/
    auth/                       # login modes, signup bootstrap, forgot
    dashboard/                  # roll-up
    calendar/                   # month grid + agenda, add event
    board/                      # feed, compose
    chores/                     # parent view, member view, add chore, approval txn
    allowance/                  # balance, transaction history
    family/                     # parent-only: members, invite, rename, deactivate
  app/                          # router, shell, providers
```

Each feature owns its components, hooks, and Firestore access. Shared primitives
never import from features. Cross-family data never enters a hook — every query
is `familyId`-scoped at the source.

### 2.6 Client data-access pattern

- **Typed Firestore converters** (`withConverter`) per collection in `src/lib/`,
  giving compile-time-typed reads/writes and a single place to assert shape.
- **One hook per feature query** (e.g. `useFamilyChores`, `useMyChores`,
  `useFamilyPosts`), each (a) reads `familyId` from `useFamily()`, (b) always
  applies the `familyId == myFamilyId` `where` clause, (c) returns
  `{ data, loading, error }` so every section ships loading + empty states.
- **All mutations route through a feature service** that wraps the write and
  fires a toast on success/error; errors are mapped to generic, PII-free toast
  copy.

### 2.7 Offline / PWA (ADR-0005)

- Firestore `persistentLocalCache` + `persistentMultipleTabManager`.
- `vite-plugin-pwa` (Workbox): precache app shell, runtime-cache static assets,
  offline fallback page for navigations.
- Manifest: name "Family HQ", short_name "FamilyHQ", theme `#3730A3`.
- Pull-to-refresh on Dashboard + Board forces a server fetch.
- Clear Firestore cache on sign-out (privacy — TB4).

### 2.8 Observability hooks (feed observability-setup)

- **Logs:** structured, PII-scrubbed. Function logs: invite attempts (familyId +
  actor uid only, never invitee child name), denied-by-rules counts. **No child
  name/content, no email, ever** in logs.
- **Metrics:** signups, invites sent/claimed, chore approval rate, rules-deny
  rate (a spike may indicate an isolation probe), Function error rate, offline
  write-replay failures.
- **Traces:** Function execution (invite path) latency/errors.
- **Explicitly NOT added:** analytics/session-replay/ads SDKs — forbidden while
  children are users (`constraints.md`). Error tracking, if ever added, must
  scrub PII at the SDK layer and is a flagged decision.

---

## 3. Failure-mode analysis

| # | Failure | Blast radius | Recovery / mitigation |
| - | ------- | ------------ | --------------------- |
| F1 | **Cross-tenant leakage** (a rule missing the family predicate) | Catastrophic — children's data across households; PIPEDA breach, OPC + individual notification | Family predicate on **every** rule; mandatory emulator isolation tests (Task 5); security-critical review, no autonomous merge; pen-test cross-tenant cases before launch |
| F2 | **Role self-elevation / tenant reassignment** | A user becomes parent or jumps families | `immutable('role'/'familyId')` on subject updates; signup self-create bounded to be non-generalizable; explicit tamper tests |
| F3 | **Deactivated user still acts** | A removed member reads/writes | `isActive()` in every authenticated predicate, not just UI; test that `isActive:false` is denied |
| F4 | **Allowance double-credit / race** | Balance integrity (the durability-sensitive data) | Firestore transaction + `complete->approved` status guard makes approve idempotent; concurrent-approve and double-approve tests |
| F5 | **Offline write conflict** | Two members edit same field offline; LWW silently overwrites | Accepted at family scale; documented in ADR-0005; threat-modeler notes; consider per-field merge only if it becomes a real problem |
| F6 | **Invite abuse** (spam, account creation in another family) | New trust boundary (TB2) | Function re-verifies caller is active parent of the target family; rate limit; per-family member cap; child path sends no email |
| F7 | **Email subprocessor leak/outage** | Adult emails to a third party; invite emails fail | DPA + region scrutiny (human gate); adult-invite email path disabled until approved; child path unaffected (no email) |
| F8 | **Firebase regional outage** | App unavailable | Best-effort accepted (no HA requirement); offline cache keeps reads working; no multi-region (no requirement justifies it) |
| F9 | **Service worker serves stale shell** | Users stuck on old UI | Workbox skipWaiting/clientsClaim with a controlled update prompt; versioned precache |
| F10 | **Function/Blaze cost runaway** | Billing surprise | Budget alerts; rate limits; the only Function is the low-frequency invite path |

---

## 4. Stack recommendation & reversibility

The stack is **fixed by the user** (`preferences.md`) — not re-litigated. Stated
with reversibility and the one deviation-worthy note each:

| Layer | Choice | Reversibility | Note |
| --- | --- | --- | --- |
| Language | TypeScript | Hard | Fixed; matches preference. |
| UI framework | React 18 + Vite | Hard | Fixed. |
| Routing | React Router v6 | Medium | Fixed. |
| Styling | Tailwind, theme built from tokens | Easy | ADR-0007. |
| Datastore | Cloud Firestore | Hard | Fixed; tenant isolation in rules. |
| Auth | Firebase Auth (email/password) | Medium | Fixed. |
| Hosting | Firebase Hosting (assumed) | Medium | Confirm at gate. |
| Backend compute | Cloud Functions (invite only) | Medium | **Forces Blaze — gate.** ADR-0003. |
| Email | Transactional ESP (adult invites) | Easy | **New subprocessor — gate.** |
| PWA | vite-plugin-pwa / Workbox | Easy | Fixed. |
| Region | **UNDECIDED — human gate** | Hard (permanent at project creation) | Default to closest available Canadian region; document if not in Canada. |

Newly introduced (not in the original fixed list, hence flagged): **Cloud
Functions**, **Blaze plan**, **email subprocessor**. All three are human gates.

---

## 5. Capacity & cost sketch

- **Free (Spark) plan covers:** Firestore, Auth, Hosting at MVP family scale.
  Per-family data is tiny; the cost driver is document reads, and `get()` calls
  in rules add one read per evaluated op (low-RPS at family scale).
- **Blaze (pay-as-you-go) is forced by Cloud Functions** (ADR-0003). The invite
  Function is low-frequency (a parent adding a member), so Function + the small
  metered Firestore usage is expected to be a few dollars/month at MVP, scaling
  ~linearly with family count.
- **Top 3 cost drivers:** (1) Firestore reads (dominated by dashboard roll-ups
  and rules `get()`s), (2) Cloud Functions invocations (invite), (3) email
  subprocessor per-message (adult invites only).
- **Cliffs:** none structural at the stated scale. The first thing that "bends"
  at large scale is rules `get()` read cost on hot paths — addressable later by
  caching `familyId`/`role` in a custom auth claim (a future optimization, not
  needed now; noted so we don't prematurely build it).
- **No budget ceiling was stated** — confirm at the gate, since Blaze converts
  hosting from free to metered.

---

## 6. Ordered task breakdown

Owner agents: **impl** = implementer, **test** = test-writer, **design** =
designer, **a11y** = accessibility-specialist, **threat** = threat-modeler.
Risk: L/M/H. Estimate: S/M/L. **[GATE]** = blocked on a human approval.

**Phase 0 — scaffold & foundations**

1. **Scaffold the Vite + React + TS project.** Init app, ESLint/Prettier,
   strict TS, folder skeleton (§2.5). Deps: none. AC: `npm run dev` serves a
   blank shell; lint+typecheck pass in CI. Owner: impl. Risk L. Est S.
2. **Reconcile design tokens, build Tailwind theme from them (ADR-0007).**
   Update `design-tokens.json` to match the handoff palette/type/space/radius/
   shadow; build `tailwind.config.ts` from tokens. Surface the missing dark
   palette as an open item. Deps: 1. AC: every handoff token is a theme value;
   no off-palette literals; light contrast audited AA. Owner: design (+a11y).
   Risk M. Est M. **(token file is "locked" — human-review the reconciliation.)**
3. **Firebase config & SDK init (`src/firebase/config.ts`).** Init app, Auth,
   Firestore with `persistentLocalCache` + multi-tab (ADR-0005). Web config via
   `VITE_` env (public identifier, not a secret). Deps: 1. AC: app connects to
   the emulator suite; persistence enabled. Owner: impl. Risk L. Est S.

**Phase 1 — tenant & auth core (highest risk first, fail fast)**

4. **Auth + tenant bootstrap: signup founding parent (ADR-0006).** Atomic
   client batch creating `families` + parent `users` doc; login/forgot flows.
   Deps: 3. AC: signup creates exactly one family + one parent user atomically;
   a failed batch leaves no orphan; cannot bootstrap a second family for an
   existing user. Owner: impl. Risk **H**. Est M. **[GATE — role/tenant model]**
5. **`firestore.rules` + emulator test suite (ADR-0001/0002/0006).** All helper
   functions; tenant/role/active/immutability rules; the bounded signup
   self-create. Deps: 4. AC (test-writer turns each into a test): cross-tenant
   read/list/write **denied**; member cannot set own `role=parent`; user cannot
   change own `familyId`; `isActive:false` denied all ops; member can write only
   own chore + only `pending->complete`; parents scoped to own family; signup
   self-create cannot flip an existing member or create a 2nd family. Owner:
   impl + test. Risk **H**. Est L. **[GATE — firestore.rules]** Security-critical,
   no autonomous merge.

**Phase 2 — shell & primitives**

6. **Shared primitives (§2.5) from the handoff.** Avatar (+crown, +ring),
   AvatarChip, Card, Button (all variants/sizes), Badge, TextField, TopBar,
   BottomNav, FAB, Toast, BottomSheet, EmptyState, Skeleton. Deps: 2. AC:
   matches handoff dimensions; 44px tap targets; focus-visible; reduced-motion
   honored; light+dark (dark pending token gap). Owner: impl + design + a11y.
   Risk M. Est L.
7. **App shell, routing, providers, toast/auth/family context.** Router (incl.
   modal routes hiding the nav), `useAuth`/`useFamily`/`useToast`, dynamic
   family derivation from live `users` (active only). Deps: 3,6. AC: nav routes;
   member is bounced off parent-only routes (e.g. add-chore); every screen has a
   loading + empty state pattern available. Owner: impl. Risk M. Est M.

**Phase 3 — features (build order from handoff §"Implementation order")**

8. **Dashboard roll-up.** Greeting, Today, Board preview, Chores preview
   (role-aware). Deps: 7, and the feature data hooks it previews (can stub then
   wire). AC: parent vs member variants; empty/loading states; pull-to-refresh.
   Owner: impl. Risk M. Est M.
9. **Bulletin Board + Compose.** Feed, unread accent, compose bottom-sheet, tags.
   Deps: 7. AC: post create routes through toast; non-empty validation; family-
   scoped query; empty/loading. Owner: impl. Risk L. Est M.
10. **Chores — member view + Add Chore + member completion.** Earnings card,
    pending/waiting/approved sections; member `pending->complete`. Add Chore is
    parent-only. Deps: 7, 5. AC: member sees only own chores; "Mark done" toast;
    add-chore blocked for members. Owner: impl. Risk M. Est M.
11. **Chores — parent view + approval transaction (ADR-0004).** Approval queue,
    filters, approve/reject; the atomic balance+ledger transaction. Deps: 10, 5.
    AC (test-writer): approve increments balance once + writes one transaction;
    double-approve and concurrent-approve credit exactly once; reject sets
    reason, no balance change. Owner: impl + test. Risk **H**. Est M.
12. **Allowance history.** Read `transactions` for a member, family-scoped.
    Deps: 11. AC: shows ledger; empty/loading. Owner: impl. Risk L. Est S.
13. **Calendar + Add Event.** Month grid + agenda; category colors; add-event
    modal. Deps: 7. AC: events family-scoped; empty/loading; FAB add. Owner:
    impl. Risk M. Est L.
14. **Family Management (parent-only) + invite (ADR-0003).** Member list,
    rename family, deactivate, **invite via Cloud Function**. Deps: 5, and the
    Function (Task 15). AC: parent-only; deactivate flips `isActive`; child
    invite creates account with no email; adult invite path gated behind the
    email-subprocessor approval. Owner: impl. Risk **H**. Est L. **[GATE]**
15. **Invite Cloud Function (Admin SDK) (ADR-0003).** Parent-only callable:
    verify active parent of family, create member Auth user + `users` doc, manage
    `invites`, send adult email (provider gated). Deps: 5. AC (test): rejects
    non-parent and cross-family callers; creates child account with no email;
    rate-limited; logs scrub PII. Owner: impl + test. Risk **H**. Est L.
    **[GATE — Blaze plan + email subprocessor + invite flow]**

**Phase 4 — PWA, hardening, accessibility, tests**

16. **PWA: Workbox app shell, offline fallback, manifest (ADR-0005).** Deps: 7.
    AC: installable; offline navigation serves fallback; manifest theme
    `#3730A3`; cache cleared on sign-out; controlled SW update. Owner: impl.
    Risk M. Est M.
17. **Accessibility pass (AODA/WCAG 2.1 AA).** Full audit: contrast (light+dark),
    focus order, labels, reduced-motion, 44px targets, accessibility statement +
    feedback mechanism. Deps: 6-16. AC: a11y sign-off. Owner: a11y. Risk M. Est M.
18. **Security & isolation regression suite + CI gates.** Cross-tenant, role,
    active, allowance, invite tests in CI; dependency audit + static analysis;
    security headers (CSP/HSTS/X-Frame-Options) on hosting. Deps: 5,11,15. AC:
    `scripts/verify.sh` gates pass; high-severity CVEs block merge. Owner: test +
    impl. Risk M. Est M.
19. **Privacy/incident scaffolding.** Wire ToS/Privacy acceptance at signup
    (content from the policy gate); breach-record store stub; data-export +
    deletion (guardian-mediated) paths. Deps: 4. AC: signup records acceptance;
    deletion is real + tenant-scoped. Owner: impl. Risk M. Est M.
    **[GATE — privacy policy/ToS content + retention schedule]**

**Ordering rationale:** scaffolding first; tenant+auth+rules (highest risk)
before any feature so isolation is proven before data exists; primitives/shell
unblock all features; chores-approval and invite (the two H-risk feature paths)
get dedicated test coverage; PWA/a11y/security harden last over a complete app.

---

## 7. Human-gate items (call these out at the gate)

1. **The plan itself** (this doc) — approve before any code.
2. **Firebase region** — permanent at project creation; default to closest
   Canadian region; document if not in Canada. (Constraints: cross-border.)
3. **Cloud Functions + Blaze plan** — forced by the invite mechanism (ADR-0003);
   converts hosting from free to metered.
4. **Email subprocessor** — adult-invite emails; DPA + vendor assessment + region
   scrutiny. Adult-invite email path stays disabled until approved.
5. **Privacy policy + Terms of Service** content (referenced at signup).
6. **Data retention schedule** per data type.
7. **firestore.rules / role model / tenant model / invite flow** — every change
   (ADR-0001/0002/0003/0006). Security-critical, no autonomous merge.
8. **Design-token reconciliation** (ADR-0007) — tokens are "locked"; the
   placeholder-vs-handoff mismatch must be resolved by human-reviewed change, and
   the missing dark-mode palette must be supplied by the designer.

---

## 8. Open questions (need answers, may change the design)

- **Q1 Region** — which Firebase region? (Gate item 2.)
- **Q2 Blaze/email** — approve the invite Function + Blaze + an email provider?
  If "no" now, we can ship child-member creation (no email) and defer adult
  email invites. (ADR-0003.)
- **Q3 Child Auth identity** — children may not have email. Confirm the intended
  child credential model: parent-set email-less custom credential vs a synthetic
  per-child email. Affects `users.email` shape and the Function. (Data
  minimization: prefer no real email for children.)
- **Q4 Dark mode** — the handoff has no dark palette but `users.theme` and
  preferences require dark mode. Designer to supply, or descope dark mode for v1?
- **Q5 Hosting** — confirm Firebase Hosting (assumed) and that security headers
  belong there.
- **Q6 NFRs** — confirm the assumed scale/lifecycle (§1); the Blaze decision
  hinges on this being a long-lived commercial product.

---

## 9. Handoffs (after approval)

- **-> threat-modeler (mandatory next):** trust boundaries TB1-TB4 (§2.3); the
  cross-tenant, role-tamper, deactivated-user, allowance-race, invite-abuse, and
  offline-conflict failure modes (§3 F1-F7); the bounded signup self-create
  predicate (ADR-0006) needs a proof it is non-generalizable; the Function
  (TB2) and email subprocessor (TB3) as new trust boundaries.
- **-> designer:** audience = families incl. children, mobile-first PWA, primary
  task = shared family scheduling/chores; build the Tailwind theme from
  reconciled tokens (ADR-0007); **supply the missing dark-mode palette** (Q4);
  density is comfortable; empty + loading + error states for every section.
- **-> observability-setup:** the logs/metrics/traces in §2.8; the hard rule that
  no child name/content/email ever enters logs; rules-deny-rate as an
  isolation-probe signal; explicitly NO analytics/replay/ads SDKs.
