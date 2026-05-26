# Summary

<!-- One sentence: what changed and why. -->

## Type

- [ ] Feature
- [ ] Bug fix
- [ ] Refactor (no behavior change)
- [ ] Performance
- [ ] Security
- [ ] Docs
- [ ] Infrastructure / CI

## Scope check

- [ ] Auth / authorization touched
- [ ] Billing or payments touched
- [ ] Personal data handling touched
- [ ] Database schema or migration
- [ ] Production configuration
- [ ] External service integration (new or changed)
- [ ] Cross-border data transfer involved
- [ ] None of the above (low-risk change)

*If any of the first 7 are checked, this PR requires second-opinion review
and human deploy approval per `constraints.md`.*

## Quality gates

- [ ] All verification gates passed (`scripts/verify.sh` green locally and in CI)
- [ ] Tests added or updated; cover happy path, edge cases, and error paths
- [ ] No PII in logs, error messages, URLs, or referrer headers
- [ ] No new secrets in code
- [ ] No security controls disabled (or, if necessary, marked `HUMAN-APPROVED:` with reason)
- [ ] Dependencies audited; no new high-severity CVEs introduced
- [ ] Performance impact considered; benchmarks run if hot path

## Reviewers signed off

- [ ] Security reviewer: PASS
- [ ] Privacy reviewer: PASS
- [ ] Adversarial reviewer: PASS (or findings addressed)
- [ ] Second-opinion reviewer: PASS (required if scope check has flags)

## Rollout

- [ ] Behind feature flag (default OFF in production)
- [ ] Backwards-compatible (works whether flag is on or off)
- [ ] Rollback procedure documented
- [ ] Auto-rollback wired in (if applicable)
- [ ] Observability covers the new code path

## Documentation

- [ ] README updated (if setup or env vars changed)
- [ ] API docs updated (if endpoints changed)
- [ ] Runbook updated (if operational behavior changed)
- [ ] CHANGELOG entry added (if user-visible)
- [ ] `.context/` updated (if a new pattern or decision was introduced)

## What was the riskiest part of this change?

<!-- Be specific. "Nothing" is rarely true. If you can't think of a risk,
neither can the reviewers, and that's a problem. -->

## How will I know if it's broken in production?

<!-- What metric, alert, log, or user signal would tell me? -->

## How would I roll it back?

<!-- Specific steps. If "I'm not sure" — figure it out before merging. -->
