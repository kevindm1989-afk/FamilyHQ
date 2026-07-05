# Lessons

Things we learned the hard way. Read this before starting anything risky.

Append newest on top. Be specific — vague lessons don't prevent anything.

---

## Format

```
## YYYY-MM-DD — One-line summary

**Symptom:** what we noticed.
**Root cause:** what was actually wrong (not just the surface bug).
**Fix:** what we did.
**Prevention:** the rule we'll follow next time to avoid this class of issue.
```

---

## Entries

## 2026-07-05 — A red security-scan gate on code you didn't touch is usually scanner DRIFT (full-history scan or live-fetched ruleset), not a regression — triage as tooling, suppress the specific reviewed finding, keep the rule live

**Symptom:** Two scheduled security-scan failures on PRs that changed nothing relevant to the finding.
  1. The scheduled secret-scan job red-failed with 4 gitleaks findings while push-triggered runs on the SAME code passed. `gitleaks detect --all` scans the FULL git history, so two dummy e2e passwords (already replaced in the working tree by a runtime `ephemeralCredential()` helper) plus an npm-script string flagged as `generic-api-key` still surfaced from OLD commits. Push runs scan only the delta, so they were clean; the full-history scheduled run was not.
  2. The `semgrep --config auto` gate pulled a NEWER registry ruleset that had added `github-actions-mutable-action-tag`, which flagged every `uses: <action>@vN` mutable tag across three workflow files nobody had edited — 24 findings, red-failing every open PR and `main` at once.

**Root cause:** Scanners that (a) scan the full git history or (b) fetch their ruleset live at run time are TIME- and HISTORY-sensitive. A finding can appear with zero change to the reviewed diff — an old commit re-surfaces (history scan) or the upstream ruleset gained a rule (live fetch). The signal is real for the tool but is NOT a regression in the PR under test.

**Fix:**
  - Secret scan — added a documented `.gitleaksignore` keyed by `<sha>:<file>:<rule-id>:<line>` FINGERPRINTS for the four reviewed-and-confirmed-benign findings. Anything not fingerprinted still fails the gate on the full default ruleset. No source change.
  - SAST — added a bare `# nosemgrep <reason>` inline on each reviewed line, keeping the rule ACTIVE so a future NEW mutable tag still flags, split by rationale (`GitHub-owned first-party action; mutable tag accepted` vs `TODO(pin-sha): pin to a 40-char commit SHA`). No source change.

**Prevention:**
  - When a scan gate red-fails a PR whose diff doesn't touch the flagged code, FIRST suspect tooling drift: is the scan full-history (gitleaks `--all`) or live-ruleset (`semgrep --config auto`)? A split verdict between a push-triggered and a scheduled run on identical code is the tell.
  - Suppress the SPECIFIC reviewed finding via the tool's documented narrow mechanism (`.gitleaksignore` fingerprints; inline `# nosemgrep`), never by disabling the rule globally or loosening the gate — that keeps the `constraints.md` "static analysis on every PR" floor intact and keeps the rule live for the next real hit.
  - Prefer a BARE `# nosemgrep <reason>` over the `:`-scoped `# nosemgrep: <rule-id>` form when you cannot verify the exact registry rule-id offline (the sandbox egress proxy blocks the registry). The scoped form silently no-ops if the id is wrong.
  - For CI determinism, consider pinning the ruleset version (and third-party action SHAs) so an upstream change can't red-fail unrelated PRs. SANDBOX CAVEAT: the egress proxy blocks third-party GitHub repos, so third-party action SHAs could not be verified and were left as `TODO(pin-sha)` markers — do NOT hardcode an unverified SHA into a deploy pipeline; defer with a tracked TODO.
  - Sibling: the 2026-05-27 "vendored/reference code excluded from quality gates" lesson is the SCOPE version of this; this one is the TEMPORAL version. Both are "the scanner flagged non-shipping / non-regressed code."

## 2026-06-22 — When a screen has its own copy of a converter (formatMoney, parseDate, etc.), tests written with display-typed fixtures cannot catch a unit-mismatch bug — both halves agree and the wrong value renders

**Symptom:** An allowance value persisted as the integer 800 (eight dollars in cents, per ADR-0009) rendered as "$800.00" on the kid-side chore list and the kid-side allowance balance chip. The parent-side equivalent rendered "$8.00" correctly. The component-level test suite for the kid screen was green.

**Root cause:** Two unrelated failures lined up to mask each other.
  1. The kid screen had a LOCAL `formatMoney` stub that treated its input as dollars (no `/100`), while the canonical `formatMoney` in the chores parent service divided by 100 per ADR-0009. Duplicate converters drift on their unit assumption; the local stub existed because importing the shared one "felt heavier" than re-deriving four lines.
  2. The kid-screen tests passed fixtures in DISPLAY units (e.g. `allowanceBalance: 38.5`, `dollarValue: 3`) and asserted the buggy formatter's 1:1 output ("$38.50", "$3.00"). Each half was wrong in the same direction, so the assertion succeeded against the broken code and would have FAILED against the correct code — the test was pinning the bug, not the spec.

