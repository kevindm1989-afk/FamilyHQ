# Agent OS — comprehensive multi-agent system for developers

**31 specialist agents** covering the full software development lifecycle,
scoped to Canadian/Ontario privacy & security requirements, that learns from
use.

**Realistic coverage of a generalist developer's role: ~88–92%.**

The remaining ~8–12% is genuinely human work (strategy, stakeholder relations,
hiring, novel domains) that no agent system can or should replace.

---

## Jurisdiction note — read before adopting

This pack is built around **Canadian (federal PIPEDA + Ontario)** privacy
and security requirements. That shape is load-bearing: it appears in
`.context/constraints.md`, in the privacy-reviewer and threat-modeler
prompts, in the human-gate list, and in breach-notification language
throughout.

**If your project ships to a different jurisdiction, the compliance shape
is wrong for you. You MUST replace `.context/constraints.md` with your
own jurisdiction's requirements before relying on the privacy / security
agents** — otherwise the privacy-reviewer will miss real obligations and
pass code that should not be passing.

Common substitutions:

- **EU / UK** — GDPR + UK GDPR + Data Protection Act 2018; 72-hour breach
  notification, DPO designation, lawful-basis analysis per processing
  activity, DPIAs for high-risk processing, SCCs for transfers.
- **US (federal sectoral)** — HIPAA (health), GLBA (finance), COPPA
  (children under 13), FERPA (education). No general federal privacy law.
- **US (state patchwork)** — CCPA / CPRA (California), VCDPA (Virginia),
  CPA (Colorado), CTDPA (Connecticut), UCPA (Utah), and the rest. Each
  with its own consumer rights and breach-notification timelines.
- **Quebec (Law 25)** — stricter than PIPEDA: mandatory privacy officer,
  automated-decision disclosure, cross-border transfer impact assessments,
  shorter breach-response expectations.
- **Other Canadian provinces** — BC PIPA, Alberta PIPA, NS PIIDPA layer
  over PIPEDA for residents.
- **Ontario healthcare** — PHIPA already layered in; verify it applies.

Not legal advice. For any commercial launch, get a privacy lawyer to
review the actual compliance posture in your jurisdiction. This pack
gives you a defensible baseline shape, not a substitute for legal
review.

---

## Coverage by area

| Area | Coverage | Agents involved |
|---|---|---|
| **Code, tests, review** | 90% | test-writer, implementer, verifier, all reviewers |
| **Architecture, design, planning** | 85% | architect, threat-modeler, designer |
| **Operations, deployment, monitoring** | 90% | observability-setup, deployer, release-manager, incident-responder, rollback-orchestrator, sre-specialist |
| **Security & privacy compliance** | 95% | security-reviewer, privacy-reviewer, threat-modeler, constraints |
| **Documentation** | 90% | docs-keeper, tech-writer |
| **Mobile development** | 80% (was 60%) | mobile-specialist |
| **ML / data engineering** | 75% (was 45%) | ml-data-specialist |
| **Accessibility** | 90% (was 80%) | accessibility-specialist + automated checks |
| **Localization / French** | 85% (was ~30%) | localization-specialist |
| **Product analytics** | 80% (was 0%) | product-analytics |
| **Cost management** | 85% (was 40%) | cost-manager |
| **Support / user reports** | 75% (was 0%) | support-liaison |
| **Site reliability / SLOs** | 85% (was 60%) | sre-specialist |
| **User-facing copy** | 80% (was 0%) | tech-writer |

---

## What's NOT covered (and why that's fine)

| Not covered | Why | Approach |
|---|---|---|
| Product strategy | Requires human judgment | Use the system to execute decisions you've made |
| Stakeholder conversations | Requires human relationships | The system supports your prep, not the meeting |
| Hiring / firing / mentoring | Human work | Out of scope |
| Penetration testing | Must be independent | Hire a pentester; system flags when needed |
| Formal compliance audits | Must be independent | Use system as audit prep, not audit substitute |
| Legal review of contracts/policies | Lawyer required | System drafts; lawyer reviews |
| Game development | Specialized toolchain | Different system entirely |
| Embedded / firmware | Hardware context | Different system entirely |
| Novel research | Requires human invention | This is where you earn your salary |

---

## What's in here

```
.claude/agents/                    ← 31 specialist subagents
  Core (17):
    librarian, scaffolder
    architect, threat-modeler, designer
    test-writer, implementer
    verifier, security-reviewer, privacy-reviewer,
      adversarial-reviewer, second-opinion-reviewer,
      performance-watcher, docs-keeper
    release-manager, migration-handler, deployer
  Operations (4):
    observability-setup, incident-responder,
    rollback-orchestrator, dependency-manager
  Learning (1):
    memory-curator
  Specialists (9):
    mobile-specialist, ml-data-specialist,
    product-analytics, cost-manager,
    accessibility-specialist, localization-specialist,
    support-liaison, sre-specialist, tech-writer

.context/                          ← learning substrate
  constraints, preferences, decisions,
  patterns, lessons, glossary, feedback-log

.github/
  workflows/                       ← CI/CD
    verify, security-scan, deploy
  PULL_REQUEST_TEMPLATE.md

scripts/
  verify.sh                        ← gate stack
  token-audit.sh                   ← enforces design-tokens.json as the
                                     only source of UI values; auto-skips
                                     when no UI source exists

workflows/
  orchestration                    ← how agents wire together
  new-project, start-task,
  weekly-review, before-shipping

playbooks/
  incident-response
  backup-restore

templates/                         ← starter templates for common docs
  privacy-policy, terms-of-service,
  threat-model, runbook, adr

design-tokens.json
.pre-commit-config.yaml
.gitignore.template, .env.example, .editorconfig
Makefile
README.md, QUICKSTART.md, RELIABILITY.md, COVERAGE.md, KNOWN-GAPS.md
SECURITY.md, LICENSE, CONTRIBUTING.md, CHANGELOG.md
```

