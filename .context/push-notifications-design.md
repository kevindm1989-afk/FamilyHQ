# Push notifications — architect's brief (Blaze-tier, first chargeable feature)

**Date:** 2026-06-09 · **Author:** architect · **Status:** design (awaiting threat-modeler then human gates)
**Companion decisions:** ADR-0013 (primary), ADR-0014 (trigger model sub-decision) in `.context/decisions.md`.

This brief exists because push is the project's first Blaze-tier feature and the
first to introduce server-executed code (Cloud Functions). The architectural
surface change is larger than the user-visible feature.

---

## 1. One-page summary

- **Stack:** Firebase Cloud Messaging (FCM) Web Push via the Firebase JS SDK +
  `firebase-admin` running in a Cloud Functions (2nd gen) Node 20 runtime in
  `northamerica-northeast1` (Montreal — Canadian residency).
- **Trigger model:** **HTTPS-callable functions invoked from the same client
  flow that performs the action** (chore approve, wishlist request, etc.).
  Rejected the Firestore-triggered model. See ADR-0014.
- **Device tokens:** `userPrivate/{uid}/fcmTokens/{tokenHash}` subcollection
  (one doc per device; `tokenHash` is a hex digest so the doc id is not a
  secret). Reuses the `userPrivate` rule shape (ADR-0008). NOT on the
  family-readable `users` doc.
- **v1 events shipped:** 7 callable-triggered, real-time events —
  (1) parent: chore awaiting approval; (2) parent: wishlist redemption
  awaiting approval; (3) kid: chore approved; (4) kid: wishlist redemption
  approved OR denied (single category, kid mutes both together);
  (5) family: new board post (everyone except the author);
  (6) family: new to-do created (everyone except the creator);
  (7) family: to-do completed (everyone — closes the loop for the requester).
  **Deferred to PR F (fast-follow):** event reminders (today/tomorrow) and
  birthday-in-N-days. Both need a scheduled-function trigger model + Cloud
  Scheduler, which is a different deployment shape — separate ADR/PR.
  **Dropped entirely:** shopping-list adds (~20 per grocery trip would
  train users to mute the app; the list is a glanceable surface anyway).
- **Notification body:** vague-by-default — `"A request is waiting in Family
  HQ"`, `"Family HQ has an update for you"`. Title carries category only
  (`"Approval needed"`, `"Allowance update"`). **No** child name, chore title,
  wishlist title, money amount, or post content on the lock screen ever, by
  default. Per-device opt-in to "show details" is a v1.1 follow-up (the
  preference shape is shipped in v1 so the server doesn't change later).
- **Permission UX:** never on page load. Prompt only after a contextual moment
  (the user just performed an action whose follow-up they'd benefit from
  hearing about) via an in-app toast with "Not now" and "Remind me later"
  options. Document the trigger; don't engineer around iOS-without-PWA.
- **Budget kill-switch is mandatory in PR A.** A `billingKillSwitch` function
  triggered by Pub/Sub topic `billing-budget-alerts` calls
  `cloudbilling.projects.updateBillingInfo({billingAccountName: ''})` to
  detach billing when the $5 cap is crossed. **No other chargeable function
  may deploy in or before PR A without this function landing in the same PR.**

---

## 2. Non-functional requirements (stated + inferred)

| NFR | Value | Source |
| --- | ----- | ------ |
| Users / family | ~6 (max realistic) | product shape |
| Notifications / family / day, v1 | ~20 across all users | brief |
| MVP scale (families × notifications/day) | 100 × 20 = 2,000 deliveries/day | inferred MVP |
| 10x scale | 1,000 families × 20 = 20,000/day | inferred |
| Latency budget, approve→push delivery | < 3s p95 (acceptable — not interactive) | architect |
| Availability | best-effort; push is non-essential. Core app must work without it. | architect |
| Durability of tokens | losing all tokens = re-prompt on next visit, acceptable | architect |
| Compliance | PIPEDA + (pre-launch) Quebec Law 25 | constraints.md |
| Residency | Canadian for Cloud Functions + Firestore; FCM is global (Google) | constraints + ADR-0013 |
| Monthly cost ceiling | **$5/mo hard cap via budget kill-switch** | brief |
| Lifecycle | long-lived production | constraints |

---

## 3. Components & responsibilities

1. **PWA push-permission UX** (`src/features/notifications/`).
   Owns: the contextual prompt, the per-user `notificationPreferences` editor,
   the FCM token registration on permission-grant, and unregistration on
   permission-revoke or sign-out. Reads VAPID public key from
   `VITE_FCM_VAPID_PUBLIC_KEY`. Calls `getToken()` from the FCM JS SDK and
   writes the resulting token to its `userPrivate/{uid}/fcmTokens/{tokenHash}`
   doc.
2. **FCM service worker** (`public/firebase-messaging-sw.js`).
   Owns: background message receipt. Routes the vague notification to the OS
   shelf. Click handler focuses or opens the app on the in-app inbox route
   (where the actual details, gated by Firestore rules, are rendered).
3. **HTTPS-callable Cloud Functions** (`functions/src/`).
   - `notifyChoreSubmitted` — invoked from `markChoreComplete` in the same
     client function, AFTER the Firestore write commits.
   - `notifyChoreApproved` — invoked from `approveChore` AFTER the
     `runTransaction` resolves.
   - `notifyWishlistRequested` — invoked from `requestWishlistRedemption`
     after the Firestore write commits.
   - `notifyWishlistResolved` — invoked from `approveWishlistRedemption`
     and `denyWishlistRedemption` AFTER the transaction resolves.
   Each function re-verifies caller identity, re-derives `familyId` from the
   caller's `users` doc, fetches recipient candidates (parents of the family
   for `*Submitted`/`*Requested`; the assignee for `*Approved`/`*Resolved`),
   reads each recipient's `notificationPreferences` and `fcmTokens`, sends
   vague-body messages via `admin.messaging().sendEachForMulticast()`, and
   handles 404/410 token cleanup.
4. **Budget kill-switch Function** (`functions/src/billingKillSwitch.ts`).
   Pub/Sub-triggered on `billing-budget-alerts`. Body parses the payload,
   compares `costAmount` vs `budgetAmount`, and on threshold breach calls
   `cloudbilling.projects.updateBillingInfo({billingAccountName: ''})` to
   detach billing. Idempotent (no-op if billing already detached). Logs the
   action.
5. **Firestore** — adds `userPrivate/{uid}/fcmTokens/{tokenHash}` subcollection
   and a top-level `notificationPreferences` field on `userPrivate/{uid}`
   (NOT on `users`). Rules: token docs readable only by the subject, writable
   only by the subject, listable only by the subject. Preferences readable by
   the subject + Cloud Functions Admin SDK (bypasses rules).
6. **GitHub Actions deploy** — a new, FLAG-GATED, separate-step
   `deploy-functions` job. Per the PR #84 lesson, **never** bundled into the
   same `--only` flag as `firestore:rules` / `firestore:indexes` /
   `storage:rules`. A failed Functions deploy must not take down rules
   deploys, and vice versa.

---

## 4. Data model additions