**Fix:** Corrected the local formatter to divide cents by 100 (matching ADR-0009 and the parent-side canonical), rewrote the kid-screen fixtures in storage units (cents — 3850, 300, 500, 800, 80000), and added two REGRESSION-PIN assertions for the load-bearing case: `expect(getByText('$8.00')).toBeInTheDocument()` AND `expect(queryByText('$800.00')).not.toBeInTheDocument()`. The negative assertion is what prevents the next refactor from silently reintroducing the 100× drift — a single positive assertion can be satisfied by partial matches in surprisingly slippery ways (e.g. "$8.00" is a substring of "$800.00" depending on the matcher).

**Prevention (three rules, one cause):**
  - **Test fixtures use the STORAGE convention, never the display convention.** Per ADR-0009, money is integer cents at the storage and rules layer; every new fixture touching `allowanceBalance` / `dollarValue` / `costCents` / `amount` starts from cents. If your fixture reads naturally (`balance: 38.5`), you are testing the formatter against itself.
  - **One canonical converter per unit boundary; treat local stubs as a code smell.** The duplicate-formatter pattern is how unit conventions drift between screens. When adding a money/date/byte/duration display in a new screen, import the shared helper; if no shared helper exists, extract one in the same PR. Worth occasionally grepping for `function formatMoney|const formatMoney` to catch new stubs early.
  - **Regression-pin a magnitude bug from both directions.** When the symptom is an off-by-100× (or off-by-1000×, off-by-3600×) error, assert both that the correct value IS rendered AND that the wrong value is NOT. The negative assertion is the gate against the same drift re-entering.

**Known follow-up, NOT a rule yet (single observation):** the parent-side formatter uses `en-US`/`USD` while the kid-side uses `en-CA`/`CAD`, so the parent sees "$8.00" and the kid sees "8,00 $". UX inconsistency, not a correctness bug; flagged for a future locale-consolidation PR. Do not generalize to a rule on one occurrence.

## 2026-06-19 — Reproduce Firestore rule rejections in the emulator FIRST; one targeted rules test beats four PRs of guessing

**Symptom:** A push-preferences write failed silently on one device — the device row appeared then vanished and the master toggle flipped back to OFF. Diagnosed across four PRs (App Check dropped on the `fcmTokens` rule, App Check dropped on seven callables, `familyId` added to the merge payload, then the actual fix). The first three addressed real-but-non-load-bearing issues; only the last stopped the symptom.

**Root cause:** Without an emulator reproduction, every PR was a hypothesis aimed at a class of failure (attestation, payload shape, region) rather than a confirmed rule line. Cloud Logging did not surface the rule denial (Firestore audit logging is off by default). The Firebase Console Rules Playground was not reliably reachable on the device under test. So each "fix" shipped, the symptom persisted, and we learned only by exclusion.

**Fix:** Wrote a four-case rules test against the emulator that ran the EXACT client write under the EXACT auth context: (A) doc exists + prefs-only merge → ALLOW, (B) doc exists + familyId+prefs merge → ALLOW, (C) doc missing + prefs merge → DENY at the line the rule cited in PERMISSION_DENIED, (D) bootstrap `{email, familyId}` then merge → ALLOW. The single failing case (C) immediately named the root cause — `setDoc(merge:true)` on a missing doc is a CREATE, gated by the create-rule's exact-shape constraint.

**Prevention:** When a Firestore write fails on a real device with an unclear rule line, the FIRST step is `npx firebase emulators:exec --only firestore "npx vitest run --config vitest.rules.config.ts <file>"` with a tiny test that mirrors the production client call (same auth uid, same path, same payload). The denied-line number falls out of the PERMISSION_DENIED message; no further guessing. Console Rules Playground is the secondary option (when reachable); enabling Firestore audit logging is the last-resort observability move, not the diagnostic ladder's first rung. See `test/rules/userprivate-notification-prefs.test.ts` for the template.

## 2026-06-19 — Founding-parent and invite-acceptance bootstrap paths must stay symmetric; check both when extending the multi-doc signup batch

**Symptom:** An established invited member could not save notification preferences. Every preferences merge into `userPrivate/{uid}` was rejected. Founding parents had no such issue.

