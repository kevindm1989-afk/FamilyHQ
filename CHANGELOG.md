# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **Automatic learning loop** (`CLAUDE.md` + `workflows/memory-loop.md`).
  The pack now keeps its own learning loop alive without the user having
  to remember. Layer 1 (no setup, wired into `CLAUDE.md`): during use,
  the orchestrator captures corrections/patterns and, at the end of a
  substantive session, opens a dedicated `Memory update: <date>` PR with
  memory-curator proposals. Layer 2 (optional): a scheduled run for
  always-on curation — either a Claude Code web trigger or the new
  `.github/workflows/memory-curator.yml.example` GitHub Action (mines git
  history + merged PRs, since the feedback log is gitignored). Memory
  changes always travel as a one-click-approve PR; `constraints.md` is
  never modified by the loop. memory-curator updated to fall back to git
  history when the feedback log is absent (ephemeral/CI runs).
- **Automated token-consumption gate** (`scripts/token-audit.sh`). Greps
  source for raw hex / rgb / hsl colors, inline px/rem styles in
  `style={{...}}`, `outline: none` without replacement, and `!important`.
  Wired into `scripts/verify.sh` as Tier 1. Auto-skips when no UI source
  dirs exist; override with `TOKEN_AUDIT_SKIP=1` (the override is
  surfaced loudly by the verifier).
- **Expanded `design-tokens.json` scaffolding**: light + dark modes,
  density (comfortable / compact), layout grid (max-widths, gutters,
  columns per breakpoint), z-index layers, typography tracking,
  display family, focus-ring color, selection color, touch-target
  minimum, and a `components` block where every required component
  starts as `TO BE SET` so the designer has somewhere to put output.

### Changed
- **All 31 agents tightened to a consistent shape**: discovery →
  process → self-validation → explicit handoffs → hard rules →
  anti-patterns → output format → stop conditions. Behaviour is now
  predictable and cross-references between agents are load-bearing
  rather than aspirational.
- **Cross-agent enforcement**: test-writer refuses vague acceptance
  criteria and returns to architect; implementer refuses missing
  tokens or states and returns to designer; deployer refuses to trust
  "verifier passed" claims without the report; verifier marks skipped
  critical gates as FAIL (no silent pass).
- **Designer** now runs a discovery phase (audience, primary task,
  mood, references), produces every component state (default / hover /
  focus-visible / active / disabled / loading / error / empty /
  success) in light + dark, and mandates handoff to
  accessibility-specialist before tokens are considered committed.
- **Architect** now requires NFRs, capacity/cost sketch, failure modes
  per component, reversibility per stack layer, and explicit handoffs
  to threat-modeler / designer / observability-setup.
- **Test-writer** now does 1:1 acceptance-criterion → test
  traceability, full UI state coverage, and enforces hard determinism
  rules (no real clock / network / RNG / sleep).
- **Implementer** now reads the full design system before any UI
  work, runs a token-consumption self-check on its own diff, and
  refuses to ship interactive components missing any defined state.
- **Threat-modeler** now produces mitigations as testable assertions
  that the test-writer picks up directly.
- **Release-manager** now requires auto-rollback to be synthetically
  tested before any rollout starts; baseline metrics captured before,
  not after.
- **Rollback-orchestrator** now re-confirms human authorization before
  each destructive step and surfaces PIPEDA breach trigger immediately
  if PI was involved.
- **Memory-curator** now requires evidence-backed proposals with
  date-cited feedback entries and a two-data-point threshold; biased
  toward net reduction over time.

### Upgrading from prior versions

If you were running an earlier version of the pack and already had
`.context/feedback-log.md` tracked in git, pulling this update leaves
you with the file still committed AND a gitignore rule that hides
future changes. Run once:

```
git rm --cached .context/feedback-log.md
cp .context/feedback-log.template.md .context/feedback-log.md   # if no live file yet
git commit -m "Untrack feedback log; live file is now local-only"
```

After that, edits to `.context/feedback-log.md` stay local and only
the curated lessons travel via commits to `lessons.md` / `patterns.md`
/ `decisions.md`.

### Security & privacy hardening
- **Feedback log is now gitignored by default.** `.context/feedback-log.md`
  accumulates raw outcomes — ticket excerpts, customer names, incident
  specifics — that should not enter version control. Renamed the
  committed copy to `.context/feedback-log.template.md`; users seed
  the live file with `cp .context/feedback-log.template.md
  .context/feedback-log.md`. Added matching entries to
  `.gitignore.template` and a root `.gitignore` for the pack itself.
- **Secrets-handling rule added to `.context/constraints.md`**, so all
  agents (which read constraints via the librarian) inherit it.
  Defines secret-bearing file and value patterns, requires agents to
  surface only the fact of a secret's presence (never the value), and
  blocks propagation into downstream-agent context. Librarian gets an
  additional explicit rule as the briefing chokepoint.
- **Untrusted-external-content section added to support-liaison,
  dependency-manager, and incident-responder.** These agents ingest
  content from outside the codebase (user reports, package
  changelogs, log lines) where prompt-injection or supply-chain
  attacks are plausible. The new section requires them to treat such
  content as data, never as instructions, and to surface attempted
  injections as findings.

### Documentation
- README updated with new "Agent design" section (the consistent
  shape) and "How the chain wires together" (build flow, recovery
  flow, weekly learning loop).
- **README "Jurisdiction note" added near the top**, explicitly stating
  that the pack's compliance shape is Canadian (PIPEDA + Ontario) and
  that projects shipping elsewhere must replace `.context/constraints.md`
  with their own jurisdiction's requirements. Lists common substitutions
  (GDPR, US sectoral, US state patchwork, Quebec Law 25, other Canadian
  provinces, PHIPA).
- **QUICKSTART** updated: new step seeds the local feedback log from
  the template; step 1 now copies `.gitignore.template` to `.gitignore`
  before the first commit.

---

## [0.1.0] - YYYY-MM-DD

### Added
- Initial release.

---

## Notes for contributors

- **Write entries for the user, not the implementer.** "Added password reset"
  not "Refactored auth module."
- **Security entries are special.** Even patch versions can include security
  fixes — document them so users know to update.
- **Date format**: ISO (YYYY-MM-DD).
- **Version format**: SemVer (MAJOR.MINOR.PATCH).
- **Move "Unreleased" entries to a new version on release.**
- **Link versions** at the bottom if hosting on GitHub:
  `[Unreleased]: https://github.com/org/repo/compare/v0.1.0...HEAD`
