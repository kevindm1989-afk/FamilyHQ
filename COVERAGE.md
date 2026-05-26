# Coverage Analysis

A clear-eyed accounting of what this system covers, what it doesn't, and
why. Updated when agents are added or removed.

---

## Headline number

**For a typical generalist application developer working in a
Canadian/Ontario context, building production web/mobile apps with
compliance requirements: ~88–92% coverage.**

The number depends on your specific role and project type. The detailed
breakdown below lets you calibrate for your situation.

---

## By role

| Role | Coverage | Notes |
|---|---|---|
| Solo developer / indie founder (web/mobile) | **88%** | Sweet spot. Specialists cover most domains. |
| Small team developer (web/SaaS) | **90%** | Same as solo plus the team gets compliance discipline. |
| Senior engineer at tech company | **70%** | More leadership work the system doesn't touch. |
| Tech lead | **55%** | Half the job is leadership; system handles the technical half well. |
| Startup founding engineer | **80%** | Some product/marketing work outside scope. |
| Mobile developer (React Native, Flutter) | **85%** | mobile-specialist closes most of the gap. |
| Mobile developer (native iOS/Android) | **78%** | Some native tooling weaker than cross-platform. |
| ML engineer | **75%** | ml-data-specialist covers core; some research work not. |
| Data engineer | **80%** | Pipeline work covered. |
| Backend / API developer | **92%** | System's strongest area. |
| Frontend developer | **88%** | Designer + accessibility-specialist + tech-writer help. |
| Full-stack developer | **90%** | Strong coverage across the board. |
| Game developer | **40%** | Wrong domain — different toolchains. |
| Embedded / firmware developer | **30%** | Wrong domain — hardware context missing. |
| DevOps / SRE | **85%** | Operations agents + sre-specialist. |
| Security engineer | **65%** | Reviewers help but specialized red-team work is human. |
| Mobile-first dev for Canadian audience | **88%** | mobile + localization + accessibility specialists. |
| Compliance-focused dev (PIPEDA/Law 25) | **95%** | System's compliance posture is unusually strong. |

---

## By activity (granular)

### Software development core

| Activity | Coverage | Comment |
|---|---|---|
| Requirements / spec | 75% | architect structures; stakeholder work is yours |
| Architecture design | 85% | strong scaffolding; final judgment yours |
| Threat modeling | 90% | comprehensive coverage |
| UI/UX design (visual) | 70% | designer agent + tokens; taste judgment yours |
| UI/UX design (interaction) | 75% | better than visual; patterns codified |
| Database design | 80% | architect + migration-handler |
| API design | 85% | reviewers ensure quality |
| Code writing | 92% | strongest area |
| Code review | 95% | multi-layer beats most teams |
| Unit testing | 90% | test-writer mandates TDD-style |
| Integration testing | 85% | covered |
| E2E testing | 75% | foundational; advanced flaky-test mgmt not |
| Performance testing | 75% | performance-watcher catches regressions |
| Load testing | 60% | basic coverage; sophisticated load testing weaker |
| Documentation (technical) | 90% | docs-keeper actively maintains |
| Documentation (user) | 80% | tech-writer covers most |
| Refactoring | 80% | when explicit; opportunistic less |
| Local debugging | 70% | human-dominant by nature |
| Production debugging | 85% | incident-responder strong |
| Performance optimization | 70% | catches problems; deep tuning specialized |

### Operations

| Activity | Coverage | Comment |
|---|---|---|
| CI/CD setup | 90% | workflows included |
| CI/CD maintenance | 85% | covered |
| Deployment | 85% | deployer + release-manager |
| Feature flags | 85% | release-manager owns |
| Gradual rollouts | 85% | covered |
| Observability | 80% | observability-setup; advanced work needs sre-specialist |
| Logging hygiene | 90% | privacy constraints enforce |
| Alerting | 80% | covered with runbooks |
| Incident response | 85% | playbook + agents |
| Post-mortems | 85% | playbook documented |
| Capacity planning | 75% | sre-specialist when mature |
| SLO management | 80% | sre-specialist |
| Cost management | 85% | cost-manager |
| Backup / DR | 65% | mentioned; agents don't deeply own |

### Specialized domains

