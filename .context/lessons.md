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