---

## Agent design

Every agent in the pack follows the same shape, so behaviour is predictable
and cross-references between agents are load-bearing rather than aspirational:

1. **Discovery** — read upstream artifacts (briefing, ADRs, threat model,
   design tokens, prior tests) before producing anything. Ask if the inputs
   are ambiguous; do not guess.
2. **Process** — explicit phases with concrete outputs at each step.
3. **Self-validation** — re-check own output before declaring done (token
   audit, AC traceability, state coverage, etc.).
4. **Explicit handoffs** — name the downstream agents and the artifacts they
   receive.
5. **Hard rules** — no escape hatches; the bar does not move.
6. **Anti-patterns** — common failure modes for that agent's role, listed
   so they're refused on sight.
7. **Output format** — concrete shape so the next agent can act without
   re-asking.
8. **Stop conditions** — situations where the agent refuses and routes back
   upstream rather than producing garbage.

The librarian is called first by every other agent and surfaces human-gate
triggers at the top of its briefing.

---

## How the chain wires together

A typical task flows through the pack like this:

```
librarian            briefs the next agent with constraints + relevant context
   ↓
architect            NFRs, system design, capacity/cost, ordered task list
   ↓ trust boundaries, PI marking
threat-modeler       STRIDE per component → testable mitigations
   ↓ audience, primary task, content shape
designer             discovery + full token set + every component state
   ↓ a11y handoff (mandatory)
accessibility-       reviews every defined state; blocks if AODA not met
specialist
   ↓ ACs + state spec
test-writer          1:1 AC→test mapping; coverage by category; determinism rules
   ↓ failing tests
implementer          reads full design system; token-audit on own diff;
                     state-completeness mandatory
   ↓ implementation
verifier   ──┐       Tier 1 (incl. token-audit) → Tier 5; skipped critical
             │        gates = FAIL; overrides surfaced
security-    ├── parallel; each cross-references threat-model.md and
reviewer     │        decisions.md; false-positive padding rejected
privacy-     ┤
reviewer     │
adversarial- ┘
reviewer
   ↓ green reviews + verifier report
release-manager      flag + auto-rollback wired and synthetically tested
                     before any user sees the change
   ↓ release plan
deployer             reads actual reports (no trusting claims), captures
                     pre-deploy state, concrete post-deploy acceptance
                     metrics
```

When something goes wrong:

```
incident-responder        ranked hypotheses (mechanism / evidence-for /
                          evidence-against / cheapest test)
   ↓ if rollback is the answer
rollback-orchestrator     re-confirms auth before each destructive step;
                          PIPEDA breach trigger surfaced immediately if PI
                          was involved
```

Weekly (or automatically — see below):

```
memory-curator       proposes additions / prunings to .context/ with date
                     citations; never auto-applies; net reduction over time
```

The learning loop runs **automatically with use**: as you work, the
orchestrator captures corrections and opens a one-click-approve `Memory
update` PR with the curator's proposals — no manual ritual required. An
optional scheduled run (Claude Code web trigger or GitHub Action) provides
always-on curation. See `workflows/memory-loop.md`. `constraints.md` is
never modified by the loop.

The cross-references are enforced, not optional. The test-writer refuses
vague ACs and returns to the architect. The implementer refuses missing
tokens and returns to the designer. The deployer refuses to trust
"verifier passed" without the report. This is where the rigor comes from.

---

## The reliability model (unchanged)

Five layers, all covered:
- **Prevention** — review and verification agents
- **Detection** — observability, performance-watcher, support-liaison
- **Containment** — release-manager, migration-handler, feature flags
- **Recovery** — incident-responder, rollback-orchestrator
- **Learning** — memory-curator + post-mortems

Target: ~99.9% reliability with detection in seconds and recovery in minutes.
Not "zero errors" — rare, recoverable, detected, non-recurring errors.

---

## Human gates (always — even at 92% coverage)

Regardless of how comprehensive the agent roster, these stay your decision:

- Spec and architecture approval before code
- Privacy policy, retention, consent flows
- Cross-border transfers, new subprocessors
- Regulator responses
- Breach notification calls
- PR merges
- Production deploys touching auth/billing/personal data
- Database migrations in production
- Restore from backup
- Anything irreversible
- Product strategy decisions
- Anything customer-facing (support drafts, you send)

---

## Honest expectations

**What this system does well:**
- Solo or small-team developers building production web apps in Canada
- Compliance-sensitive applications (PIPEDA, Law 25, PHIPA)
- High-reliability requirements (financial, healthcare-adjacent, government)
- Multi-language Canadian audiences (French + English)
- Teams that need to operate above their headcount

**Where it's less effective:**
- Very large teams with established processes (your processes will conflict)
- Specialized domains (games, embedded, deep ML research)
- Pure exploratory R&D where structure gets in the way
- Hobbyist projects where the overhead exceeds the project

---

## Getting started

See `QUICKSTART.md`. The minimum useful subset for a new project is the
17 core agents; specialists join when relevant.

The verification gate stack (`scripts/verify.sh`) and the token-consumption
audit (`scripts/token-audit.sh`) are project-portable — drop the pack into
a new repo and they run with no further setup. The token audit auto-skips
when there's no UI source, so it's safe to enable from day one.

---

## Not legal advice

For any commercial launch handling personal information of Canadians,
get a privacy lawyer to review your compliance posture. This system gives
you a defensible baseline, not a substitute for legal review.