```
userPrivate/{uid}                 (existing, ADR-0008)
  email: string                   (existing)
  familyId: string                (existing, immutable)
  notificationPreferences: {      (NEW — v1)
    pushEnabled: boolean,         (master switch)
    categories: {
      choreApprovalsNeeded: boolean,    (parent only)
      wishlistApprovalsNeeded: boolean, (parent only)
      myChoreResolved: boolean,         (kid only)
      myWishlistResolved: boolean,      (kid only)
      familyBoardPosts: boolean,        (all members; recipient excludes author)
      familyTodos: boolean,             (all members; covers create + complete)
    },
    showDetails: false,           (v1: always false; v1.1: per-device opt-in)
    updatedAt: Timestamp,
  }

userPrivate/{uid}/fcmTokens/{tokenHash}   (NEW subcollection)
  token: string                   (the FCM registration token)
  userAgent: string               (display only — "Chrome on macOS")
  createdAt: Timestamp
  lastSeenAt: Timestamp           (refreshed on token-refresh callback)
```

`tokenHash` = first 24 hex chars of SHA-256(token). Document id is not the
token itself (token is a credential). Lookup by id when refreshing; the body
holds the full token for the Admin SDK to send.

**No new fields on the family-readable `users` doc.** Notification machinery
is invisible to other family members.

---

## 5. Data flow & trust boundaries (additions for threat-modeler)

| ID | Flow | Source → Sink | Transport | Payload | Boundary |
| -- | ---- | ------------- | --------- | ------- | -------- |
| DF12 | Token register | PWA → Firestore | TLS 1.2+, gated by rules | FCM token (credential), userAgent | **TB1** (token at rest is sensitive — never readable by another family member) |
| DF13 | Notify-callable | PWA → Function | TLS 1.2+, HTTPS callable, auth token | minimal: `{kind, targetDocId}`; NEVER notification body content | **TB2** (extends the invite-function pattern) |
| DF14 | FCM send | Function (Admin SDK) → FCM | internal Google API over TLS | vague body + click-target URL, recipient tokens | **TB5 (NEW)** — Function ↔ FCM (Google subprocessor, already-named) |
| DF15 | Push delivery | FCM → device push service (Apple/Google/Mozilla) → device | TLS 1.2+, transport-encrypted | vague body, click-target URL | **TB6 (NEW)** — FCM ↔ device push services (Apple APNs, Google FCM Android, Mozilla autopush). Cross-border for APNs/Mozilla. |
| DF16 | Budget alert | Cloud Billing → Pub/Sub → kill-switch Function | internal | budget metadata (no PI) | internal — no PI surface |
| DF17 | Billing detach | Function → Cloud Billing API | internal | project ID + empty billingAccountName | internal — no PI surface |

**New trust boundaries TB5 (Function↔FCM) and TB6 (FCM↔OS push services)** are
the threat-modeler's primary new surface. TB6 carries the lock-screen body
into Apple's / Mozilla's / Google's push transport — this is exactly why the
body is vague-by-default.

---

## 6. Stack recommendation (with reversibility)

| Layer | Pick | Alternatives rejected | Reversibility |
| ----- | ---- | --------------------- | ------------- |
| Push provider | Firebase Cloud Messaging Web Push | OneSignal (extra subprocessor, no benefit), self-host VAPID + Mozilla autopush (more code, no Admin SDK helper) | **Hard** — switching means re-prompting every device |
| Functions runtime | Cloud Functions 2nd gen, Node 20 | 1st gen (deprecating), Node 22 (less mature on 2nd gen at our cutoff), Cloud Run (more knobs, more cost, no win for this scale) | **Medium** |
| Region | `northamerica-northeast1` (Montreal) | `us-central1` (default — cross-border PI), `northamerica-northeast2` (Toronto, fewer 2nd-gen services) | **Hard** — region migration = re-deploy + token churn |
| Trigger | HTTPS callable from same client transaction | Firestore-trigger function (see ADR-0014) | **Medium** — can swap to triggers later if push-without-client-running becomes important |
| Token storage | `userPrivate/{uid}/fcmTokens/{tokenHash}` subcollection | array on `userPrivate/{uid}` (1 MB doc cap, contention), top-level `fcmTokens` (cross-tenant rule surface) | **Medium** — single per-user migration |
| VAPID key (public) | `VITE_FCM_VAPID_PUBLIC_KEY` env var | hardcoded (rotation is harder), fetched at runtime (extra round-trip) | **Easy** |
| Kill-switch IAM | Service account with `roles/billing.projectManager` on billing account | broader `roles/owner` (over-privileged) | **Easy** |
| Min-instances | 0 (cold start acceptable for our latency budget) | 1 (~$5/mo by itself, busts the cap) | **Easy** |

---

## 7. Capacity & cost sketch

**v1 family-scale baseline (6-person family, ~40 notifications/day after
adding board posts + to-do create/complete fanout — ~5 board posts/day × 5
recipients + ~3 to-dos/day × 5 recipients × 2 events ≈ +25 over the
chore+wishlist baseline):**

| Metric | v1 (1 family) | MVP (100 families) | 10x (1,000 families) |
| ------ | ------------- | ------------------ | ------------------- |
| Function invocations / month | ~1,200 | ~120,000 | ~1,200,000 |
| GB-seconds (256MB × ~500ms) | ~150 | ~15,000 | ~150,000 |
| FCM API sends / month | ~1,200 | ~120,000 | ~1,200,000 |
| Outbound bytes (≈1KB / send) | ~1.2 MB | ~120 MB | ~1.2 GB |

**Free-tier headroom (Cloud Functions 2nd gen / GCP free tier):**
- Invocations: 2,000,000/mo free → **MVP uses 6%, 10x uses 60%**.
- GB-seconds: 400,000/mo free → **MVP uses 3.8%, 10x uses 38%**.
- FCM: free (no Google charge for FCM itself).
- Egress to internet: 1 GB/mo free → MVP fine; 10x **breaches** by ~200 MB
  (~$0.03 in egress before the cap kicks in — well below $5 but worth
  knowing). Beyond 10x, expect a small recurring egress line item.

**Expected monthly cost at MVP scale:** $0 in the Firebase line item (all
inside free tier). The $5 cap exists for runaway-bug protection (a logic loop
in a function, App Check misfire, etc.), not for forecasted operational cost.

**Cliffs:**
- ~50 MB/mo egress, multi-region functions, or warm min-instances ≥ 1: each
  individually fits inside the $5 cap; combining two might breach.
- Adding a daily digest function (current "All: an upcoming event tomorrow")
  at 1000 families × 1 = 1,000 sends/day = 30,000/mo additional. Still inside
  free, but the trigger model changes (Cloud Scheduler), and the body of a
  digest IS likely to be PI-vague-resistant — separate ADR if shipped.
- ~10,000 families: free tier still holds, but the budget kill-switch should
  be re-tuned upward only with intent; default keep at $5.

---

## 8. Failure mode analysis

