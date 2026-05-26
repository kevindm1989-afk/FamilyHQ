#!/usr/bin/env bash
#
# new-project-reset.sh — turn a fresh "Use this template" copy of the Agent OS
# pack into a clean starting point for a NEW app.
#
# It keeps the transferable layer (the agents, scripts, workflows, design
# tokens, your universal lessons / preferences / constraints baseline) and
# clears the layer that was specific to whatever project the template was made
# from (that project's ADRs, patterns, and the pack's own meta-docs).
#
# Run ONCE, from the repo root, right after creating the repo from the template:
#
#   bash templates/new-project-reset.sh
#
# It prints exactly what it changed and what you still need to tune by hand.
# Nothing here is irreversible against git — review the diff and commit when
# you are happy.

set -euo pipefail

# --- Safety: only run from the repo root, where the pack lives ---
if [ ! -d ".claude/agents" ] || [ ! -d ".context" ]; then
  echo "error: run this from the repo root (expected .claude/agents/ and .context/ here)." >&2
  exit 1
fi

echo "Resetting pack-specific content for a new project..."
echo ""

# --- 1. Remove pack meta-docs (they describe the PACK, not your app) ---
removed_any=false
for f in CHANGELOG.md COVERAGE.md KNOWN-GAPS.md RELIABILITY.md CONTRIBUTING.md; do
  if [ -f "$f" ]; then
    rm "$f"
    echo "  removed   $f  (pack meta-doc)"
    removed_any=true
  fi
done
$removed_any || echo "  (no pack meta-docs to remove — already clean)"

# --- 2. Replace the pack README with an app stub ---
cat > README.md <<'APP_README'
# <Your app name>

<One-line description of what this app does.>

Built with the Agent OS pack. The specialist agents live in `.claude/agents/`,
this project's institutional memory in `.context/`, and the verification gate
stack in `scripts/`. See `workflows/orchestration.md` for how the agents wire
together and `CLAUDE.md` for the orchestration conventions.

## Getting started

<Fill in setup / run / test instructions as the project takes shape.>
APP_README
echo "  replaced  README.md  (app stub — fill in name + description)"

# --- 3. Reset project-specific memory to empty templates ---
#     (decisions and patterns are about a SPECIFIC app; start fresh.
#      lessons / preferences / constraints are KEPT — they carry forward.)

cat > .context/decisions.md <<'DECISIONS_TEMPLATE'
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

*No entries yet. The first one is usually about stack, hosting, or auth approach.*
DECISIONS_TEMPLATE
echo "  reset     .context/decisions.md  (project-specific — cleared)"

cat > .context/patterns.md <<'PATTERNS_TEMPLATE'
# Patterns

Code and design patterns we use consistently in this project.

Append newest on top. Keep entries tight — three sentences plus a short example
beats an essay.

---

## Format

```
## Pattern name

**When to use:** trigger conditions.
**How:** the actual pattern.
**Example:**
\`\`\`
short code example
\`\`\`
**When not to use:** explicit anti-cases.
```

---

## Entries

*No entries yet. Common early additions: how we handle API errors, how we
structure database tables, how we test async code, how we name things.*
PATTERNS_TEMPLATE
echo "  reset     .context/patterns.md   (project-specific — cleared)"

# --- 4. Seed the gitignored local feedback log ---
if [ ! -f ".context/feedback-log.md" ] && [ -f ".context/feedback-log.template.md" ]; then
  cp .context/feedback-log.template.md .context/feedback-log.md
  echo "  seeded    .context/feedback-log.md  (from template; gitignored)"
fi

# --- 5. Ensure .gitignore exists ---
if [ ! -f ".gitignore" ] && [ -f ".gitignore.template" ]; then
  cp .gitignore.template .gitignore
  echo "  created   .gitignore  (from template)"
fi

# --- Done. Hand the judgment calls back to the human. ---
cat <<'TODO'

Done. The transferable layer is intact: agents, scripts, workflows, design
tokens, and your lessons / preferences / constraints baseline all carried over.

Still TO DO by hand (judgment calls a script should not make):
  - .context/constraints.md  : retune jurisdiction + data types for THIS app
  - .context/preferences.md  : confirm code style / risk posture still fit
  - .context/lessons.md      : KEPT (universal lessons carry forward) — delete
                               any entry that was specific to the project this
                               template came from
  - .context/glossary.md     : review for terms that don't apply to this app
  - README.md                : fill in name + description
  - LICENSE                  : confirm it is the license you want for this app
  - SECURITY.md              : fill in the [your-domain] / contact placeholders

Then: commit, open a Claude Code session on this repo, and start building.
TODO
