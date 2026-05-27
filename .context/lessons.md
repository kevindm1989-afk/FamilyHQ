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