| F# | Mode | Behavior | Recovery |
| -- | ---- | -------- | -------- |
| F-PN-1 | Token rotation (browser revokes / kid clears storage) | FCM SDK fires `onTokenRefresh` (or `getToken()` returns a new value); the next app open re-registers; the old token will yield FCM 404/410 on next send | Client always upserts (replace by `tokenHash`); server cleans 404/410 (F-PN-3) |
| F-PN-2 | User revoked notification permission in the browser | `getToken()` returns null; client deletes its `fcmTokens/{tokenHash}` doc; user sees "Notifications off" in preferences; no notification attempted | None needed; user re-grants via the UX path |
| F-PN-3 | FCM returns a permanently-stale-token error code | Function inspects each per-recipient response's `error.code`; deletes the corresponding `fcmTokens/{tokenHash}` doc **ONLY** when the code is in the explicit allow-list `['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']` (threat-modeler pushback #4 / M37). Transient codes (`messaging/server-unavailable`, `messaging/internal-error`, `messaging/quota-exceeded`, etc.) NEVER trigger deletion — they get retried or dropped, not removed | Pinned in implementer tests (T-C.x); idempotent (deleting a missing doc is no-op). A test asserts that a `server-unavailable` response leaves the token doc untouched. |
| F-PN-4 | Cloud Function cold start | First call after idle takes ~2-4s; user already saw the in-app success toast before the notification fires — non-blocking | Accepted; min-instances stays at 0 to keep cost at $0 |
| F-PN-5 | Budget kill-switch fires → billing detached → all chargeable Functions return errors | App's notify-callable calls throw; client catches and **swallows silently** (no toast, no retry storm). Core app keeps working (Firestore reads/writes still free) | User flow continues; an admin (us) sees the billing alert and investigates |
| F-PN-6 | Cloudflare or Google outage | Push doesn't deliver; the in-app inbox + Firestore-driven UI still reflects the state because the Firestore write already landed before the push attempt | Accepted (push is non-essential) |
| F-PN-7 | iOS user without PWA installed | `getToken()` may succeed but iOS will not deliver in background; from our side it is a silent no-op | **Acknowledged UX gap.** Show a one-time "For iOS: install the app from Share → Add to Home Screen for notifications" hint when we detect iOS + permission granted + no PWA install detected. Do not toast on every visit. |
| F-PN-8 | A second-tap on the click-target opens duplicate tabs | Service worker click handler `focuses` an existing client if present, else opens new | Standard SW pattern; pinned in implementer tests |
| F-PN-9 | Cross-tenant token leak (a parent's token sent to another family's notify) | Function re-derives `familyId` from caller's `users` doc and asserts the recipient's `familyId == callerFamily` before reading their tokens. Test: parent of family A invokes notify with a target doc id from family B → rejected | Same shape as invite-function isolation (M11/M12) |
| F-PN-10 | Notification body accidentally carries PI | All body strings are constants in one file (`functions/src/notificationBodies.ts`); a code-review checklist + a unit test asserts each body string has no template substitution | Pinned in implementer test |

---

## 9. Observability hooks (for observability-setup)

- **Logs (Cloud Logging, structured):** every notify-callable logs
  `{kind, familyId, actorUid, recipientCount, successCount, cleanedTokenCount,
  durationMs}`. **No** recipient UIDs in raw form (hashed if needed),
  **no** notification body, **no** child names, **no** wishlist titles.
- **Metrics:** invocation rate per kind; FCM send success/failure ratio per
  kind; token cleanup count per day; budget-alert event count.
- **Trace:** none required for v1 (single-hop function).
- **Alerts:** Cloud Billing budget alert (already wired to Pub/Sub). Additional
  alert on `billingKillSwitch` invocation = page the operator immediately.
- **Dashboard:** one-screen "push health" — invocations, success ratio, token
  cleanup, kill-switch invocations.

---

## 10. Human-gate items (LOUD)

1. **Approve the Cloud Functions region** = `northamerica-northeast1` (Montreal).
   Permanent per-function once deployed.
2. **Approve FCM as a Google-managed processor for push payloads** (existing
   Firebase subprocessor; vague-body design keeps PI off the wire). The
   threat-modeler will pin disclosure language.
3. **Approve Apple APNs / Mozilla autopush as transport-layer processors** for
   iOS / Firefox push delivery. These are inherent to web push; vague-body
   design is the safeguard.
4. **Approve the v1 notification body strings** (the constants file) — these
   are what land on lock screens.
5. **Approve the deferral of the digest events** (board posts, shopping list,
   events-tomorrow, birthday-in-N-days) to a later ADR.