**Root cause:** `authService.signUpFoundingParent` writes THREE docs atomically (`families/{newId}`, `users/{uid}`, `userPrivate/{uid}` with `{email, familyId}`). `inviteService.acceptInvite` was writing only TWO (`users/{uid}`, `invites/{id}` status). The `userPrivate` doc was never created for invited members. This was flagged as INFORMATIONAL in an earlier security review — turned out to be load-bearing the moment an invited member opened the notifications screen.

**Fix:** `inviteService.acceptInvite` now writes `userPrivate/{uid}` with `{email, familyId}` in the SAME atomic batch — full parity with the founding-parent path. Added a self-heal in `NotificationsRoute.tsx` so members accepted BEFORE the fix auto-bootstrap on their next preferences write.

**Prevention:** When extending the founding-parent bootstrap batch (a new doc, a new field, a new collection touched at signup), mirror the change in `inviteService.acceptInvite` in the same PR. The two paths are siblings, not variants — any asymmetry is a latent rules-denial waiting for the first invited member to hit it. A test asserting shape parity (same doc paths, same field keys per path, modulo `role` and `inviteId`) would prevent regression; see `inviteService.test.ts` for the batch-shape-assertion pattern.

## 2026-06-19 — `setDoc(merge:true)` on a MISSING doc is a CREATE, subject to the CREATE rule's shape constraint

**Symptom:** A merge write to `userPrivate/{uid}` carrying `{notificationPreferences: {...}}` was denied by the create rule whose `request.resource.data.keys().hasOnly(['email','familyId'])` predicate did not accept the merged shape. Confusion arose because the SDK call was `setDoc(ref, payload, { merge: true })` — read as an UPDATE shape.

**Root cause:** Firestore evaluates the operation against the existence of the doc. If the doc does not exist, `setDoc(merge:true)` is a CREATE, gated by the `allow create` predicate — including any `hasOnly([...])` shape lock. The merge flag changes what the SDK sends (partial vs full) but NOT which rule predicate runs.

**Fix:** Ensure the doc exists first (bootstrap with the create-allowed shape), then perform the merge as an UPDATE. The self-heal pattern at `src/features/notifications/NotificationsRoute.tsx` is the canonical implementation: detect the missing doc via the live snapshot, write `{email, familyId}` to satisfy the create rule, then issue the preferences merge.

**Prevention:** When designing a collection whose create rule uses `keys().hasOnly([...])`, EITHER (a) guarantee the doc always exists before any merge write (via the founding bootstrap + invite-symmetric bootstrap — see previous lesson), OR (b) write the create rule to accept the union of `{create-shape} | {future-merge-shape}`. The "only the bootstrap shape on create" choice traded ergonomics for tight rules — that trade is correct, but the symmetry guarantee from the previous lesson is the load-bearing precondition.

## 2026-06-19 — Firebase JS `getFunctions()` defaults to `us-central1`; always pass the deployment region explicitly

**Symptom:** Every push-callable invocation since PR D had been silently 404'ing. Server-side logs showed zero invocations of the seven notify callables; client-side, the fire-and-forget `try/catch` (per ADR-0014) was swallowing the network error so the SPA gave no signal.

**Root cause:** Client called `getFunctions(app)` with no region. The Firebase JS SDK defaults to `us-central1`. The functions are deployed to `northamerica-northeast1` (per ADR-0013). Requests resolved to a non-existent regional endpoint. By design (ADR-0014) the callers do not surface the failure; by design (ADR-0013) there is nothing to surface in Cloud Logging because the function never ran.

**Fix:** Pass region explicitly via a shared constant module that has zero Firebase SDK dependencies, so the five callsites (`boardService`, `choresParentService`, `choresMemberService`, `todosService`, `wishlistService`) import the constant without dragging the SDK into their test sandboxes. See `src/firebase/functions-region.ts` and its docblock.

**Prevention:** Every `getFunctions()` call passes `FUNCTIONS_REGION` as the second arg: `getFunctions(undefined, FUNCTIONS_REGION)`. The constant lives in its own zero-firebase-dependency module so the test sandboxes for client services do not need an `import.meta.env` shim for an unrelated dependency. When the deploy region for `functions/` changes, that constant is the single update point — the deployed `region:` value on every `onCall` is its server twin and must move together.

## 2026-06-19 — Fire-and-forget callable invocations (ADR-0014) require server-side observability; client toasts are explicitly not the diagnostic path

**Symptom:** Four hours of debugging because the symptom (preferences write failure, region 404, App Check refusal) produced zero client signal AND zero server signal. The SPA's intentional `try/catch` (push is non-essential by design) hides callable failures from the operator.

**Root cause:** ADR-0014's fire-and-forget pattern is correct for UX (a notification that didn't fire should not block the user's action) but creates a diagnostic blind spot when something IS wrong. The trade-off favors user experience over operator visibility — and that trade is correct — but the mitigation has to live server-side, not client-side.