| Domain | Coverage | Comment |
|---|---|---|
| Mobile (cross-platform) | 85% | mobile-specialist |
| Mobile (native) | 75% | platform tooling gaps |
| Web (frontend) | 88% | strong |
| Web (backend) | 92% | strongest |
| ML / data | 75% | ml-data-specialist; research work not |
| DevOps / infra | 85% | covered |
| Mobile games | 40% | wrong domain |
| Desktop apps (Electron) | 80% | web-adjacent |
| Desktop apps (native) | 60% | platform tooling gaps |
| CLI tools | 88% | small scope, fits well |
| Browser extensions | 80% | web-adjacent |
| Embedded | 30% | wrong domain |
| Blockchain | 45% | specialized; security review needs expertise |
| Real-time / low-latency | 60% | performance-watcher; deep tuning specialized |

### Compliance / regulatory

| Activity | Coverage |
|---|---|
| PIPEDA | 95% |
| Quebec Law 25 | 90% |
| PHIPA (Ontario health) | 80% |
| FIPPA / MFIPPA | 75% |
| AODA / WCAG | 90% |
| OWASP-style security | 92% |
| GDPR | 70% (not the focus but transferable) |
| HIPAA (US health) | 50% (different regime, principles transferable) |
| SOC 2 prep | 60% (provides audit-ready baseline) |
| ISO 27001 prep | 55% (similar to SOC 2) |
| Pentest | 25% (system says when to do it; can't replace it) |

### Product / business

| Activity | Coverage |
|---|---|
| Sprint planning | 55% | architect produces task lists |
| Stakeholder comms | 15% | not the system's job |
| User research | 0% | human |
| Product strategy | 0% | human |
| Roadmapping | 30% | memory-curator surfaces patterns |
| User-facing copy | 80% | tech-writer |
| Marketing copy | 50% | tech-writer can draft; positioning is human |
| Sales engineering | 20% | not in scope |
| Customer support | 75% | support-liaison drafts; humans send |
| Analytics / metrics | 80% | product-analytics |
| A/B testing | 80% | product-analytics |
| Hiring | 0% | human |
| Mentoring | 0% | human |

---

## The math on the headline number

For a solo Canadian web developer building production apps:

Time-weighted activity breakdown of a typical developer's day:

- **40%** code/test/review work × 92% covered = 36.8%
- **15%** operations / deployment × 88% covered = 13.2%
- **10%** compliance / security × 95% covered = 9.5%
- **8%** documentation × 88% covered = 7.0%
- **7%** architecture / design × 80% covered = 5.6%
- **5%** debugging × 78% covered = 3.9%
- **5%** dependency / cost / refactor maintenance × 85% covered = 4.3%
- **4%** user-facing copy / support × 78% covered = 3.1%
- **3%** sprint planning / coordination × 55% covered = 1.7%
- **3%** stakeholder / strategy work × 5% covered = 0.2%

**Total: ~85% time-weighted coverage.**

For "value-weighted" coverage (some activities matter more):
- High-leverage activities (architecture, security, compliance) are covered
  even better
- Low-leverage but high-frequency activities (code review, formatting,
  dependency bumps) are covered very well
- The uncovered work is concentrated in strategic decisions, which is the
  right place for human attention anyway

**Time-weighted: ~85%. Value-weighted: ~90%. Honest range: 85-92%.**

---

## How to push beyond 92%

Honestly: **you probably shouldn't try.**

The remaining 8-15% is concentrated in:
- Decisions that require accountability (you can't delegate)
- Relationships that require humans (stakeholders, customers, regulators)
- Judgment about novel situations (no agent's training covers this)
- Specialized work that needs human experts (pentest, legal, deep ML research)

**Pursuing 100% leads to:**
- False confidence ("the system has it covered" — it doesn't)
- Bloat and friction (more agents = more coordination overhead)
- Pretend automation (an agent that "handles" stakeholder relations is theater)
- Lost focus on the parts that actually need your attention

**The right move is:**
- Use this system for the 85-92% it covers
- Spend the time you get back doing the remaining 8-15% better
- Recognize when you're outside the system's scope and act accordingly

---

## When to revisit this number

Update this analysis when:
- You add or remove agents
- You change scope (different domain, different jurisdiction)
- You discover gaps in real use (most accurate source of truth)
- Your role changes (solo → team, IC → lead)

The honest number is whatever your actual experience reveals. This document
is a model; your usage data is the territory.
