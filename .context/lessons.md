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