**Fix:** No code change (the trade-off is intentional). Mitigation is documentation + the diagnostic ladder: emulator reproduction (definitive), Rules Playground (when reachable), Cloud Logging only if Firestore audit logging is explicitly enabled.

**Prevention:** When ADR-0014's callsite pattern is touched, do NOT add error toasts to surface push failures to the user. When debugging a "push isn't working" report, do NOT start at the client (there's nothing to see) — start at the server function logs; if logs are empty, suspect a transport failure (region mismatch, App Check, network) before suspecting a code bug. Update operator runbooks to include "verify the function was actually invoked (Cloud Logging) before debugging anything else."

## 2026-06-19 — Operator config drift (a TTL added via Firebase Console) breaks subsequent non-interactive `firebase deploy` runs; mirror the override into `firestore.indexes.json` BEFORE the next deploy

**Symptom:** A deploy was needed unexpectedly: the next deploy after the PR F operator setup refused to proceed in non-interactive mode because the live project's `scheduledSends.expiresAt` TTL (added via Firebase Console during PR F's operator gate steps) was not present in `firestore.indexes.json`, so the deploy detected drift it would not auto-reconcile without prompting.

**Root cause:** Console-applied field overrides (TTL policies, single-field index exemptions) are real Firestore configuration but live OUTSIDE the repo's deploy artifact. The next `firebase deploy --only firestore` sees the discrepancy as drift and prompts; in CI / non-interactive mode that prompt is a failure.

**Fix:** Mirrored the TTL field override into `firestore.indexes.json`. Now the repo IS the source of truth and the next deploy is no-op-clean.

**Prevention:** Any operator action that mutates Firestore field overrides via the Console (TTL enable, single-field exemption, etc.) is followed in the SAME merge train by a PR that adds the equivalent entry to `firestore.indexes.json`. The operator runbook step for "enable TTL on `<collection>.<field>`" gains a sibling step "open a one-line PR mirroring the TTL into `firestore.indexes.json`". Otherwise the next `firebase deploy` is the broken signal.

## 2026-06-16 — Server-trigger feature: first deploy will fail four times in a predictable cascade — bundle the operator gates into the design doc

**Symptom:** PR F (scheduled push) needed four separate deploy attempts after merge, each surfacing a different operator-side gate that the deploy SA couldn't bootstrap on its own:

