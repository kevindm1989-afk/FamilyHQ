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

## ADR-0007 addendum — Dark mode ships as a runtime CSS-variable layer (resolves ADR-0007's open dark-palette item)

**Status:** Proposed (HUMAN GATE — user signs by merging this memory PR)
**Date:** 2026-07-08
**Decider(s):** orchestrator (proposed); user (approved the dark palette + shipped it, PR #153)

**Context:** ADR-0007 flagged an open gap — "the handoff has no dark-mode palette… surfaced to the designer as an open item" — even though `preferences.md` requires dark mode and `users.theme` already supports `'dark'`. This addendum records how that gap was closed.

**Decision:** `design-tokens.json` now carries `color.light` + `color.dark` at identical key shape. `scripts/gen-theme-css.cjs` emits `src/index.theme.css`, defining every `--c-<token>` CSS variable under `:root` (light), `:root[data-theme='dark']` (dark), and a `@media (prefers-color-scheme: dark)` fallback for `:root:not([data-theme])`. `tailwind.config.ts` maps every colour utility to `var(--c-*)`, so themes swap with ZERO component changes and NO `dark:` variants. `src/applyTheme.ts` stamps/clears `data-theme` on `<html>` from the signed-in user's choice; `themeService.setUserTheme` persists it (the self-writable `theme` field, ADR-0002). `index.theme.css` is the one file `token-audit.sh` permits to carry committed hex (the `*.theme.*` exclusion), guarded by the drift test `test/theme-css-drift.test.ts` (see patterns.md "drift gate").

**Rationale:** A CSS-variable layer keeps theming a token/config concern, not a per-component one — no `dark:` variant sprawl, no risk of a component missing a variant. Generating the hex from tokens preserves the ADR-0007 single-source-of-truth invariant; the drift gate makes staleness a CI failure, not a runtime bug.

**Reversibility:** Easy — regenerating the variable layer from tokens is mechanical; reverting is a config/token change, not a component rewrite.

**Compliance check:** WCAG 2.1 AA contrast re-audited in BOTH light and dark (the tokens' contrast audit, previously light-only per ADR-0007, now covers dark). No data/privacy impact.

---

## ADR-0017 — First-party telemetry over any third-party analytics / error-reporting SDK

**Status:** Proposed (HUMAN GATE — user signs by merging this memory PR)
**Date:** 2026-07-08
**Decider(s):** orchestrator (proposed); user (chose "first-party only", PR #152)

**Context:** v1 was flying blind on usage and client errors. The options were a third-party SDK (GA4, Sentry) or first-party instrumentation written through the existing Firebase project.

**Decision:** First-party only. Anonymous aggregate usage counters + PI-scrubbed client error reports are written to Firestore via the existing project; no GA4/Sentry/third-party SDK. Error reports scrub PI (emails + long digit runs masked, id-like route segments → `:id`, one origin-stripped stack frame, length-capped) and are session-capped so a crash loop can't spam. Firestore rules make the collections create-only for active users and deny read/update/delete (review in the Console).

**Rationale:** A third-party analytics/error SDK is a new subprocessor receiving event/error payloads while children are users — a human-gate under `constraints.md` §Third-parties, and a poor fit for the no-behavioural-tracking children's-data baseline. First-party keeps residency in the Montreal project, adds no DPA, and needs no consent-banner surface. Consistent with prior first-party choices (ADR-0013 rejected OneSignal; ADR-0003 gated the email subprocessor). The reliability lesson found while building it (memoize a single dynamic `import()` of the shared Firebase module) is captured separately once it recurs.

**Reversibility:** Medium — adding a third-party SDK later re-opens the subprocessor human-gate and a consent review; the first-party data model itself is cheap to keep or drop.

**Compliance check:** No new subprocessor; no behavioural tracking; PI scrubbed at the write boundary; residency stays in `northamerica-northeast1`. Aligns with `constraints.md` §Third-parties and §Children's-data (cited, not modified).

---

## ADR-0016 — Scheduled push trigger: `onSchedule` v2, exempting time-driven sends from ADR-0014

**Status:** Proposed (HUMAN GATE — user signs by merging this memory PR)
**Date:** 2026-06-11
**Decider(s):** architect (proposed); threat-modeler (endorsed, §A.18); user (approval pending)

**Context:** PR F ships event reminders and birthday alerts firing at 8am
family-local. ADR-0014 mandates client-callable triggers; there is no client
running at 8am, so PR F is the first server-initiated send. The trigger
options: (A) `onSchedule` v2 (deploy-managed Cloud Scheduler job →
OIDC-authenticated HTTP invocation), (B) explicit Cloud Scheduler → Pub/Sub
topic → `onMessagePublished` (the `billingKillSwitch` shape), (C) per-family
scheduler jobs.

**Decision drivers:** IAM surface, operator runbook burden, testability,
region pinning (`northamerica-northeast1`), cost (3 free scheduler jobs),
precedent for future scheduled work.

**Options considered:**
- **(A) chosen** — deploy-managed job, no Pub/Sub topic to IAM-audit; single
  positive invoker pin (M45); handler is a plain async function for unit
  tests.
- **(B) rejected** — adds a publishable topic (M41-analog publisher audit), a
  manually-created job (runbook drift), and an attacker-influenceable message
  payload, for no benefit; the kill-switch uses Pub/Sub only because Cloud
  Billing pushes there natively. Threat-modeler endorsement: payload-ignoring
  is strictly stronger than payload validation.
- **(C) rejected** — job count scales with families; per-job pricing past 3
  free.

**Decision:** Option A. Two functions (`notifyEventReminders`,
`notifyBirthdays`), hourly UTC cron, Montreal region, payload ignored;
idempotency via `scheduledSends/{kind}__{sourceId}__{yyyymmdd}` markers
(at-most-once — marker `create()`d BEFORE send); per-family-per-day fan-out
cap of 10/kind.

**Why this is exempt from ADR-0014, not a reversal:** ADR-0014's rationale is
that a user action's `runTransaction` is the natural exactly-once trigger
point. Time-driven sends have no user action — the exact case ADR-0014's
reversibility note reserved ("server-driven digests, scheduled reminders").
Standing rule: **action-driven → callable; time-driven → onSchedule.**
ADR-0014 remains authoritative for all action-driven notifications.

**Reversibility:** Medium — swapping to route B is a per-function change;
markers, prefs, tokens, bodies all carry over unchanged.

**Consequences:** (+) smallest IAM surface; free dashboard coverage via
`notify*` naming; $0 at MVP and 10x (2 of 3 free scheduler jobs; ~1.4k
invocations/mo; family-scan reads ~4.8k/day MVP). (−) at-most-once means rare
dropped reminders (accepted; push is non-essential); family scan hits a
read-quota cliff at ~1,000+ families (then add an indexed tz-bucket field);
3rd+ future scheduled job costs ~$0.10/mo.

**Compliance check:** No new subprocessor touching PI — Cloud Scheduler
payload is empty and ignored. Residency: function + Firestore stay in
Montreal. `timezone` (quasi-location signal, family-granularity) stays on the
family doc, banned from logs (M38 extension, M50). Recipient membership
evaluated at fire time, never cached (M51). Full threat model: §A.18
(T7.1-T7.8, M45-M52).

---

## ADR-0015 — `rateLimits/{kind}__{callerUid}` collection: purpose, shape, retention

**Status:** Accepted (codified in PR D, retroactively documented here)
**Date:** 2026-06-11
**Decider(s):** orchestrator + privacy-reviewer (BLOCK during PR D round-1
review); user signs by merging this memory PR.

**Context:** PR C introduced (and PR D extended to all 7 notify-callables)
a per-caller rate limit (M36) implemented as a single Firestore doc per
`(kind, callerUid)` pair. The collection was added without a recorded
ADR; privacy-reviewer blocked PR D until purpose + retention were
documented. This ADR codifies the existing implementation so future
readers know what the docs are for and when they age out.

**Decision:** A top-level Firestore collection `rateLimits` with doc id
shape `{kind}__{callerUid}` and field shape:

```ts
{
  count: number,            // invocations within the current window
  windowStartMs: number,    // epoch ms when the current window started
  expiresAt: number,        // epoch ms when this doc may be deleted (windowStartMs + 7d)
}
```

- Purpose: M36 — per-caller rate limit on every chargeable notify-
  callable. Reading + incrementing the count inside `db.runTransaction`
  prevents concurrent invocations from both observing `count = N` and
  both writing `count = N+1` (security-reviewer pin during PR C).
- Residency: `northamerica-northeast1` (inherits the project's default;
  same as `chores`, `users`, etc.).
- Retention: 7 days after `windowStartMs`. The `expiresAt` field is
  written on every `tx.set(...)` so a Firestore TTL policy on the
  field will reclaim the doc automatically once it has been idle for
  one window-plus-buffer. Activation command (operator runbook):

  ```sh
  gcloud firestore fields ttls update expiresAt \
    --collection-group=rateLimits \
    --enable-ttl --project="$FIREBASE_PROJECT_ID"
  ```

  Re-run for the staging and production projects.
- Access: server-side only via Admin SDK. `firestore.rules` denies all
  client read/list/write on `rateLimits/*` — verified by
  `test/rules/rateLimits.test.ts` in the rules-emulator suite.
- PI classification: low. The doc id embeds a `callerUid` (a system
  identifier), but no PI fields are written. The collection still
  appears in `threat-model.md §1.2` so the inventory is complete.

**Rationale:** Per-caller doc-shape was the cheapest viable rate-limit
primitive on Firestore (no Redis, no external KV); the doc id keys on
both the callable kind and the caller, so a single user cannot exhaust
their cap on `notifyChoreApproved` and starve `notifyTodoCreated`. The
7-day TTL was chosen long enough that an inactive user does not get
"reset" on every new window (which would defeat the cap) but short
enough that an idle UID does not accumulate forever. The Firestore TTL
policy makes the retention an infrastructure invariant — the
application code does not need to schedule a sweep.

**Reversibility:** Low cost to revisit. Changing the window or the cap
is a per-callable constant edit. Migrating off Firestore to Redis would
be a meaningful undertaking but the threat surface is unchanged.

**Consequences:**
- (+) Per-callable rate limits work as designed; multi-recipient
  fan-outs count as ONE invocation against the caller's cap.
- (+) Privacy-clean: no doc payload field is PI; the doc id's
  `callerUid` is the same identifier already present on every other
  user-owned doc.
- (+) Operator workload bounded — the TTL is a one-time policy
  toggle, not a recurring sweep.
- (-) Operator MUST activate the TTL policy before merge ships to
  prod; otherwise docs accumulate. Tracked in the operator pre-
  deploy checklist.

**Compliance check:** PI inventory in `threat-model.md §1.2` updated
to list `rateLimits`. No new subprocessor; no cross-border transfer
beyond what ADR-0013 already disclosed.

---

## 2026-06-11 — Drop `reason` from notify-callable response shape (privacy hardening)

**Context:** PR C's M39 mitigation declared the callable response
shape as `{ sent: number, cleaned: number }` on success and
`{ sent: 0, reason: 'opted_out' | 'no_tokens' | 'send_failed' }` on
non-error skip. PR D added six more callables that inherited this
shape. Privacy-reviewer found (BLOCK 1+2) that a caller can flip a
recipient's preference toggle, observe whether `reason` flips from
`'opted_out'` to `'no_tokens'`, and infer aggregate preference state
of other family members — a real PIPEDA enumeration oracle, more
acute for under-13 recipients (Quebec Law 25 sensitive-info
baseline).

**Decision:** Drop `reason` from the callable response shape across
all 7 callables. Every skip and FCM-throw branch now returns
`{ sent: 0, cleaned: 0 }`. The skip classification is preserved
server-side via a new M38 allow-listed log field `skipReason`
(`'opted_out' | 'no_tokens' | 'send_failed'`) so ops debugging is
unimpaired.

**Rationale:** The client is fire-and-forget (ADR-0014); it never
consumes the response. The `reason` field had operational value only
in dev / ops, which the structured log already covers. Dropping it
from the response removes the enumeration oracle at zero functional
cost.

**Reversibility:** High — the response shape can be widened later if
a real client consumer needs the discrimination, but doing so
re-introduces the oracle and would need its own privacy review.

**Consequences:** (+) Privacy posture strictly better; consistent
contract across all notify-callables; client type narrows to
`{ sent: number; cleaned: number }`. (-) PR C's response shape is a
breaking change for any external consumer (none today; the callable
is invoked only by the SPA which we updated in lockstep).

**Compliance check:** M38 log allow-list grows by one field
(`skipReason`); no new PI surface. M39 prose in `threat-model.md`
updated alongside this ADR.

---

## ADR-0014 — Push notifications: HTTPS-callable trigger (rejected Firestore trigger)

**Status:** Proposed (depends on ADR-0013 acceptance)
**Date:** 2026-06-09
**Decider(s):** architect (proposed); user (approval pending)

**Context:** With ADR-0013 committing us to Cloud Functions + FCM, the next
question is how those functions are invoked. The two real candidates are:
(A) Firestore-triggered functions watching `chores`/`wishlistItems` writes for
the relevant status transitions, or (B) HTTPS-callable functions invoked by
the client immediately after it completes the same `runTransaction` that
performed the state change (`approveChore` and the forthcoming wishlist
equivalents).

**Decision drivers:** correctness (no double-send, no missed send), cost,
simplicity of the trust boundary, fit with the existing approval transaction
shape (ADR-0004), debuggability.

**Options considered:**
- **A — Firestore-triggered function.** Pro: the doc is the source of truth;
  fires even if the client crashed or the browser was closed; no client→
  Function trust round-trip. Con: 2nd-gen Firestore triggers can retry on
  transient errors and we'd have to engineer idempotency at the trigger
  level (a `lastNotifiedAt` field per doc, or a dedupe key per attempt — non-
  trivial); the function fires from the same project but bypasses rules, so
  the cross-tenant defense must be re-implemented inside the trigger; debug
  loop is slower (must mutate Firestore to test).
- **B — HTTPS-callable, fired by the client after `runTransaction` resolves**
  (chosen). The approval `runTransaction` (ADR-0004) is the single, ordered,
  idempotent point where status flips to `approved` — exactly one client
  successfully resolves it; that one client then fires one callable. No
  retry/duplicate concerns at the trigger; the callable still re-derives
  trust server-side (same shape as the invite Function, M11/M12) so a
  malicious client can't fire arbitrary notifies. Con: if the client
  resolves the tx then loses connectivity before the callable returns, the
  notification doesn't fire — that case is acceptable (the recipient sees
  the state on next app open; push is non-essential).

**Decision:** Option B. HTTPS callable, invoked from the same client function
that resolved the state-change transaction. The callable independently
re-verifies caller identity + family + the source doc's state before sending.

**Rationale:** Best fit with existing transactional approval shape; no
double-fire risk; cheaper (one invocation per real event, not one per retry);
trust boundary identical to the existing invite Function (ADR-0003); simpler
to test in CI.

**Reversibility:** **Medium.** A future shift to Firestore triggers (e.g.
if push-without-client-running becomes important — server-driven digests,
scheduled reminders) is a per-event swap; nothing about the data model or
token storage changes.

**Consequences:** (+) one fire per event, no dedupe needed, fast to ship,
trust pattern reused. (-) if the client never gets to invoke the callable
(crash between tx commit and callable return), push silently doesn't fire —
accepted because push is non-essential and the in-app inbox carries the same
information.

**Compliance check:** No new subprocessor introduced by this decision (FCM
is covered in ADR-0013). The cross-tenant guarantee (recipient and source
doc must share the caller's `familyId`) lives inside the callable —
threat-modeler must pin the test cases.

---

## ADR-0013 — Push notifications: Blaze + Cloud Functions + FCM

**Status:** Proposed (HUMAN GATE — supersedes ADR-0010; activates Blaze;
introduces new trust boundaries TB5/TB6; introduces cross-border push
transport)
**Date:** 2026-06-09
**Decider(s):** architect (proposed); user (approval pending)
**Supersedes:** ADR-0010 ("Stay on Firebase Spark; tier-gated features ship
dormant"). A memory PR must add the `Superseded by: ADR-0013` header to
ADR-0010. (Note: ADR-0010 is not present in this file as of 2026-06-09; the
memory PR may need to draft the original ADR-0010 entry alongside the
supersession header — user to confirm.)

**Context:** The Family HQ product has accumulated four event categories
(chore approval-needed, chore approved, wishlist approval-needed, wishlist
resolved) whose value is highly time-sensitive — a parent who learns about a
chore submission an hour later cannot reinforce the moment. The dormant
feature-gate strategy of ADR-0010 traded responsiveness for cost ($0/mo on
Spark, no Cloud Functions). With the user's decision to enable Blaze under a
$5/mo budget cap and the corresponding kill-switch infrastructure live, push
notifications become viable.

**Decision drivers:**
- Real-time delivery for ~20 events/family/day, sub-3s p95 to lock screen.
- Hard $5/mo budget cap; the design must fit inside Cloud Functions 2nd-gen
  free tier at MVP and 10x scale.
- PIPEDA / Quebec Law 25 / Children's-data rules (`.context/constraints.md`):
  no PI on a lock screen by default.
- Canadian data residency for compute and storage.
- Reversibility of the push provider is hard (re-prompts every device); the
  trigger model is the soft choice (ADR-0014).
- Lesson from PR #84 (`lessons.md`): a multi-service `--only` deploy flag
  must NOT couple billing-gated Functions to always-on rules/hosting.

**Options considered:**
- **A — Stay on Spark; in-app inbox only.** Pro: zero cost, zero new
  subprocessors, current ADR-0010 stance. Con: misses the actual product
  need (real-time parental awareness of kid actions and vice versa); the
  rest of the v1 push event list (chore awaiting approval, allowance
  approval, wishlist resolution) is exactly the set users open the app to
  check, so the in-app inbox is too lagging. Rejected.
- **B — OneSignal / a third-party push platform.** Pro: rich segmentation,
  cross-platform abstractions. Con: introduces a new subprocessor that
  would receive notification payloads and device tokens (PI flag);
  duplicates capability we already get free with Firebase; an extra DPA
  and human-gate hoop for no measurable benefit at our scale. Rejected.
- **C — FCM Web Push via Firebase Admin SDK in Cloud Functions, region
  northamerica-northeast1, vague-body-by-default, $5/mo budget cap with a
  mandatory kill-switch deployed in the same PR as the first chargeable
  function** (chosen).

**Decision:** Option C. Specifically:

1. **Compute:** Cloud Functions (2nd gen), Node 20 runtime, region
   `northamerica-northeast1` (Montreal — Canadian residency for compute
   and logs). Min-instances = 0 (cold-start ~2-4s is acceptable; push is
   non-essential).
2. **Trigger model:** HTTPS callable from the client AFTER the relevant
   `runTransaction` resolves. Full rationale in ADR-0014.
3. **Device token storage:** `userPrivate/{uid}/fcmTokens/{tokenHash}`
   subcollection (one doc per device). NOT on the family-readable `users`
   doc (children's clients would see adult tokens — same logic as
   ADR-0008). Token-doc rules: read/list/create/update/delete only by the
   subject; cross-family and cross-user access denied; tested in the
   emulator.
4. **`notificationPreferences`** lives on `userPrivate/{uid}` (not `users`)
   with a master `pushEnabled` + per-category booleans + a future
   `showDetails` (false at v1, per-device opt-in at v1.1).
5. **v1 events (7 callable-triggered):**
   (1) chore submitted (kid → parents),
   (2) chore approved (parent → kid),
   (3) wishlist requested (kid → parents),
   (4) wishlist resolved approved-or-denied (parent → kid),
   (5) new board post (author → all other family members),
   (6) new to-do created (creator → all other family members),
   (7) to-do completed (completer → all other family members — closes the
   loop for whoever asked for the to-do).
   **Fast-follow in PR F:** event reminders (today/tomorrow) and
   birthday-in-N-days. Both need a scheduled-function trigger model + Cloud
   Scheduler — a different deployment shape. Separate ADR.
   **Dropped:** shopping-list adds (~20 per grocery trip would train users
   to mute the app; the list is a glanceable surface anyway).
6. **Notification body:** vague-by-default constants in
   `functions/src/notificationBodies.ts`. No child name, no chore title, no
   wishlist title, no money amount, no post content, no to-do title. A CI
   test asserts no template substitution in any body string and no forbidden
   substring.
7. **Deploy pipeline:** a NEW `deploy-functions` job in `deploy.yml`,
   flag-gated (`workflow_dispatch` input `deploy_functions: false` by
   default), separated from `firestore:rules,firestore:indexes,storage:rules`
   per the PR #84 lesson. The `--only` list for the kill-switch deploy and
   subsequent function deploys is explicit and ordered (kill-switch first).
8. **Budget kill-switch (NON-NEGOTIABLE):** a Pub/Sub-triggered Function
   (`billingKillSwitch`) listens to the existing `billing-budget-alerts`
   topic and on threshold breach calls
   `cloudbilling.projects.updateBillingInfo({billingAccountName:''})` to
   detach billing. Must deploy in the SAME PR as the first chargeable
   Function and BEFORE any chargeable function runs in production.
   IAM: the 2nd-gen functions default service account is granted
   `roles/billing.projectManager` on the billing account (NOT
   project-level owner).
9. **VAPID key:** the already-generated public key
   `BLG9wihx9...912WrEA` is loaded by the client as
   `VITE_FCM_VAPID_PUBLIC_KEY` at build time. The server uses the Admin
   SDK and does not handle VAPID directly.
10. **Permission UX:** never prompt on page load. Prompt contextually after
    the user just performed an action whose follow-up they'd benefit from
    hearing about (e.g. just approved a chore → toast: "Get a heads-up
    when there's another to approve" → "Turn on" / "Not now" / "Remind me
    later"). iOS-without-PWA-install is acknowledged: detect and show a
    one-time "Add to Home Screen" hint; do not engineer around it.
11. **Subprocessors:** Google FCM (existing) handles push payloads; Apple
    APNs / Mozilla autopush / Google Android FCM transport handles
    OS-level delivery. Vague-body design keeps no PI in those transports
    by default. Cross-border human gate (CB3 = FCM, CB4 = Apple/Mozilla
    transports) is flagged.

**Rationale:** FCM is the existing Google capability and adds no new
subprocessor at the platform layer; Canadian region keeps compute and logs
in Canada; the vague-body rule keeps PI off the lock screen by construction
(not by review discipline) so a copy-paste mistake can't leak a child's
name; the budget kill-switch makes the $5/mo a hard ceiling rather than an
aspirational one; the deploy-split lesson from PR #84 is honored; the
trigger model reuses existing transactional shape (ADR-0004) and the
existing server-side trust pattern (ADR-0003 / M11+M12).

**Reversibility:**
- Push provider: **Hard.** Switching away from FCM means re-prompting every
  device for permission and re-registering tokens.
- Region: **Hard.** Per-function permanent; a region move = re-deploy under
  a new name + token churn.
- Token storage shape: **Medium.** Single per-user migration.
- Trigger model (callable vs Firestore-trigger): **Medium.** Per-event swap;
  no data model change. See ADR-0014.
- Notification body strings: **Easy.** Constants file.
- Budget cap value: **Easy.** Console + kill-switch behavior unchanged.

**Consequences:**
- (+) Real-time push for the 7 v1 events; in-product responsiveness step
  change.
- (+) Cost stays at $0 forecast at MVP and 10x; $5/mo enforced by
  kill-switch as a hard ceiling.
- (+) PI never lands on a lock screen by construction (vague-body
  constants + CI assertion).
- (+) Trust pattern reused from invite Function — well-understood by the
  team.
- (-) Activates Blaze, which is operationally hard to walk back once
  families depend on notifications.
- (-) Introduces two new trust boundaries (TB5 Function↔FCM, TB6
  FCM↔device push services) and two cross-border transfers (CB3 FCM,
  CB4 APNs/Mozilla) that the threat-modeler must enumerate and the user
  must approve.
- (-) iOS-without-PWA users get a degraded experience; explicitly
  accepted as a platform limitation.
- (-) The chore-photo Storage flow (already shipped dormant) becomes live
  as a side effect of Blaze going live. **This is noted and intentional;
  no Storage activation is bundled into the push-notifications PRs.** Any
  product-facing chore-photo activation work (UI copy, parent review
  flow) is a separate feature PR.

**Compliance check:**
- PIPEDA Principle 4 (minimization) honored — vague body, no PI in
  payload by default. PIPEDA Principle 3 (consent) — user explicitly
  grants permission via OS prompt AND the in-app preferences toggle.
- Children's-data rule (no behavioural tracking, no marketing) honored —
  transactional only, payload PI-free, no third-party analytics SDK.
- Tenant isolation (#1 risk in `constraints.md`) preserved — every
  callable re-derives `familyId` from the caller's `users` doc and
  asserts source-doc and recipient `familyId` match; tokens are
  per-subject under `userPrivate` rules that already deny cross-family
  reads.
- Cross-border transfers CB3 (FCM) and CB4 (Apple/Mozilla push
  transports) are **human-gate** items per
  `constraints.md` §Third-parties. Vague-body design is the safeguard at
  CB4; FCM is an existing Firebase subprocessor.
- Budget cap + kill-switch make the cost ceiling enforceable, not
  aspirational.
- Security-critical (cross-tenant defense in the callables + the
  kill-switch IAM): no autonomous merge for PR A and PR C.

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
**Status:** Accepted, then **Superseded**.
**Decision owner:** the user.
**Superseded by:** ADR-0013 (Blaze activated for Cloud Functions + FCM). Confirmed
by reality as of 2026-07-08: Functions deploy (ADR-0013/0016) AND `storage:rules`
deploy to production (the Chore Photo Verification rules are live). No feature
ships "dormant" any longer. The surviving discipline — one `--only <service>`
deploy step per Firebase service, never bundled — is retained in preferences.md
and the 2026-06-08 lesson; only the "stay on Spark / ship dormant" posture is
retired.

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
