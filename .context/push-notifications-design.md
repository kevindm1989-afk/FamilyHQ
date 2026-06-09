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
| F-PN-3 | FCM returns `messaging/registration-token-not-registered` or 404/410 | Function receives per-recipient response array; for each failed token, deletes the corresponding `fcmTokens/{tokenHash}` doc | Pinned in implementer tests; idempotent (deleting a missing doc is no-op) |
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
  listing: the service account email (the default 2nd-gen functions SA is
  fine); the role `roles/billing.projectManager` granted on the billing
  account (NOT the project); the gcloud commands to grant; verification step
  (`gcloud beta billing accounts get-iam-policy` shows the binding). This is
  a **manual operator step** before A4 — explicitly NOT a CI job.
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
  `request.auth.uid == uid` AND `isActive()`. Cross-user read: denied.
  Cross-family read: denied. Emulator tests:
  - own user reads own token: allowed
  - same-family parent reads child's token: denied
  - other-family user reads token: denied
  - unauthenticated: denied
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

**B5. Notification preferences UI.**
- Deps: B1, B3.
- Acceptance: settings screen lets a user toggle master push + per-category
  toggles. Master-off triggers `unregisterToken`. Master-on triggers the
  permission prompt + `registerToken`. AODA: keyboard operable, 44px taps,
  visible focus, screen-reader labels per `lessons.md` ARIA-role rule.
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
- Acceptance: region `northamerica-northeast1`, runtime Node 20, App Check
  required. Input: `{ choreId }`. Server steps:
  1. assert `context.auth`; reject UNAUTHENTICATED otherwise.
  2. read caller's `users/{uid}` (Admin SDK); reject if missing /
     `isActive == false`.
  3. read `chores/{choreId}`; reject if missing OR
     `chore.familyId != caller.familyId` OR `chore.status != 'approved'`.
  4. read recipient (chore.assignedTo) `userPrivate/{assignedTo}`; reject
     if `assignedTo`'s familyId != caller.familyId (cross-tenant defense in
     depth).
  5. if recipient's `notificationPreferences.myChoreResolved == false`,
     return `{ sent: 0, reason: 'opted_out' }` and STOP.
  6. read recipient's `fcmTokens` subcollection; if empty, return
     `{ sent: 0, reason: 'no_tokens' }`.
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

**E1. Structured logging assertions in CI.**
- Deps: C, D series.
- Acceptance: a static test (eslint rule or unit test) asserts no
  `console.log` in `functions/src/`; only `functions.logger.info/warn/error`
  with structured payload. Test asserts no field named
  `[choreTitle, name, body, email, token]` is logged at info level.
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
