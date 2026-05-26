# Known Gaps

Things the system doesn't deeply cover. Knowing about them is the
mitigation — you'll recognize when you're outside the system's strong areas
and act accordingly.

This document is honest. The system is comprehensive but not complete.

---

## Domain gaps (system handles, but less deeply)

### Database / query optimization
- **What's covered**: schema design (architect), migrations (migration-handler),
  basic query review (security-reviewer catches SQL injection).
- **What's not**: deep index strategy, query plan analysis, deadlock
  resolution, read-replica patterns, sharding decisions, vacuum/maintenance
  tuning.
- **When you'll feel it**: when DB performance becomes a bottleneck.
- **Mitigation**: bring in a DBA consultant for heavy-data projects; for
  most apps, watch slow query logs and address as they appear.

### Third-party API integrations
- **What's covered**: dependency management, vendor risk in threat model.
- **What's not**: vendor reliability tracking, contract-testing across
  integrations, retry/circuit-breaker patterns codified as patterns.
- **When you'll feel it**: when you're integrating with 5+ external APIs.
- **Mitigation**: codify retry/timeout patterns in `.context/patterns.md`
  as you encounter them.

### Email infrastructure
- **What's covered**: tech-writer drafts content; privacy-reviewer checks PII.
- **What's not**: SPF/DKIM/DMARC setup, bounce/complaint handling, sender
  reputation, email-specific testing tools.
- **When you'll feel it**: when transactional email starts failing or going
  to spam.
- **Mitigation**: use a provider that handles deliverability (Postmark,
  SendGrid, AWS SES with reputation management); document the setup in
  `decisions.md`.

### Search relevance
- **What's covered**: nothing deeply.
- **What's not**: query understanding, ranking, synonyms, typo handling,
  faceting, search analytics.
- **When you'll feel it**: when users complain about search results.
- **Mitigation**: most apps don't need sophisticated search. If yours does,
  bring in a search-engineer consultant or use a managed service (Algolia,
  Elastic, Typesense).

### Real-time / WebSocket / presence
- **What's covered**: architect understands the pattern at a high level.
- **What's not**: connection management, reconnection logic, presence
  systems, exactly-once delivery, room/channel scaling.
- **When you'll feel it**: when building chat, collaborative editing, or
  live dashboards.
- **Mitigation**: use a managed real-time service (Pusher, Ably, Supabase
  Realtime) before building from scratch.

### Background jobs / queues
- **What's covered**: architect can recommend a queue; verifier checks code.
- **What's not**: retry strategies, dead-letter handling, ordering
  guarantees, idempotency patterns codified.
- **When you'll feel it**: when async work fails silently or duplicates.
- **Mitigation**: pick a battle-tested queue system (BullMQ, Sidekiq, SQS,
  Temporal). Codify your retry/idempotency patterns in
  `.context/patterns.md` after your first incident.

### Data migration (separate from schema migration)
- **What's covered**: migration-handler handles schema; can stretch to data.
- **What's not**: large bulk transforms, anonymization sweeps, GDPR-style
  deletion runs as first-class workflows.
- **When you'll feel it**: when you need to backfill, anonymize, or bulk-delete.
- **Mitigation**: treat these as projects, not migrations. Plan them with
  the architect; run them with migration-handler oversight.

---

## Roles the system doesn't cover (and shouldn't)

These are human work, not system gaps:

- Product strategy and prioritization decisions
- Stakeholder conversations and customer meetings
- User research and interviews
- Hiring, firing, performance reviews
- Mentoring and pair programming
- Conference/networking/industry presence
- Internal politics and coalition-building
- Sales engineering and demos
- Pricing decisions
- Vendor negotiations

The system supports these (e.g., tech-writer can draft a demo script,
cost-manager can inform vendor negotiation) but doesn't own them. You do.

---

## Domains the system doesn't fit well

These need different systems entirely:

- **Game development** — different toolchains, different patterns
- **Embedded / firmware** — hardware context the agents lack
- **Hardcore real-time systems** — formal verification territory
- **Deep ML research** — the work the ml-data-specialist *doesn't* cover
- **Blockchain / smart contracts** — security review needs domain experts
- **High-frequency trading** — different latency/correctness regime
- **Safety-critical software** (aerospace, medical) — different process regime

If your project is one of these, this system isn't the right starting point.

---

## How to act on this list

1. **When you spot a gap in real use, capture it.** Add the pattern to
   `.context/patterns.md` so the next encounter is faster.
2. **When a gap matters enough, add specialized tooling** — a consultant, a
   managed service, or eventually a project-specific agent if it persists.
3. **Don't pretend coverage you don't have.** If you're working in a gap
   area, slow down, get a second opinion, don't trust agent output as much.
4. **Revisit this list quarterly.** Gaps either close (you've handled them
   well enough) or expand (you've discovered more). Both are useful information.