6. **Confirm that ADR-0010 ("Stay on Firebase Spark; tier-gated features ship
   dormant") is superseded by ADR-0013.** A memory PR must add the
   `Superseded by ADR-0013` header to ADR-0010 — currently ADR-0010 is not
   present in `.context/decisions.md` (file stops at ADR-0009 + addendum).
   The user must either point the curator at where ADR-0010 lives or accept
   that the "supersedes" link is dangling until ADR-0010 is added.
7. **Approve the $5/mo budget cap value and the kill-switch behavior**
   (billing detach is a sharp tool — confirm "I'd rather all push break than
   pay $6").

---

## 11. Explicit handoffs

- **NEXT: threat-modeler.** Inputs: §5 (new flows DF12-DF17, new boundaries
  TB5/TB6), §8 failure modes F-PN-1 through F-PN-10, vague-body design,
  token storage shape, kill-switch IAM, cross-border CB3 (FCM) and CB4
  (Apple/Mozilla push transport). Required outputs: STRIDE per TB5/TB6,
  PI-on-lock-screen rule pinned, cross-tenant token-leak tests, kill-switch
  abuse model, App Check on the notify-callable.
- **AFTER threat-modeler: implementer**, working PR-by-PR per §12.
- **observability-setup:** §9.
- **designer:** the notification permission UX (contextual prompt copy + the
  preferences screen + the iOS-without-PWA hint).

---

## 12. Ordered task breakdown

Each task lists: deps · acceptance criteria · owner · risk · estimate.

### PR A — Functions scaffold + budget kill-switch (NO chargeable function in same PR may run before kill-switch deploys)

**A1. Add `functions/` workspace (Node 20, TS, ESM).**
- Deps: none.
- Acceptance: `functions/package.json` with `firebase-functions@^5`,
  `firebase-admin@^12`, `@google-cloud/billing`; `functions/tsconfig.json`;
  `firebase.json` `functions` block pointing at `functions/lib`; `npm run
  build` in `functions/` produces JS; root `npm run lint` covers the
  workspace; `functions/.eslintrc.cjs` mirrors root rules.
- Owner: implementer · Risk: low · Estimate: S.

**A2. Implement `billingKillSwitch` Pub/Sub function.**
- Deps: A1.
- Acceptance: function exported, region `northamerica-northeast1`, runtime
  Node 20, trigger Pub/Sub topic `billing-budget-alerts`. Body parses the
  Pub/Sub message, asserts `costAmount > budgetAmount`, calls
  `cloudbilling.projects.updateBillingInfo({name:'projects/familyhq-68638',
  requestBody:{billingAccountName:''}})`, logs the action. Unit test: given
  a mock alert with `costAmount > budgetAmount`, the billing API mock is
  called with empty `billingAccountName`. Unit test: with `costAmount <
  budgetAmount`, the billing API is NOT called (no-op).
- Owner: implementer · Risk: **HIGH** (mistake silently disables billing or
  silently doesn't) · Estimate: M.

**A3. Provision IAM for kill-switch service account.**
- Deps: A2.
- Acceptance: a documented runbook (in `docs/runbooks/billing-killswitch.md`)
  listing:
  - The kill-switch SA email (a DEDICATED SA — NOT the default 2nd-gen
    functions runtime SA; the runtime SA must NOT carry billing rights
    — threat-modeler pushback #6 / M33b).
  - The role `roles/billing.projectManager` granted on the BILLING
    ACCOUNT (NOT the project); the gcloud commands to grant; verification
    step (`gcloud beta billing accounts get-iam-policy` shows the
    binding).
  - **NEGATIVE IAM-binding assertions (T-KS.5, T-KS.6) the runbook MUST
    walk through:**
    - the kill-switch SA must NOT have `roles/owner`,
      `roles/editor`, `roles/billing.admin`, or any
      `roles/datastore.*` / `roles/firestore.*` binding.
    - the default Cloud Functions runtime SA must NOT have ANY
      `roles/billing.*` binding.
    - the runbook lists the exact `gcloud` commands to verify each
      negative binding.
  This is a **manual operator step** before A4 — explicitly NOT a CI
  job.
- Owner: implementer writes runbook · user executes · Risk: medium ·
  Estimate: S.

**A4. Split `deploy.yml` — add separate `deploy-functions` step, FLAG-GATED.**
- Deps: A2, A3.
- Acceptance: a new `deploy-functions` job runs IFF
  `inputs.deploy_functions == true` (default false). It runs AFTER the
  existing rules+hosting job (so a rules deploy doesn't depend on a
  functions deploy). Its `firebase deploy --only` list is EXACTLY
  `functions:billingKillSwitch` in this PR — nothing else. PR description
  walks the operator through enabling the flag for this one deploy.
  Per-lesson-from-PR-#84: the existing `--only firestore:rules,
  firestore:indexes,storage:rules` flag is **unchanged**.
- Owner: implementer · Risk: medium · Estimate: M.

**A5. Deploy and verify kill-switch in staging.**
- Deps: A4.
- Acceptance: the user runs `deploy-functions` against staging,
  then manually publishes a fake message to `billing-budget-alerts` with
  `costAmount > budgetAmount`, observes the function execution log AND
  observes that the staging project's billing was detached. Re-attach
  billing manually. Document the test in the runbook.
- Owner: user (operator) · Risk: high · Estimate: S.

### Memory housekeeping (BEFORE or DURING PR A)

**M-OLD. Open memory PR superseding ADR-0010.**
- Deps: clarification from user on where ADR-0010 lives (not present in
  current `.context/decisions.md`).
- Acceptance: a memory PR adds `**Superseded by:** ADR-0013` header to
  ADR-0010 in `.context/decisions.md` (drafting the original ADR-0010 entry
  in the same PR if it never landed). Per CLAUDE.md, this is a separate
  memory PR, not bundled into a feature PR.
- Owner: memory-curator (orchestrator opens PR) · user merges ·
  Risk: low · Estimate: S.

### PR B — Token storage + preferences (no FCM send yet)

**B1. Extend `userPrivate/{uid}` with `notificationPreferences` field.**
- Deps: A series merged.
- Acceptance: type added to `lib/types`; default value on userPrivate create
  (founding-parent bootstrap AND invite-mint paths) writes the master-off
  shape; existing-user backfill is NOT needed (default-off on first read).
- Owner: implementer · Risk: low · Estimate: S.

**B2. Add `userPrivate/{uid}/fcmTokens/{tokenHash}` subcollection +
firestore rules.**
- Deps: B1.
- Acceptance: rule additions: `get/list/create/update/delete` on
  `userPrivate/{uid}/fcmTokens/{tokenHash}` allowed ONLY for
  `request.auth.uid == uid` AND `isActive()` **AND
  `request.app_check_token != null` (App Check enforced on the write
  path so a stolen session token alone cannot register attacker-
  controlled tokens — threat-modeler pushback #1 / T-C.7)**. Cross-user
  read: denied. Cross-family read: denied. Emulator tests:
  - own user reads own token: allowed
  - same-family parent reads child's token: denied
  - other-family user reads token: denied
  - unauthenticated: denied
  - **own user, no App Check token: denied (write paths)**
  - subject lists own tokens: allowed
  - subject lists tokens with no `where` constraint: allowed (own subcollection)
- Owner: test-writer + implementer · Risk: medium (rules) · Estimate: M.
- **Security-critical: no autonomous merge.**

**B3. Client: `notificationsService.ts` register / unregister / refresh
token.**
- Deps: B1, B2.
- Acceptance: `registerToken({ messaging, db, uid, userAgent })`: calls
  `getToken(messaging, { vapidKey })`, hashes to `tokenHash`, upserts the
  `fcmTokens/{tokenHash}` doc with `{token, userAgent, createdAt,
  lastSeenAt}`. `unregisterToken({ messaging, db, uid })`: calls
  `deleteToken(messaging)` and deletes all of the user's `fcmTokens` docs
  on this device (matched by stored token equality). Idempotent. Unit
  tests: register with mock messaging + db; unregister; permission-denied
  path returns null and writes nothing.
- Owner: implementer · Risk: medium · Estimate: M.

**B4. Service worker file `public/firebase-messaging-sw.js`.**
- Deps: B3.
- Acceptance: registers a `messaging.onBackgroundMessage` handler that
  shows a vague notification (title + body from the payload's `notification`
  field). Click handler focuses an existing app client if one exists, else
  opens the app at the path the payload's `data.url` specifies (default
  `/`). Hardcoded — no PI ever ends up in the SW (the payload is what FCM
  delivered; SW just relays it to the OS).
- Owner: implementer · Risk: low · Estimate: S.

**B5. Notification preferences UI + device list (data-minimization
purpose-of-collection for `userAgent` — threat-modeler pushback #2).**
- Deps: B1, B3.
- Acceptance: settings screen lets a user toggle master push + per-category
  toggles. Master-off triggers `unregisterToken`. Master-on triggers the
  permission prompt + `registerToken`. **The same screen surfaces a
  "Devices" sublist showing each `fcmTokens/{tokenHash}` doc's
  `userAgent` + `lastSeenAt` with a "Sign out this device" button
  (deletes that single fcmToken doc).** This is the purpose-of-collection
  justification for storing `userAgent` — without a user-visible
  affordance the field has no PIPEDA-permissible purpose and would be
  dropped. AODA: keyboard operable, 44px taps, visible focus,
  screen-reader labels per `lessons.md` ARIA-role rule. (If user
  feedback rejects the device-list UX, drop `userAgent` from the token
  doc shape — `B-T14` test forbids storing it without the surface.)
- Owner: designer + implementer · Risk: low · Estimate: M.

**B6. Permission-prompt UX (contextual, NOT on page load).**
- Deps: B5.
- Acceptance: a one-time "Get a heads-up when there's another to approve"
  toast appears after a user's first successful chore-approve action,
  offering "Turn on" → prompts native permission → on grant, registers
  token + flips master + relevant category. "Not now" dismisses for the
  session; "Remind me later" sets a `remindAt = now+7d` field on
  userPrivate. iOS-without-PWA detection shows a different hint copy and
  does NOT prompt.
- Owner: designer + implementer · Risk: medium · Estimate: M.

### PR C — First chargeable function: chore approval push

**C1. Implement `notifyChoreApproved` callable.**
- Deps: A series deployed to prod, B series deployed to prod.
- Acceptance: region `northamerica-northeast1`, runtime Node 20,
  **`onCall({ enforceAppCheck: true }, ...)` — the literal flag MUST
  appear in the callable declaration (threat-modeler pushback #3 /
  M32 — `cors` + auth alone do not satisfy App Check; a CI assertion
  greps the source for `enforceAppCheck: true` on every notify-callable).**
  Input: `{ choreId }`. Server steps:
  1. assert `context.auth`; reject UNAUTHENTICATED otherwise.
  2. read caller's `users/{uid}` (Admin SDK); reject if missing /
     `isActive == false`.
  3. read `chores/{choreId}`; reject if missing OR
     `chore.familyId != caller.familyId` OR `chore.status != 'approved'`.
  4. read recipient (chore.assignedTo) `userPrivate/{assignedTo}`; reject
     if `assignedTo`'s familyId != caller.familyId (cross-tenant defense in
     depth).
  5. if recipient's `notificationPreferences.myChoreResolved == false`,
     return `{ sent: 0, cleaned: 0 }` and STOP. (Skip classification
     `skipReason: 'opted_out'` lands in the server log per M38 —
     callable response itself is opaque per the M39 revision in PR D;
     see decisions.md "2026-06-11 — Drop `reason` from notify-callable
     response shape".)
  6. read recipient's `fcmTokens` subcollection; if empty, return
     `{ sent: 0, cleaned: 0 }` (server log carries `skipReason: 'no_tokens'`).
  7. send via `sendEachForMulticast` with constants:
     `title: NOTIF_TITLES.allowanceUpdate` and
     `body: NOTIF_BODIES.choreApproved`.
  8. for each failed-with-404/410 response, delete the corresponding
     `fcmTokens/{tokenHash}` doc.
  9. log `{kind:'choreApproved', familyId, actorUid, recipientCount,
     successCount, cleanedTokenCount, durationMs}`.
  10. return `{ sent, cleaned }`.
- Owner: implementer · Risk: HIGH (first chargeable function + cross-tenant
  enforcement) · Estimate: L. **Security-critical: no autonomous merge.**

**C2. Wire `approveChore` client to call `notifyChoreApproved` AFTER tx
resolve.**
- Deps: C1.
- Acceptance: `approveChore` in `choresParentService.ts` continues to
  resolve the `runTransaction` first (existing behavior unchanged); only
  on success, fires the callable. The callable's failure does NOT throw
  to the user (we swallow + log via structured client log). Unit test:
  successful tx + failed callable → user sees CHORE_APPROVE_SUCCESS toast,
  no rejection.
- Owner: implementer · Risk: medium · Estimate: M.

**C3. Notification-body constants file + audit test.**
- Deps: C1.
- Acceptance: `functions/src/notificationBodies.ts` exports
  `NOTIF_TITLES` and `NOTIF_BODIES` as `Readonly<Record<string,string>>`
  with frozen vague strings. Unit test iterates every value and asserts:
  no `${` template, no occurrence of any of `[child, kid, parent, name,
  chore, wishlist, $, dollar, amount, balance]` (case-insensitive
  substring), length < 80. This test runs in CI before any deploy.
- Owner: implementer · Risk: low (high leverage) · Estimate: S.

**C4. Extend `deploy-functions` flag-gated step to include
`notifyChoreApproved`.**
- Deps: C1, A4.
- Acceptance: the `--only` list grows to
  `functions:billingKillSwitch,functions:notifyChoreApproved`. Order in
  the deploy command matters — kill-switch first. CI assertion: the
  string `billingKillSwitch` precedes `notifyChoreApproved` in the
  `--only` argument.
- Owner: implementer · Risk: medium · Estimate: S.

### PR D — Remaining v1 events

**D1. `notifyChoreSubmitted` (kid → parents).**
- Deps: C series in prod.
- Acceptance: same shape as C1 except recipients = all parents of the
  family (excluding the actor), trigger from `markChoreComplete`,
  preference key `choreApprovalsNeeded`. Same test contract.
- Owner: implementer · Risk: medium · Estimate: M.

**D2. Wishlist redemption flow service skeletons (if not present).**
- Deps: none (independent precondition).
- Acceptance: `wishlistService.ts` with `requestWishlistRedemption` /
  `approveWishlistRedemption` / `denyWishlistRedemption` signatures; the
  approve/deny use `runTransaction` mirroring `approveChore`. Rules updates
  for the `wishlistItems` collection (out of scope for the push design
  beyond noting that approval is transactional). Open to defer to its own
  feature PR; the push callables CANNOT ship without the underlying
  feature.
- Owner: architect note + implementer · Risk: medium · Estimate: L.
- **GATE: D2 may be deferred. If wishlist redemption is not yet built,
  D3-D4 wait.**

**D3. `notifyWishlistRequested` (kid → parents).**
- Deps: D2.
- Acceptance: same shape; preference key `wishlistApprovalsNeeded`.
- Owner: implementer · Risk: medium · Estimate: M.

**D4. `notifyWishlistResolved` (parent → kid).**
- Deps: D2.
- Acceptance: same shape; ONE callable handles both approve and deny —
  caller passes `{ wishlistItemId }`, server reads the resolved status to
  pick the body constant (`wishlistApproved` / `wishlistDenied`).
  Preference key `myWishlistResolved`. Reason text is NEVER in the
  notification body; the in-app inbox is where the reason lives.
- Owner: implementer · Risk: medium · Estimate: M.

**D5. `notifyBoardPost` (author → all other family members).**
- Deps: C series in prod (the callable + token-storage pattern).
- Acceptance: callable triggered from `createPost`. Recipients = every
  active member of the author's family EXCEPT the author. Preference key
  `familyBoardPosts`. Body constants: title `"New family post"`, body
  `"Someone in your family shared an update."` (no author name, no
  content). Cross-tenant guard: server re-derives `familyId` from the
  post doc + recipient.
- Owner: implementer · Risk: medium · Estimate: M.

**D6. `notifyTodoCreated` (creator → all other family members).**
- Deps: C series in prod; presumes `todos/{id}` collection exists.
- Acceptance: callable triggered from `createTodo`. Recipients = every
  active member of the family EXCEPT the creator. Preference key
  `familyTodos`. Body: title `"New to-do"`, body `"Something was added
  to your family's to-do list."` (no title, no assignee).
- Owner: implementer · Risk: medium · Estimate: M.

**D7. `notifyTodoCompleted` (completer → all other family members).**
- Deps: D6.
- Acceptance: callable triggered when a to-do flips to `isCompleted=true`.
  Recipients = every active member of the family EXCEPT the completer
  (the creator gets it as part of the broadcast — closes the loop).
  Preference key `familyTodos` (shared with D6 — one mute toggles both).
  Body: title `"To-do completed"`, body `"Something on your family's
  to-do list was finished."` Cross-tenant guard mirrors D5/D6.
- Owner: implementer · Risk: medium · Estimate: M.

### PR E — Observability + the iOS-PWA hint + telemetry

**E1. Structured logging assertions in CI (threat-modeler pushback #5 /
M38 — exact allow-list, no handwave).**
- Deps: C, D series.
- Acceptance: TWO static tests.
  - (1) **No `console.*`** in `functions/src/`: AST scan rejects any
    `console.log` / `.info` / `.warn` / `.error` / `.debug`. Only
    `functions.logger.{info,warn,error}` is allowed (or
    `logger.info(...)` after import).
  - (2) **Forbidden-substring scan** over every `logger.info(...)` AND
    `logger.warn(...)` call site: the second-arg payload object's
    key set must be a SUBSET of the allow-list
    `['kind', 'fnName', 'recipientCount', 'tokensAttempted',
      'tokensFailed', 'durationMs', 'familyId', 'callerUidHash']`.
    Any of the forbidden field names — `choreTitle`, `sourceLabel`,
    `wishlistTitle`, `todoTitle`, `postContent`, `name`, `email`,
    `body`, `token`, `tokenHash`, `assignedTo`, `ownerUid`,
    `reason`, `deniedReason`, `userAgent`, `amount`, `costCents`,
    `dollarValue` — fails the test. (`callerUidHash` is the
    `sha256(uid).slice(0,12)` hash, not the raw uid — a real uid in
    the payload also fails.)
  - (3) `logger.error(...)` calls MAY include a generic message string
    plus the same allow-listed payload; the literal `error` object
    is NEVER passed as a payload (it can carry the FCM token in
    nested `errorInfo`).
- Owner: implementer · Risk: low · Estimate: S.

**E2. iOS-without-PWA hint.**
- Deps: B6.
- Acceptance: when on iOS Safari AND notification permission is granted
  AND `navigator.standalone !== true`, show one banner per session
  explaining "Add to Home Screen to receive notifications on iPhone."
  Dismiss persists for 30 days (`userPrivate.iosPwaHintDismissedAt`).
  Test: in a non-iOS UA the banner never shows; in iOS UA + standalone =
  true the banner never shows.
- Owner: designer + implementer · Risk: low · Estimate: S.

**E3. Push-health dashboard sketch.**
- Deps: observability-setup handoff.
- Acceptance: a documented dashboard config (Cloud Monitoring) showing
  invocations/kind, success ratio, token cleanups, kill-switch
  invocations.
- Owner: observability-setup · Risk: low · Estimate: S.

### PR F — Fast-follow: scheduled-event notifications (DEFERRED)

**Out of scope of v1; ships after PRs A-E land.** Two scheduled events:
event reminders (today/tomorrow) and birthday-in-N-days. Different
trigger shape (Cloud Scheduler → Pub/Sub → onMessagePublished function),
different trust model.

**MANDATORY THREAT-MODELER RE-ENGAGEMENT GATE before PR F implementer
begins (threat-modeler pushback #7):** Cloud Scheduler does NOT carry
a `context.auth` token, and App Check (`enforceAppCheck: true`) does
NOT apply to non-callable functions. The trust derivations for PRs
A-E (caller identity, family membership, App Check origin attestation)
ALL go away in PR F's scheduled-trigger model. The threat-modeler
must produce a new mitigation matrix for the scheduled path before
any code is written — at minimum covering:
- caller-identity authority (the scheduler vs. an attacker who
  somehow invokes the Pub/Sub topic)
- Pub/Sub topic IAM (who can publish?)
- the absence of a per-user request — the function picks recipients
  itself, so the cross-tenant guard becomes "the function NEVER
  reads across families in a single invocation"
- per-family fanout cost (a 1000-family deployment × 5 birthdays/day
  × recipient fanout)
- body-vagueness rules for digest content (event/birthday names are
  PI)

This gate is enforced by leaving the PR F section deliberately
incomplete in this brief.

**2026-06-11 update: the PR F design now lands in §14 below. The
threat-modeler re-engagement gate above remains in force — no F-series
implementation before the threat-modeler signs off on §14.**

---

## 13. Self-validation checklist

- [x] Every "hard to reverse" choice has an ADR (region, push provider —
      ADR-0013; trigger model — ADR-0014).
- [x] Every PI touchpoint has residency, encryption, and (default) absence
      from the body (§4, §5, §10).
- [x] Failure modes are paired with recovery (§8) or explicitly accepted
      (F-PN-4, F-PN-5, F-PN-6, F-PN-7).
- [x] Cost sketch is within the $5 cap; the cap itself is enforced by
      mandatory kill-switch in PR A (§7, PR A).
- [x] Human-gate items flagged loudly (§10) and the kill-switch is
      non-negotiable in PR A.
- [x] An implementer can pick up any single PR with its acceptance criteria
      and ship — no "implement push notifications" hand-waves (§12).
- [x] The PR #84 lesson is honored: functions deploy is its OWN flag-gated
      step, NEVER bundled with rules (A4).
- [x] No PI in lock-screen body, by construction (§1, §10, C3).
- [x] ADR-0010 supersession is in the task list (M-OLD) and called out as a
      human gate (§10 item 6).

---

## 14. PR F — Scheduled push: event reminders + birthday alerts

**Date:** 2026-06-11 · **Author:** architect · **Status:** design (MANDATORY
threat-modeler gate before any F-series code — see §12 PR F gate).
**Companion decision:** ADR-0016 (scheduled-trigger architecture; routed via
memory PR).

**User-locked scope (not relitigated here):** two kinds — event reminders and
birthday alerts; both fire at 8am family-local time on the day of; one push
per event/birthday; no advance notice, no digest.

### 14.1 Trigger architecture (decision)

**`onSchedule` v2 (`firebase-functions/v2/scheduler`), two functions, hourly
cron `0 * * * *` pinned to UTC, region `northamerica-northeast1`.** Rejected
the explicit Cloud Scheduler → Pub/Sub → `onMessagePublished` route. Full
rationale in ADR-0016; the load-bearing points:

- onSchedule's Cloud Scheduler job is **deploy-managed** (created/updated by
  `firebase deploy`) and invokes the function over OIDC-authenticated HTTP.
  There is **no Pub/Sub topic to IAM-audit** (no M41-analog publisher
  surface); the audit shrinks to one negative assertion: the function's Cloud
  Run service has **no public invoker** (`allUsers`/`allAuthenticatedUsers`
  absent from `roles/run.invoker`). Explicit Scheduler+Pub/Sub adds a topic
  (publisher IAM), a manually-created job (runbook drift), and an
  attacker-influenceable message payload — three surfaces for zero benefit.
- **Both handlers IGNORE the event payload entirely.** All inputs (time,
  family set) are derived server-side from the clock and Firestore. Even a
  forged invocation can only cause an on-schedule-equivalent sweep, which the
  dedupe markers (§14.4) make a no-op.
- Cost: Cloud Scheduler gives 3 free jobs/billing account. Two functions = 2
  jobs. The 4th-and-later future scheduled job costs ~$0.10/mo — fine, but
  noted as the precedent constraint.
- Testability: the handler is a plain `async (event) => …` that ignores
  `event`; unit tests call it directly with mocked Firestore/Messaging —
  same mock surface as the existing callables minus the auth context.
- **Relationship to ADR-0014:** not a reversal. ADR-0014 chose
  client-callable because a user action's `runTransaction` is the natural
  exactly-once point. Scheduled reminders have **no user action and no
  running client at 8am** — exactly the case ADR-0014's reversibility note
  anticipated ("server-driven digests, scheduled reminders"). Rule going
  forward: **action-driven → callable (ADR-0014); time-driven → onSchedule
  (ADR-0016).**

Function names: **`notifyEventReminders`** and **`notifyBirthdays`** — the
`notify` prefix is deliberate so the existing dashboard/metric filter
(`resource.labels.service_name=~"^notify"`, `docs/runbooks/observability.md`)
covers them with zero dashboard changes.

### 14.2 Sweep cadence + timezone handling (decision)

**Hourly sweep selecting families whose local hour is 8.** Per-family jobs
rejected (job-count explosion past the 3-free tier); single fixed-timezone
sweep rejected (wrong for any non-Eastern family, and the fix costs one
field).

- `families/{familyId}` gains an optional **`timezone`** field (IANA string,
  e.g. `America/Toronto`). It does **not exist today** (`Family` =
  `{familyName, createdBy, createdAt}`) — F1 adds it. Family-creation
  bootstrap writes `'America/Toronto'`; **absent or invalid values fall back
  to `America/Toronto` at sweep time** (no backfill migration needed).
  Parent-editable under the existing parent-only `families` write rule; a
  settings UI for it is **deferred** (F13, not in PR F).
- Selection predicate: `localHourOf(now, family.timezone) === 8` via
  `Intl.DateTimeFormat` (pure helper, tested under non-UTC `process.env.TZ`
  per the 2026-05-28 lesson). Half-hour-offset zones (e.g. St. John's) fire
  at 8:30 local — accepted. DST transitions occur at 2-3am, never 8am, so
  "8am local" always exists exactly once per day.
- The sweep **reads all `families` docs hourly** (no timezone index). MVP:
  100 docs × 24 × 2 fns ≈ 4,800 reads/day; 10x: 48k/day — at the edge of the
  50k/day free read quota. **Cliff:** at ~1,000+ families, add a
  `tzHourBucket`-style indexed field and query instead of scan; noted, not
  built (no premature genericness).
- Day-of matching:
  - **Events:** `events.date` is a family-local ISO datetime string, so the
    family's local day matches on the string range
    `date >= '<YYYY-MM-DD>T00:00:00' && date <= '<YYYY-MM-DD>T~'` scoped by
    `familyId` — requires composite index `events(familyId asc, date asc)`
    (F8). Events whose time-of-day is before 8am still get the 8am push
    (after the fact) — accepted consequence of the locked "8am day-of" scope.
  - **Birthdays:** equality query `familyId == fid && monthDay == 'MM-DD'`
    (index merging; no composite). **Feb-29 policy:** in non-leap years the
    Feb-28 sweep also matches `monthDay == '02-29'` (mirrors the
    birthdaysService "celebrated Feb 28" comment). Pinned by test.
  - **Scope note (decide-now, one-line veto):** the `birthdays` collection
    also holds `type: 'anniversary'` docs. They fire under the same sweep
    and the same category key (own body constant). Excluding them would
    silently never alert on data users entered; including them costs nothing.

### 14.3 Recipient selection + category keys (decision)

- **Event reminders → every active family member** with
  `pushEnabled && categories.eventReminders`. The locked 7-field event schema
  has **no attendees/assignee field** (the handoff's "who's it for"
  multi-select was explicitly deferred), so involvement-based targeting is
  impossible today. No creator-exclusion: a reminder is time-driven, not
  action-driven — the creator wants it too.
- **Birthday alerts → every active family member** with
  `pushEnabled && categories.birthdays`, **including any birthday person**.
  Surprise-exclusion is structurally impossible: birthday docs carry a free-
  text `name`, not a uid ("Grandma Helen" isn't a user), so exclusion would
  require name-matching against user display names — fragile and a worse
  privacy posture than the fix we already have: **the body names no one**
  (§14.5), and the in-app dashboard widget already shows the birthday to
  everyone including the subject.
- **New category keys:** `eventReminders`, `birthdays` added to
  `notificationPreferences.categories` (all members; default `false`,
  consistent with the master-off default shape). Client settings UI grows
  two toggles (F10).
- Cross-tenant guard (M35.7 analog): the per-family loop scopes every query
  by that family's id, and each recipient's `userPrivate.familyId` is
  re-checked against it before tokens are read (skip + warn, never throw —
  same SOR-Fix-6 stance as `notifyBoardPost`). The function **never sends
  across families within one family's iteration**; recipient state
  (`isActive`, prefs) is read **at fire time**, so a deactivated member never
  receives (the threat-model §A.10 "who is in the family when the scheduler
  fires" question — answer: membership is evaluated per sweep, never cached).

### 14.4 Idempotency: `scheduledSends` markers (decision)

A scheduler sweep can double-fire (retry) or be missed (outage). Dedupe:

```
scheduledSends/{kind}__{sourceId}__{yyyymmdd}     (kind: 'eventReminder' | 'birthday')
  kind: string
  familyId: string
  sourceId: string          // eventId or birthdayId
  localDay: string          // 'YYYY-MM-DD' in the FAMILY's timezone
  sentAt: Timestamp
  recipientCount: number
  expiresAt: number         // sentAt + 7d, epoch ms — Firestore TTL (ADR-0015 pattern)
```

- Written with **`ref.create()` BEFORE the send** (single-doc create is
  atomic; `ALREADY_EXISTS` → skip silently). Semantics: **at-most-once.** A
  marker-written-but-send-failed item is a **dropped push, accepted** — a
  duplicate lock-screen ping trains muting; a dropped reminder is recoverable
  in-app. Consistent with the project's push-is-non-essential posture
  (F-PN-5/6, ADR-0014's accepted-drop). No catch-up sweep for missed hours
  (rejected: per-family per-hour marker probing multiplies reads ~14x for a
  non-essential delivery).
- Rules: **deny all client read/list/write** on `scheduledSends/*` (same as
  `rateLimits`; emulator test). PI: none — ids + counts only.
- TTL: operator runs the `gcloud firestore fields ttls update expiresAt
  --collection-group=scheduledSends …` command (runbook F12), same pattern as
  ADR-0015.

### 14.5 Body constants (M34)

Three new frozen entries in `functions/src/notificationBodies.ts`; all pass
the forbidden-substring scan (name|wishlist|amount|balance|dollar|kid|child|
parent|email|title|body), no template markers, <80 chars:

- `eventReminder`: title `Event reminder` · body
  `An event is on your family calendar today. Open Family HQ for details.`
- `birthdayToday`: title `Birthday today` · body
  `Someone special has a birthday today. Open Family HQ for details.`
  ("birthday" is NOT on the forbidden list; the person is never named;
  "someone special" avoids asserting family membership for non-member
  entries like Grandma Helen.)
- `anniversaryToday`: title `Anniversary today` · body
  `There is an anniversary today. Open Family HQ for details.`

Event title, birthday name, note, and "turning N" age NEVER appear. Click
target stays `data: { url: '/notifications' }`.

### 14.6 Fan-out cap (M36 analog)

No caller to rate-limit; the protection target is fan-out volume. Cap:
**10 marker-creations (pushes) per family per kind per sweep-day**, applied
by ordering the source query (events by `date` asc; birthdays by `createdAt`
asc) and slicing. Overflow items are **dropped** (no marker → and no later
sweep retries them — accepted) with one structured warn carrying
`{kind, familyId, droppedCount}`. The $5 kill-switch remains the hard
backstop. Function config: 256MB, `timeoutSeconds: 300`, sequential
per-family processing (at 10x, ~42 families match per sweep — trivial).

### 14.7 Observability + kill-switch interplay

- Names `notifyEventReminders` / `notifyBirthdays` ride the existing
  `^notify` dashboard filter — **no dashboard JSON change needed.**
- One summary log per invocation: `{kind, fnName, familiesScanned,
  familiesMatched, sourceCount, recipientCount, tokensAttempted,
  tokensFailed, cleanedTokenCount, markerSkipCount, droppedCount,
  durationMs}` plus per-family info lines (`familyId` + counts). **New keys
  must be added to the M38 allow-list test; `timezone` and `localDay` are
  added to the FORBIDDEN log-field list** (timezone is a coarse-location
  signal; it stays on the family doc, never in logs). No `actorUid` /
  `callerUidHash` — there is no caller; the log contract otherwise applies
  unchanged (response-shape question is moot: nothing consumes a return
  value).
- **Kill-switch: no extra wiring.** The $5 cap detaches billing
  project-wide; scheduled invocations then fail on every tick. Runbook (F12)
  adds: after a kill-switch event, `gcloud scheduler jobs pause` the two
  jobs to stop error noise; resume after billing re-attach.

### 14.8 New failure modes

| F# | Mode | Behavior | Recovery |
| -- | ---- | -------- | -------- |
| F-PN-11 | Scheduler outage spanning a family's 8am hour | Pushes for that family-day silently dropped | Accepted (no catch-up); in-app surfaces unaffected |
| F-PN-12 | Sweep double-fire / scheduler retry | `scheduledSends` `create()` collides → skip | By construction; pinned by test |
| F-PN-13 | Marker written, FCM send fails | Push dropped for that item (at-most-once) | Accepted; `skipReason:'send_failed'` logged |
| F-PN-14 | Family doc has invalid/missing `timezone` | Fallback `America/Toronto`; warn with familyId only (never the tz value) | Parent fixes via future settings UI (F13) |
| F-PN-15 | Kill-switch fired → billing detached | Both scheduled fns error every tick | Runbook: pause jobs; resume post-re-attach |
| F-PN-16 | >10 same-kind items in one family-day | Earliest 10 sent; rest dropped + warn | Accepted; cap constant is an easy knob |

### 14.9 PR F ordered task breakdown

**Gate 0 (blocking): threat-modeler reviews §14 and issues the scheduled-path
mitigation matrix (§12 PR F gate). No F-task starts before sign-off.**

**F1. Add `timezone` to `families` (type + bootstrap + rules).**
- Deps: gate 0.
- Acceptance: `Family.timezone?: string` in `lib/types`; family-creation
  batch writes `'America/Toronto'`; rules permit parent-only update, value
  `is string && size() <= 50`; emulator tests: member write denied, parent
  write allowed, cross-family denied. No backfill (sweep-side fallback).
- Owner: implementer + test-writer · Risk: low · Estimate: S.

**F2. `scheduledSends` collection: rules + types + TTL.**
- Deps: gate 0.
- Acceptance: rules deny ALL client get/list/create/update/delete on
  `scheduledSends/{id}` (emulator tests incl. authenticated parent);
  doc shape per §14.4; runbook line for the TTL `gcloud` command (staging +
  prod). **Security-critical: no autonomous merge.**
- Owner: test-writer + implementer · Risk: medium · Estimate: S.

**F3. Shared fan-out helper `functions/src/lib/sendCategoryPush.ts`.**
- Deps: gate 0.
- Acceptance: `sendCategoryPushToFamily({db, messaging, familyId,
  categoryKey, bodyConstant})` — resolves active members of ONE family,
  applies prefs gate, reads tokens, multicasts, cleans stale tokens via the
  M37 allow-list (`registration-token-not-registered`,
  `invalid-registration-token` ONLY), returns counts. Unit tests replicate
  the C-T8/C-T13 contract (cross-tenant recipient skipped+warned; transient
  FCM codes never delete). Existing callables NOT migrated in this PR
  (optional follow-up; keeps the diff reviewable).
- Owner: implementer · Risk: medium · Estimate: M.

**F4. Pure timezone helper `localHourAndDay(nowMs, tz)`.**
- Deps: gate 0.
- Acceptance: returns `{hour, day:'YYYY-MM-DD'}` in `tz` via Intl; invalid
  tz → `{...fallback, usedFallback:true}` with `America/Toronto`. Tests run
  under non-UTC `process.env.TZ` (lesson 2026-05-28); cases: Toronto,
  Vancouver, St. John's (half-hour), invalid string, DST boundary day.
- Owner: implementer · Risk: low · Estimate: S.

**F5. Body constants + M34 audit extension.**
- Deps: gate 0 (+ human gate: user approves the three strings, §14.5).
- Acceptance: `eventReminder`, `birthdayToday`, `anniversaryToday` frozen
  entries; existing CI scan covers them (no template markers, forbidden
  substrings absent, <80 chars).
- Owner: implementer · Risk: low · Estimate: S.

**F6. Composite index `events(familyId asc, date asc)`.**
- Deps: gate 0.
- Acceptance: added to `firestore.indexes.json`; deploys via the EXISTING
  rules/indexes step (NEVER bundled with functions deploy — PR #84 lesson).
- Owner: implementer · Risk: low · Estimate: S.

**F7. `notifyEventReminders` onSchedule function.**
- Deps: F1-F6.
- Acceptance: `onSchedule({schedule:'0 * * * *', timeZone:'UTC',
  region:'northamerica-northeast1', timeoutSeconds:300, memory:'256MiB'},…)`;
  handler ignores the event payload (test: payload fields never read); scans
  families, selects local-hour-8 via F4, queries events by familyId+local-day
  range, caps at 10 (date asc), `create()`s marker before send, sends via F3
  with `eventReminder` constant, logs per §14.7. Tests: dedupe skip on
  existing marker; cap overflow drops+warns; cross-family isolation (family
  A's event never reaches family B's members); marker-then-send order;
  invalid-tz fallback. **Security-critical: no autonomous merge.**
- Owner: implementer · Risk: HIGH (first scheduled fn; cross-tenant
  iteration) · Estimate: L.

**F8. `notifyBirthdays` onSchedule function.**
- Deps: F1-F6 (parallel with F7 after F3/F4 land).
- Acceptance: same scaffold; birthdays by `familyId + monthDay` equality;
  Feb-29→Feb-28 non-leap rule pinned by test; body constant picked by
  `type` (`birthdayToday` / `anniversaryToday`); cap 10 (createdAt asc);
  markers `birthday__{birthdayId}__{yyyymmdd}`. **Security-critical: no
  autonomous merge.**
- Owner: implementer · Risk: high · Estimate: M.

**F9. M38 log allow-list + AST-gate extension.**
- Deps: F7, F8.
- Acceptance: allow-list grows by `familiesScanned, familiesMatched,
  sourceCount, markerSkipCount, droppedCount`; `timezone` and `localDay`
  added to the forbidden field names; no-console AST scan covers the new
  files (it already globs `functions/src/`; assert it).
- Owner: implementer · Risk: low · Estimate: S.

**F10. Client: two new category toggles.**
- Deps: F1 merged (types); parallel with F7/F8.
- Acceptance: `eventReminders` + `birthdays` keys added to the
  `notificationPreferences.categories` type + default-off bootstrap shape;
  settings screen renders both toggles for ALL roles; AODA per B5's bar
  (keyboard, 44px, focus, labels).
- Owner: designer + implementer · Risk: low · Estimate: M.

**F11. Deploy-list extension + CI assertion.**
- Deps: F7, F8.
- Acceptance: `--only` grows to `…,functions:notifyEventReminders,
  functions:notifyBirthdays`; `billingKillSwitch` remains FIRST (CI
  assertion updated); flag-gated step unchanged.
- Owner: implementer · Risk: medium · Estimate: S.

**F12. Runbook `docs/runbooks/scheduled-push.md` + operator deploy.**
- Deps: F11.
- Acceptance: documents — post-deploy verification that exactly 2 scheduler
  jobs exist (`gcloud scheduler jobs list`); the negative invoker assertion
  (no `allUsers`/`allAuthenticatedUsers` in `roles/run.invoker` on either
  function's Cloud Run service, with the exact `gcloud` command);
  pause/resume/force-run commands; kill-switch interplay (§14.7); the
  `scheduledSends` TTL activation command. Operator executes against
  staging, force-runs one sweep, verifies a marker + a delivered push, then
  prod. **Manual operator step — not CI.**
- Owner: implementer writes · user executes · Risk: medium · Estimate: S.

**F13 (DEFERRED — not in PR F).** Family-settings UI to edit `timezone`.
Follow-up feature task; until then all families are `America/Toronto`.

### 14.10 PR F human-gate items (LOUD)

1. **ADR-0016 approval** (trigger architecture) via the memory PR.
2. **Threat-modeler sign-off on §14** before any F-series code (gate 0).
3. **Approve the three lock-screen strings** (§14.5).
4. **Approve `America/Toronto` as the universal timezone default** until F13.
5. **Anniversary inclusion** under the `birthdays` category (§14.2 scope
   note) — one-line veto.
6. **Operator runbook execution** (F12): scheduler-job verification, invoker
   negative assertion, TTL activation.
7. Cloud Scheduler is a new Google-platform service in the project; it
   carries **no PI** (empty payload, ignored by handlers) — flagged for the
   record, no new subprocessor handling PI.
