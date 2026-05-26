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

## 2026-05-25 — Learning-loop memory persists via PRs, not a local log file

**Context:** The learning loop originally assumed `.context/feedback-log.md`
persisted between sessions. But the feedback log is gitignored (privacy), and
Claude Code on the web runs in ephemeral containers reclaimed after the
session — so a local log file does not survive.
**Decision:** Memory updates travel as dedicated `Memory update: <date>` PRs,
and the scheduled curator mines git history + merged PRs (which persist)
rather than the feedback log. The feedback log is treated as in-session
scratch only.
**Rationale:** PRs and git history are the only durable, reviewable record in
an ephemeral-container workflow. Routing memory through them also yields a
one-click human approval gate, which keeps bad lessons and constraint drift
out of `.context/`.
**Reversibility:** Medium — reverting to a log-file-centric loop would require
a persistent execution environment.
