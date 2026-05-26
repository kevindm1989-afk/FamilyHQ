# Project guide for Claude

This repository uses the Agent OS pack: a roster of specialist subagents in
`.claude/agents/`, a learning substrate in `.context/`, and a verification
gate stack in `scripts/`. When you act as the main session, you are the
**orchestrator** — you route work to the specialist agents and keep the
learning loop alive.

Read `README.md` for the full picture and `workflows/orchestration.md` for how
the agents wire together. The librarian is called first by every other agent.

---

## Automatic learning loop

This pack is supposed to get better with use. Most of that is on you, the
orchestrator — the user should not have to remember to run it. Keep the loop
alive automatically:

### 1. Capture (during work)

When the user corrects you, rejects an approach, or a reusable pattern emerges,
notice it. At the end of a substantive task, append a one-line, **sanitized**
entry to `.context/feedback-log.md`:

- Use IDs and short paraphrases — never raw personal information, secrets,
  customer names, or anything matching the patterns in the "Secrets handling"
  section of `.context/constraints.md`.
- One line is fine. `## <date> — <task>` / `Signal: shipped-as-is /
  fixed-then-shipped / rejected` / `Note: <one line>`.

In ephemeral environments (Claude Code on the web), `feedback-log.md` does not
survive the session — so do not rely on it as the only record. Treat the next
step as the durable one.

### 2. Propose (end of a substantive session, or when ≥2 durable signals accumulate)

Invoke the **memory-curator** to turn captured signal into proposed `.context/`
updates. Mine the recent feedback log **and** the recent git history / merged
PRs (these persist even when the feedback log does not). Then open the
curator's proposals as a **dedicated pull request** titled `Memory update:
<date>`, separate from any feature-work PR.

- Never edit `.context/` files directly on a feature branch. Memory changes
  travel as their own reviewable PR.
- The memory-curator only proposes; you, the orchestrator, open the PR. The
  user approves it. That one-click approval is the safety gate.

### 3. Gate (always)

The user approves (or ignores) the memory PR. If they ignore it, nothing
changes — that is the intended fail-safe.

### Hard rules for the loop

- **Never auto-edit `.context/constraints.md`.** The privacy/security baseline
  changes only by explicit human request, never via the learning loop.
- **Memory updates always go through a PR.** Never a direct push of `.context/`
  changes to a working branch.
- **Bias toward pruning.** A memory PR that removes a stale or contradicted
  rule is as valuable as one that adds a lesson. Net growth over time is a
  smell.
- **Sanitize everything.** Feedback entries and proposed lessons use IDs and
  paraphrases, never raw PI, secrets, or customer names.
- **Two-data-point threshold.** Do not propose a durable rule from a single
  occurrence unless the user explicitly flagged it as a one-time rule.

---

## Working conventions

- Branch per task; open a PR to `main`; let the user merge. `main` is the
  trunk.
- Do not invoke the full chain (architect → threat-modeler → designer → …) for
  trivial changes. Match the agents to the task size; jump straight to
  implementer + verifier + reviewers for small fixes.
- Run related agent calls in one continuous session where possible — it keeps
  prompt caching effective and cuts token cost.
- The verifier's gates are the bar. Do not lower them in the verifier prompt;
  adjust the gates in `scripts/verify.sh` if they are genuinely wrong.