1. `npm --prefix functions run build` (tsc) failed on `retryConfig: { retryCount: 0 }` — firebase-functions v2's `ScheduleOptions` exposes `retryCount` FLAT, not nested. The local vitest mock for `firebase-functions/v2/scheduler` accepts any options shape, so the type error only surfaced in CI's tsc pass (not in the SPA verifier's `tsc` pass — that one only covers `src/**`).
2. `Permissions denied enabling cloudscheduler.googleapis.com` — the `onSchedule` v2 codepath needs the Cloud Scheduler API enabled on the project before the FIRST deploy that uses a scheduled function. The deploy SA lacks `serviceusage.services.enable`, so a project owner must enable it via the Console or `gcloud services enable`.
3. (Same as #2 for `pubsub.googleapis.com`.) `onSchedule` v2 lazily provisions Pub/Sub for the scheduler→function plumbing.
4. `cloudscheduler.jobs.update HTTP 403` — even with the API enabled, the deploy SA needs `roles/cloudscheduler.admin` (or the narrower `jobsEditor`) on the project to create the Cloud Scheduler job rows. The kill-switch in PR A used Pub/Sub (not scheduler), so this role was never granted; PR F is the first need.

**Root cause:** the architect's design doc named the trigger architecture but did not enumerate the OPERATOR gates required to land it on a fresh project. The threat-modeler's M45 acceptance asked for the runbook commands but not the preconditions. So every gate surfaced as a deploy failure rather than a pre-deploy checklist.

**Fix (this PR D run):** added a §0 "Operator prerequisites" section to `docs/runbooks/observability.md` listing the four gates with their gcloud commands. Next operator follows that checklist before the first scheduled-function deploy and the cascade is one step instead of four iterations.

**Prevention:** When a feature adds a NEW Google Cloud product to the deploy surface (Cloud Scheduler, Cloud Storage, Cloud Tasks, BigQuery, Vertex AI, etc.), the architect's design doc MUST include an "Operator prerequisites" subsection with:
  - APIs to enable (`gcloud services enable <api>` lines).
  - IAM roles the deploy SA needs (with the precise `roles/*` strings).
  - Any one-time resource bootstrapping (Pub/Sub topics, Cloud Scheduler jobs that aren't auto-created, etc.).
  - Verification commands the operator runs to confirm each gate before triggering CI.

The threat-modeler then references this section in the relevant M-mitigation (M45-analog "positive invoker pin" had the right shape — extend the same pattern to API + IAM gates).

Corollary precedent: PR A's kill-switch had the same cascade (9 APIs + 4 actAs bindings + 3 service-agent bindings + 2 run.invoker bindings + 1 tokenCreator). That work eventually landed in `docs/runbooks/billing-killswitch.md` §0a-§0e. PR F should have looked at that pattern and applied it to Cloud Scheduler from the start.

## 2026-06-11 — When orchestrating a fan-out brief, paraphrasing the spec is how spec divergence enters the codebase — cite design + threat-model lines verbatim

**Symptom:** PR D shipped `notifyTodoCreated` / `notifyTodoCompleted`
as SINGLE-recipient callables (assignee for created, creator for
completed). Design D6/D7 (push-notifications-design.md:576-592) AND
threat-model D-T4 (threat-model.md:980) explicitly specify these as
BROADCAST-to-family-except-actor. The test-writer agent wrote the
exact tests my brief asked for; the implementer agent wrote the exact
callables those tests pinned. Both agents faithfully followed my
brief — and the brief silently diverged from the spec.

**Root cause:** I paraphrased the design in the test-writer brief
("recipient = assignee", "recipient = creator") instead of quoting
the design line verbatim ("Recipients = every active member of the
family EXCEPT the creator/completer"). The agents had no way to
catch the drift because they were briefed off my paraphrase, not the
source.

**Fix:** Restructured both callables to mirror `notifyBoardPost`
(family-member query, exclude actor, aggregate tokens, ONE multicast).
Updated body strings to design-exact wording. Updated tests to
broadcast happy paths. Caught by second-opinion-reviewer; would have
shipped silently otherwise.

**Prevention:** When briefing a fan-out agent (test-writer,
implementer) on something that mirrors a design or threat-model
acceptance criterion, **quote the criterion verbatim** in the brief
— path + line number + literal acceptance text. Do not paraphrase
"recipients are X" or "category is Y" from memory; copy the bullet.
The orchestrator's job is to translate intent into work, not to be a
lossy compression layer over the spec. Corollary: every spec
divergence flagged by second-opinion is a brief defect, not an agent
defect — score the brief's fidelity against the spec, not the
output's fidelity against the brief.

## 2026-06-11 — A discriminable `reason` on a callable response leaks recipient preference state — drop it from the response, keep it in the server log

**Symptom:** PR D shipped six new notify-callables that inherited PR C's
M39 skip-shape `{ sent: 0, reason: 'opted_out' | 'no_tokens' |
'send_failed' }`. Privacy-reviewer found that a caller can flip a
recipient's `notificationPreferences.<category>` toggle and observe
whether the response `reason` flips from `'opted_out'` to `'no_tokens'`,
exfiltrating aggregate preference state of OTHER family members. For
multi-recipient kinds (board-post, chore-submitted, wishlist-requested)
this leaks aggregate family state; for single-recipient kinds
(chore-approved, wishlist-resolved) it leaks the specific recipient's
opt-in state — most acute when the recipient is a child (Quebec Law 25
sensitive-info baseline).

**Root cause (the seam):** the `reason` field had operational value only
in dev / ops debugging, but it lived on the public response. The
fire-and-forget client (per ADR-0014) never consumes it. The
discriminator's existence on the response was the disclosure
mechanism, not its value — even if a sophisticated caller never
looks at it, the distinguishability is the oracle.

**Fix:** dropped `reason` from the response across all 7 notify-
callables. Every skip / FCM-throw branch now returns
`{ sent: 0, cleaned: 0 }`. The reason classification is preserved
server-side via a new M38 allow-listed log field `skipReason`. The
SPA's TypeScript response annotations narrowed from
`{ sent; cleaned?; reason? }` to `{ sent; cleaned }`. Threat-model
T5.6b documents the new constraint; ADR-0015 records the change.

**Prevention:** When a Cloud Function's response carries a
discriminator field, ask BEFORE shipping: "what about the recipient
could the caller infer by toggling something and watching the
discriminator?" If anything sensitive (preference state, doc
existence, role) discriminates the branches, push the discrimination
into a server-only log field. The response shape gets the union
collapse; ops debugging gets the field. The privacy reviewer is the
right person to pin this — always loop them in on any callable
response that has more than one shape.

## 2026-06-09 — Widening a discriminated union beats splitting collections; defer the field rename, document the alias

**Symptom:** The wishlist redemption feature needed to add a
"spending" row to the existing `transactions` collection (until
then, only chore-approval "earning" rows). Two options surfaced:
(a) split into `earnings` + `spending` collections, or (b) widen
`TransactionType` from `'earning'` to `'earning' | 'spending'`
and reuse the same doc shape. We chose (b). A second sub-choice
was whether to rename the now-misleading `choreId` / `choreTitle`
fields (they hold a `wishlistItemId` / `wishlistTitle` on a
spending row) to `sourceId` / `sourceLabel` immediately.
**Root cause (the seam):** renaming a REQUIRED field on a
collection with live readers (dashboard widget, allowance history,
multiple selectors) is a coordinated rename across types, the
firestore.rules predicate `txnCreateHardened`, every consumer, AND
existing in-cache documents. The widening alone is non-breaking;
the rename is breaking.
**Fix:** Widened the union (`src/lib/types.ts:21`); reused
`choreId` / `choreTitle` as "source identity + display label" with
a documenting doc-comment on the `Transaction` interface
(`types.ts:159-188`); flagged the rename as a follow-up; left
existing 'earning' readers untouched. Wishlist approve writes
`choreId: itemId, choreTitle: item.title, type: 'spending'`
(`wishlistService.ts:273-282`).
**Prevention:** When extending a discriminated union over an
existing live collection, prefer widening + a documented alias
to splitting + migrating. Capture the deferred rename as an
explicit follow-up in the same PR's doc-comment so the next agent
doesn't think the field name is precise. The rename itself is
its own PR (one atomic touch across types, rules, readers,
fixtures) — never bundled with the feature that exposed the
mismatch.

## 2026-06-08 — Deploy steps that mix tier-gated services with always-on services create a billing-plan trap

**Symptom:** The Spark-tier project's deploy started failing on every
push because `npx firebase deploy --only firestore:rules,firestore:indexes,storage:rules`
bundled Storage with Firestore. Storage requires Blaze (billing plan
upgrade) to initialize; the deploy step couldn't ship Firestore changes
without also shipping Storage rules. PRs blocked until an out-of-band
infra fix (PR #84) split the deploy.
**Root cause:** A multi-service single `--only` flag couples
billing-plan-gated services (Storage, Cloud Functions, Scheduler) to
always-on ones (Firestore, Hosting). Adding the gated service later
"just to keep the deploy tidy" creates a trap: the next change to the
shared step requires the gated tier to be enabled, even if nothing in
the PR actually needs it.
**Fix:** Split the deploy step per service:
`npx firebase deploy --only firestore:rules,firestore:indexes` and a
SEPARATE step (currently commented out) for Storage / Functions, each
flag-gated.
**Prevention:** In `deploy.yml`, every Firebase service gets its own
`--only <service>` invocation and can be independently disabled.
Adding a new tier-gated service is its own deploy step + an explicit
flag; never bundle it with always-on services from day one.

## 2026-06-08 — Shared UI primitives must forward documented a11y props; verify with a primitive-level test, not only in callers

**Symptom:** `SavingsGoalsScreen` had been passing
`aria-label={t('savings.action.deleteLabel', { title: goal.title })}`
to `<Button>` for months — for screen-reader uniqueness across a row
of identical "Delete" buttons. The prop was silently dropped because
the `Button` primitive's `ButtonProps` type didn't declare it. The
caller's tests passed (they queried by visible text); a real screen
reader heard "Delete, Delete, Delete" with no row context.
**Root cause:** When a shared primitive receives a prop it doesn't
declare, React passes it through to the DOM only if the underlying
element accepts it directly. `<Button>` rendered a `<button>` from a
manually-constructed `JSX.Element` and never spread the rest of its
props, so `aria-label` vanished.
**Fix:** Added `'aria-label'?: string` to `ButtonProps`, read it
explicitly, and applied it to the underlying `<button>` (PR #82).
**Prevention:** Every documented prop on a shared primitive needs a
PRIMITIVE-LEVEL test that asserts it reaches the DOM. Do not assume a
primitive honors a documented prop because a caller passes it — grep
the primitive's implementation. Caller tests that query by visible
text can mask a missing accessible name; primitive tests query by
`role` + `name` (which IS `aria-label` when present).

## 2026-05-28 — Day-bucketing must use ONE local-day basis on BOTH sides; an ISO substring is UTC

**Symptom:** Three separate features (allowance history grouping, dashboard
upcoming-events filter, calendar) each independently mis-bucketed dates: an
evening earning grouped under the next UTC day instead of the viewer's local
day; an event dated today disappeared from "upcoming" after UTC rolled over.
Each landed green in tests until a non-UTC `TZ` was set.
**Root cause:** Two bases mixed in one comparison: `iso.slice(0,10)` /
`new Date('YYYY-MM-DD').toISOString().slice(0,10)` is the UTC day; `Date.now()`
formatted for display is the LOCAL day. A bare `YYYY-MM-DD` parsed with
`new Date(...)` is UTC midnight — in a UTC-behind zone it shifts a day back.
Date-only fixtures hid all of this until tests ran under
`process.env.TZ='America/Los_Angeles'`.
**Fix:** Reduce both sides to a local `YYYY-MM-DD` via the date PARTS
(`getFullYear/getMonth/getDate`); for a bare `YYYY-MM-DD` input, build via
`new Date(year, month-1, day)` (LOCAL), not `new Date('YYYY-MM-DD')`. Run
TZ-sensitive tests under a non-UTC TZ.
**Prevention:** When comparing two dates by day, derive BOTH from the same
basis via local parts. Never `iso.slice(0,10)` for "today"; never
`new Date('YYYY-MM-DD')` for a local-day input. TZ-sensitive tests run under
a non-UTC TZ. The shared helper `localDayKey(ms)` + `eventLocalDay(iso)`
in `src/lib/dates.ts` is the one-and-only basis — every new feature reuses
it instead of re-deriving day comparisons inline.

## 2026-05-28 — Snapshot-dedupe signatures for feed hooks must include rendered FIELD values, not just doc ids

**Symptom:** `useAllFamilyMembers` was cloned from `useFamilyChores`'s
`docs.map(d => d.id).join(',')` signature. After a parent renamed or
(de)activated a member, the service write succeeded (toast fired) but the
list silently failed to re-render — the id set was unchanged, so the dedupe
short-circuited and dropped the snapshot.
**Root cause:** `useFamilyChores` only LOOKED correct: chore writes happen to
also mutate `createdAt`, which forces a different doc-content-driven re-fire,
which the listener delivers; the id-only signature was never the actual
dedupe gate. For `users`, a rename / `isActive` flip does NOT mutate any
field the id-only signature observed — so a redundant re-fire and a genuine
update became indistinguishable.
**Fix:** Sign the snapshot by `id + every field the screen reads`
(`name, role, isActive, familyId, allowanceBalance`) — same `id:f1:f2:…`
shape, joined per doc, joined across docs. An identical re-fire still
dedupes; any mutation forces a re-apply.
**Prevention:** A snapshot-dedupe signature is a contract over the RENDERED
fields, not over the doc-id set. Before cloning a feed-hook signature into a
new collection, list the fields the new surface reads and bake every one of
them into the signature — including `isActive` (toggles) and any
display-name field (renames). If the source hook's signature looks too thin,
audit whether the source surface only worked by accident (a side-channel
mutation like `createdAt`).

## 2026-05-27 — `assertFails` only matches PERMISSION_DENIED, not app-level transaction aborts

**Symptom:** Allowance-approval abort tests (double-approve, approve-pending,
approve-already-approved, approve-rejected) initially wrapped the test's own
`runApproval` — whose status guard throws a plain `Error('chore-not-complete')`
and aborts the transaction — in `assertFails(...)`. `assertFails`
(`@firebase/rules-unit-testing`) resolves only on a rules `PERMISSION_DENIED`,
so an app-level thrown abort does not satisfy it.
**Root cause:** Two different failure mechanisms were conflated: a rules denial
(server-side, PERMISSION_DENIED) vs an application-layer transaction abort (a
thrown Error inside `runTransaction`). They need different assertions.
**Fix:** Assert app-level aborts with `.rejects.toThrow('chore-not-complete')`
PLUS side-effect checks (balance unchanged, no ledger doc), and reserve
`assertFails` for genuine rules denials (cross-family, self-approve, deactivated).
**Prevention:** When testing a client `runTransaction`, decide per case which
layer enforces the guarantee. Rules denial -> `assertFails`. App-level guard /
thrown abort -> `.rejects.toThrow(...)` + assert no side effects landed. Never
use `assertFails` for a thrown Error.

## 2026-05-27 — Component tests asserting a formatted value need DISTINCT fixture values per surface

**Symptom:** A ChoresParent "money precision" test used a member balance equal to
a chore reward, so once both surfaces rendered money, `getByText(/\$1\.00/)`
matched two nodes and failed. The same class also bites money-vs-points: a chore
`pointValue` of `1` can satisfy a `/\$1\.00/`-shaped matcher if the values aren't
kept apart.
**Root cause:** A `getByText` regex matches DOM text content, not a semantic
slot. When two unrelated surfaces (balance chip + chore card; money + points)
render coincidentally-equal text, the matcher can be satisfied by the wrong
element — a false pass or a spurious multiple-match failure.
**Fix:** Gave each surface a deliberately DISTINCT value (e.g. balance $1.00 /
100c vs chore reward $2.50 / 250c; points 10 vs dollars 3) so each matcher can
only resolve to its intended node, and scoped card assertions with `within(card)`.
**Prevention:** In a component test asserting a formatted value, choose fixture
numbers so no two surfaces collide, AND scope to the element (`within(...)`)
rather than a document-wide `getByText`. Distinct fixtures + scoped queries, both.

## 2026-05-27 — Declaring an ARIA composite role obligates the full keyboard contract — reuse the existing helper

**Symptom:** New `role="radiogroup"`/`role="radio"` groups in the chores AddChore
form were initially declared without the roving-tabindex + arrow-key handling the
role requires, even though the calendar `AddEvent` form already had a working
`handleRadioKeys` + `tabIndex={selected ? 0 : -1}` pattern.
**Root cause:** An ARIA composite role (radiogroup, tablist, listbox, etc.) is a
PROMISE of a specific keyboard interaction model (one tab stop, arrow keys move
selection). Declaring the role without the keyboard behaviour is worse than no
role — it lies to assistive tech.
**Fix:** Reused the established pattern: exactly one radio tabbable
(`tabIndex 0`), the rest `-1`, `ArrowRight/Down`/`ArrowLeft/Up` move selection
via the shared `handleRadioKeys` helper shape.
**Prevention:** Before adding any ARIA composite role, find the project's
existing implementation of that role and reuse its keyboard handler. If declaring
a composite role you can't make keyboard-operable, don't declare it.

## 2026-05-27 — Test mocks that always resolve hid a real rejection path

**Symptom:** The cache-clear lifecycle suite passed, but a mock of
`clearIndexedDbPersistence` (and `terminate`) was hardcoded to `Promise.resolve()`,
so the failure path — where a clear/terminate REJECTS on a running client — was
never exercised; the fail-closed contract was unverified.
**Root cause:** Mocking a critical lifecycle dependency only on its happy path
gives false confidence; the dangerous behavior (a swallowed rejection letting a
foreign cache stay readable) lives entirely on the rejection path.
**Fix:** Added tests that make the mocks reject and assert the function PROPAGATES
the rejection and does NOT advance the last-uid marker (fail closed).
**Prevention:** For security/privacy-critical lifecycle code, model the FAILURE
paths in mocks (reject, throw), not just the resolve path — assert the
fail-closed behavior explicitly.

## 2026-05-27 — Adversarial review caught HIGH bugs a green suite + security/privacy reviews missed

**Symptom:** After the security and privacy reviews passed and the test suite was
green, an adversarial pass ("assume the suite is incomplete") found real HIGH
issues: the `userPrivate` create rule was unbounded, the terminated-then-reused
Firestore client, and the non-graceful-session stale-cache leak / fail-closed gap.
**Root cause:** Passing tests prove the cases you thought of; they do not prove
the absence of the cases you didn't. Security-critical isolation code has failure
modes that a feature-shaped suite won't reach.
**Fix:** Bounded the `userPrivate` create, forced a fresh client via reload, added
the startup uid-guard and fail-closed propagation, each with pinning tests.
**Prevention:** For security-critical work, run an adversarial review as the LAST
gate before human review — explicitly assume the green suite is incomplete and
hunt the unmodeled path.

## 2026-05-27 — Vendored/reference code must be excluded from quality gates

**Symptom:** The CI semgrep gate flagged code under `design/handoff/` — a design
reference bundle (its `tweaks-panel.jsx` is explicitly "NOT part of the product")
that we neither ship nor own.
**Root cause:** Reference/vendored code we don't ship was inside the scan scope, so
it gated CI on issues in code that will never run in production.
**Fix:** Added `design/handoff/` to `.semgrepignore` (re-listing the standard
node_modules/dist/build excludes too, since a project ignore file REPLACES
semgrep's built-in defaults). App code under `src/` is still scanned.
**Prevention:** Scope static-analysis gates to code you ship and own; exclude
vendored/reference bundles. Remember a project `.semgrepignore` replaces the
built-in defaults — re-add the standard noise dirs.

## 2026-05-25 — PRs auto-target the repo default branch, not necessarily `main`

**Symptom:** The first feature PR opened in a session merged into a parallel
generated branch (`claude/extract-agent-os-…`) instead of `main`; a later
follow-up PR built on the pre-merge branch tip hit phantom merge conflicts.
**Root cause:** Two compounding facts. (1) The repo's GitHub *default branch*
was a generated `claude/…` branch, not `main`, so any PR opened without an
explicit base auto-targeted the wrong branch. (2) The default-branch PRs were
**squash-merged**, so the original commit was never literally on `main` — a
branch still carrying that commit looked like it had unmerged, conflicting
changes when compared against the squashed trunk.
**Fix:** Re-targeted the work at `main` via a fresh PR; for the follow-up,
branched fresh off the updated `main` and cherry-picked only the new commit;
set the GitHub default branch to `main`.
**Prevention:** Before opening any PR, confirm the repo's default branch and
pass the base explicitly (`--base main` / `base: main`). After a squash-merge,
do not keep building on the old branch — branch fresh off the updated trunk.
