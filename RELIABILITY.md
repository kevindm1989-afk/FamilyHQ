# Reliability scorecard

A self-assessment to track your reliability posture. Run this monthly. Each
item is yes/no. Aim for all "yes" before launching anything serious.

This is the practical version of "as close to zero errors as possible." A
project that scores well here will fail rarely, recover fast, and learn from
each failure.

---

## Prevention (catch bugs before they're written)

- [ ] Verification gates run on every commit (pre-commit hooks)
- [ ] Verification gates run on every PR (CI)
- [ ] No PR merges without verification PASS
- [ ] Tests cover happy path, edge cases, and error paths
- [ ] Code reviewed by at least one human before merge
- [ ] Security reviewer agent runs on every PR
- [ ] Privacy reviewer agent runs on every PR touching personal data
- [ ] Adversarial reviewer runs on critical changes
- [ ] Second-opinion reviewer runs on auth/billing/data/migration changes

---

## Detection (find bugs that slip through)

- [ ] Structured logging in place with correlation IDs
- [ ] Error tracking integrated (Sentry or equivalent), PII-scrubbed
- [ ] Metrics on golden signals (rate, errors, duration)
- [ ] Health check endpoint exists and is monitored
- [ ] Alerts defined for: service down, error rate spike, latency spike
- [ ] Every alert has a runbook
- [ ] Dashboard exists and is readable in 5 seconds
- [ ] On-call rotation defined (or single-person availability documented)
- [ ] Synthetic monitoring on critical paths

---

## Containment (limit blast radius)

- [ ] Feature flags available for user-facing changes
- [ ] Gradual rollout used for all user-facing changes (1% → 100%)
- [ ] Auto-rollback wired in for rollouts
- [ ] Staging environment exists and is used before production
- [ ] Production data is not modified by tests or staging
- [ ] Database changes use expand-contract pattern
- [ ] Schema migrations tested in staging before production
- [ ] Rate limiting in place for write endpoints
- [ ] Circuit breakers for external dependencies

---

## Recovery (fix fast when bugs ship)

- [ ] Rollback procedure documented for every deploy type
- [ ] Rollback procedure tested in staging (not just written)
- [ ] Database backups taken regularly and verified
- [ ] Restore procedure tested (not just backup procedure)
- [ ] Mean time to detection (MTTD) measured
- [ ] Mean time to recovery (MTTR) measured
- [ ] Incident response playbook exists (`playbooks/incident-response.md`)
- [ ] Communication templates ready (status page, customer notice)

---

## Learning (prevent recurrence)

- [ ] Post-mortem conducted after every SEV-0 and SEV-1
- [ ] Post-mortems are blameless
- [ ] Action items from post-mortems are tracked to completion
- [ ] Lessons added to `.context/lessons.md`
- [ ] Memory-curator run weekly with feedback log
- [ ] Patterns updated based on learnings
- [ ] Verification gates updated when bugs ship that should have been caught

---

## Compliance (Canadian/Ontario specific)

- [ ] Privacy policy current and matches code behavior
- [ ] Retention schedule documented and enforced (automated deletion)
- [ ] Right-of-access workflow tested
- [ ] Right-to-deletion workflow tested
- [ ] Breach response plan documented
- [ ] Breach register exists (24-month retention per PIPEDA)
- [ ] Subprocessor list maintained
- [ ] Cross-border transfers documented with safeguards
- [ ] PIA completed if Quebec users (Law 25)
- [ ] AODA WCAG 2.0 AA compliance verified (if public-facing)

---

## Score interpretation

- **90%+ across all sections** → production-ready. Real risks are well-managed.
- **75-90%** → ship to limited users. Identify the gaps and close them.
- **50-75%** → not production-ready. Closing gaps now is much cheaper than after incidents.
- **<50%** → development-stage. Don't launch without serious investment in the missing layers.

---

## What to track over time

| Month | Prevention | Detection | Containment | Recovery | Learning | Compliance | MTTD | MTTR | Incidents |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

Update monthly. Trends matter more than absolute numbers. Drops in any column
warrant investigation.
