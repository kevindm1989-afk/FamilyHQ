# Quickstart

## Setup (one time, 15 minutes)

### Easiest path — GitHub template + reset script

If the pack lives in a GitHub repo, mark it a **template repository**
(Settings → "Template repository"), then for each new app click **"Use this
template"** to create a fresh repo with all the pack files. In the new repo,
run once from the root:

```
bash templates/new-project-reset.sh
```

That clears the content specific to whatever project the template came from
(its ADRs, patterns, README, and the pack's own meta-docs) while keeping the
transferable layer (agents, scripts, workflows, design tokens, and your
lessons / preferences / constraints baseline). It prints a short to-do list of
the judgment calls it leaves to you — retuning `constraints.md`, filling in the
README, choosing a license. Then jump to step 2 below.

### Manual path — extract a tarball

1. **Extract the pack into your new project's root directory**:
   ```
   mkdir my-new-project
   cd my-new-project
   tar -xzf /path/to/agent-os.tar.gz --strip-components=1
   cp .gitignore.template .gitignore
   git init && git add . && git commit -m "Agent OS scaffold"
   ```
   The `--strip-components=1` flag extracts the pack contents directly into
   the current directory rather than into a nested `agent-os/` subfolder.
   Copying `.gitignore.template` → `.gitignore` **before** the first
   commit keeps secrets, build artifacts, and the (later-seeded) local
   feedback log from ever entering history.

2. **Edit `.context/preferences.md`** — fill in the blanks under code style,
   architecture taste, and risk posture. Be specific. This is the seed every
   agent reads.

3. **Tune `.context/constraints.md`** — remove sections that don't apply
   (Quebec Law 25 only if Quebec users; PHIPA only if health info; etc.).
   Keep PIPEDA — it's federal and always applies for commercial work.

4. **Install Claude Code** if you haven't. The `.claude/agents/` directory
   is already set up. Verify the agents load by running `/agents` in
   Claude Code.

5. **Seed the local feedback log** (gitignored, stays on your machine):
   ```
   cp .context/feedback-log.template.md .context/feedback-log.md
   ```
   The feedback log accumulates raw outcomes from agent runs, which often
   include ticket excerpts, customer names, or incident specifics. The
   pack's `.gitignore.template` keeps this file local; only the curated,
   sanitized output from the weekly review (in `lessons.md`,
   `patterns.md`, `decisions.md`) gets committed.

6. **Make the verify scripts executable**:
   ```
   chmod +x scripts/verify.sh scripts/token-audit.sh
   ```
   `scripts/verify.sh` runs the full gate stack on demand and in CI.
   `scripts/token-audit.sh` is wired into Tier 1 and enforces that UI
   code consumes `design-tokens.json` rather than inventing hex / rgb /
   px values. It auto-skips when no UI source dirs exist, so it's safe
   to leave enabled from day one.

7. **Install verification tools** (as your project takes shape):
   - For Node: `eslint`, `prettier`, `typescript`
   - For Python: `ruff`, `mypy`, `pytest`
   - Cross-language: `semgrep`, `gitleaks` (install via your OS package manager)

---

## Your first project (the prompt → app loop)

1. In Claude Code, give a clear prompt. Example:

   > "Build a small web app where members of my union local can submit
   > hazard reports anonymously. Reports should be visible to JHSC
   > co-chairs only. Hosted in Canada. Mobile-first."

2. Claude (the main session, acting as orchestrator) will:
   - Ask clarifying questions
   - Call the **architect** (discovery → NFRs → design → ADRs → ordered task list)
   - Hand off to the **threat-modeler** (STRIDE per component → testable mitigations)
   - Hand off to the **designer** (discovery → full token set → every component state) which auto-invokes the **accessibility-specialist**
   - Synthesize the plan and ask for your approval **(HUMAN GATE)**

3. After you approve, the orchestrator loops through tasks:
   - **test-writer** writes failing tests with 1:1 AC traceability and state coverage
   - **implementer** makes them pass; runs `token-audit` on its own diff; refuses missing tokens
   - **verifier** runs the gate stack; skipped critical gates count as FAIL
   - **security-reviewer + privacy-reviewer + adversarial-reviewer** in parallel; each cross-checks the threat model
   - You review the PR **(HUMAN GATE)**

4. When ready to ship, the **release-manager** produces the rollout
   strategy (feature flag, stages, auto-rollback wired BEFORE the
   rollout starts); the **deployer** executes against the plan, reads
   the actual verifier and reviewer reports (no trusting claims), and
   captures pre-deploy state as the rollback baseline. For anything
   touching auth, billing, or personal data, you approve explicitly
   **(HUMAN GATE)**.

5. After each task, append outcome to `.context/feedback-log.md`.

Detailed walkthrough: `workflows/new-project.md`.

---

## Weekly (10 minutes)

Run `workflows/weekly-review.md`. Then invoke the **memory-curator** agent:

```
"memory-curator: review feedback from the past 7 days and propose
updates to .context/"
```

It will produce a report of proposed additions and prunings. **Approve each
one explicitly** — don't auto-apply. Then add the approved entries to the
relevant files.

Without this loop, the system doesn't actually learn. With it, the
preferences and patterns files become genuinely useful within a month.

---

## What to expect early on

**Weeks 1-2** will feel rougher than a hand-tuned single-agent setup.
Agents will sometimes:
- Ask questions you find obvious — they're being cautious, not dim
- Block on things you'd let slide — security and privacy reviewers don't move
  the bar; you adjust the bar in `.context/preferences.md` or `constraints.md`
- Miss patterns that haven't been written down yet — write them down

**Weeks 3-4** become noticeably better as `.context/` fills in.

**Month 2+** is where the system really earns its keep — pattern reuse, fewer
clarifying questions, consistent style, fewer compliance surprises.

---

## When something feels wrong

- **Agent producing low quality?** Check that the librarian briefed it. Check
  that the relevant pattern is in `.context/patterns.md`. If not, that's a
  weekly-review item.
- **Same correction over and over?** Add it to `.context/preferences.md`.
- **An agent is too strict / too lenient?** Edit its system prompt in
  `.claude/agents/`. These are not sacred; tune them.
- **The verifier blocks something legitimately fine?** Edit `scripts/verify.sh`.
  Don't lower the bar in the verifier prompt — lower it in the gates.
- **Constraints feel too tight?** They're set to PIPEDA defaults. For non-
  commercial or non-personal-data projects, relax them in `.context/constraints.md`.

---

## When to add more

The pack already includes the full system, but you may want to add:

- **Embedding-based retrieval** when `.context/` grows past ~50 entries
- **Operations agents** (incident response, bug triage, dependency updater) when you have production traffic
- **Cross-project memory** when you have more than one project using this pack
- **CI integration** to run agents on every PR automatically

See the upgrade discussion in `README.md`.
