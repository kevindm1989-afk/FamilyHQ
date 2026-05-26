# Incident response playbook

When something goes wrong in production. Read this BEFORE you have an incident,
not during one.

---

## Severity levels

| Level | Definition | Response |
|---|---|---|
| **SEV-0** | Total outage, data loss in progress, or active breach | Drop everything. Page everyone. PIPEDA breach timer running. |
| **SEV-1** | Major degradation, critical feature broken, security issue | Respond within 15 min. |
| **SEV-2** | Partial degradation, non-critical feature broken | Respond within 1 hour. |
| **SEV-3** | Minor issue, workaround exists | Next business day. |

---

## The 5-minute drill

When an alert fires or a user reports an issue, in this order:

1. **Acknowledge** the alert (so others know you're on it).
2. **Open the incident channel** (Slack channel, Discord, or just a doc).
3. **Invoke `incident-responder`** with the alert details.
4. **Establish severity** — don't downgrade prematurely.
5. **Communicate first findings** within 5 minutes (even if findings are "investigating").

---

## Roles during an incident

For a one-person team, you wear all hats. As the team grows:

- **Incident commander**: makes decisions, coordinates. Not the one debugging.
- **Investigator**: digs into logs/metrics/code.
- **Communicator**: updates status page, customer notices, internal updates.
- **Scribe**: writes the timeline as it happens.

The incident-responder agent supports the investigator. The
rollback-orchestrator supports the incident commander.

---

## Decision tree

```
Is it actively making things worse?
  YES → Stabilize first, investigate after
    → Can a feature flag turn it off? → flag off → verify
    → Can we roll back? → invoke rollback-orchestrator
    → Neither? → fix forward, smallest possible change
  NO → Investigate, then decide
    → invoke incident-responder
    → form hypothesis
    → choose: rollback, fix-forward, or accept-and-monitor
```

---

## PIPEDA breach evaluation

**During every incident**, evaluate:

- Was personal information accessible to anyone who shouldn't have had access?
- Could personal information have been altered or destroyed?
- Was there a loss of personal information?

If yes to any:

1. **Time-stamp now.** The clock for PIPEDA s.10.1 notification is "as soon
   as feasible." Document when the breach was discovered.
2. **Preserve evidence.** Don't delete logs, don't redeploy aggressively until
   the scope is clear.
3. **Assess "real risk of significant harm"** — sensitivity, probability of
   misuse, and number of individuals affected.
4. **If RROSH is plausible**: prepare notification to the Office of the
   Privacy Commissioner and affected individuals. Don't send yet — get
   privacy lawyer review.
5. **Log the breach** in your breach register regardless of RROSH outcome
   (24-month retention required).

For Quebec users (Law 25), the confidentiality incident register must be
maintained, and the CAI notified for "serious risk of harm."

---

## Communication template

Status page / customer notice:

```
[STATUS] We are currently investigating [symptom].

What we know: [brief, factual]
Impact: [who/what is affected]
What we're doing: [investigating / mitigating / monitoring]

Next update: [time, max 30 min away]
```

Update at least every 30 minutes during an active incident. "No new info"
is a valid update.

---

## When to declare resolved

- Health checks green for 30 minutes
- Error rate at or below baseline for 30 minutes
- Affected user paths verified working
- No active customer complaints
- Communication sent: "incident resolved at [time]"

---

## Post-incident (within 48 hours)

Conduct a blameless post-mortem. Document:

- **Timeline** (alert fired, acknowledged, mitigated, resolved)
- **Impact** (users, data, downtime, cost)
- **Root cause** (the actual cause, not just what triggered it)
- **What went well** (detection, response speed, communication)
- **What didn't** (gaps, delays, confusion)
- **Action items** (specific changes, with owners and due dates)

Add the post-mortem entry to `.context/lessons.md`. Update
`.context/patterns.md` with any new patterns or anti-patterns identified.

**Action items must be tracked to completion.** Post-mortems with un-actioned
findings are how the same incident recurs in six months.

---

## What to avoid

- Blame. Post-mortems are about systems, not people.
- Premature resolution. Wait the 30-minute confirmation window.
- Skipping the post-mortem because "it's resolved." This is how learning fails.
- Treating every alert as a SEV-0. Alarm fatigue is real.
- Treating no alerts as "everything's fine." Investigate quiet periods too.
