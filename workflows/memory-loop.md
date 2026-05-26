# The learning loop

How the pack improves with use. The goal: **agents avoid repeating mistakes
without you having to remember to do anything.** The honest caveat: model
weights never change — what improves is the `.context/` substrate the librarian
feeds every agent. Richer, well-pruned context → fewer repeated corrections,
more consistent output.

There are two layers. The first runs whenever you use the pack. The second is
an optional always-on backstop for when you are not in a session.

---

## Layer 1 — In-session (automatic, no setup)

This is wired into `CLAUDE.md`, so it is active in every session:

1. **Capture** — as you work, the orchestrator notes corrections you make and
   patterns that emerge, and appends sanitized one-liners to
   `.context/feedback-log.md`.
2. **Propose** — at the end of a substantive session (or once a couple of
   durable signals accumulate), the orchestrator invokes the **memory-curator**
   and opens a dedicated `Memory update: <date>` pull request with proposed
   `.context/` changes.
3. **Gate** — you approve the PR in one click, or ignore it. Ignoring it changes
   nothing. Approving it makes every future agent a little sharper.

That is the whole "learns by itself by using it" mechanism. Because you already
review PRs as part of normal work, the only new thing is an occasional memory
PR in the queue.

### Why a PR and not a direct write?

The memory PR is the safety gate. Auto-applying lessons risks three failure
modes: baking in a one-off fluke as a permanent rule, softening your
privacy/security constraints, and context bloat that makes the librarian
surface stale rules (which makes agents *worse*). A one-click PR review costs
seconds and prevents all three. `constraints.md` is never touched by the loop
at all — it changes only by explicit human request.

---

## Layer 2 — Scheduled backstop (optional, one-time setup)

For learning that happens even when you are not actively working, run the
memory-curator on a schedule. Two ways, depending on where you run Claude Code:

### Option A — Claude Code on the web (recommended if that is where you work)

Set up a **scheduled trigger** in your Claude Code web environment that runs,
weekly:

```
Run the memory-curator over the last 7 days of merged PRs and commit history.
Open a "Memory update: <date>" PR with its proposals. Do not touch
constraints.md.
```

This reuses the environment you already have — no API keys to manage, no extra
cost surface beyond the run itself. See
https://code.claude.com/docs/en/claude-code-on-the-web for trigger setup.

### Option B — GitHub Action (for self-hosted / CI-driven setups)

Add a weekly workflow that runs the memory-curator and opens a PR. This needs
an `ANTHROPIC_API_KEY` (or Claude Code OAuth token) in repository secrets, and
will incur a small weekly cost for the run. Because the feedback log is
gitignored (and absent in a fresh CI checkout), the scheduled curator works
from **git history and merged PRs**, which persist — not from the feedback log.

A starter workflow lives at `.github/workflows/memory-curator.yml.example`.
Copy it to `memory-curator.yml`, add the secret, and adjust the cron.

---

## Keeping the loop healthy

- **Approve memory PRs promptly-ish.** A backlog of unmerged memory PRs means
  the same lessons keep getting re-proposed.
- **Prune as much as you add.** The memory-curator biases toward net reduction;
  back it up by actually merging the pruning proposals, not just the additions.
- **Watch for the loop going quiet.** If weeks pass with no memory PRs, either
  you are not using the pack on substantive work, or the orchestrator is not
  capturing — check that `CLAUDE.md` is present and being read.
- **Measure occasionally** (see `workflows/weekly-review.md`): first-pass
  acceptance rate should rise, repeated corrections should fall. If they are
  flat after a couple of months, the `.context/` files are probably bloated or
  stale — audit and prune.
