# Backup and restore runbook

The procedure for backing up and restoring this project's data. **Test this
procedure quarterly.** A backup that's never been restored is not a backup —
it's hope.

---

## What is backed up

| Data | Where | Backup frequency | Retention |
|---|---|---|---|
| [Database] | [location] | [hourly/daily/etc.] | [duration] |
| [Object storage] | [location] | [frequency] | [duration] |
| [Secrets / config] | [location] | [frequency] | [duration] |
| [User uploads] | [location] | [frequency] | [duration] |

**Verify:** at least one full backup per day, retained 30+ days.

---

## What is NOT backed up (and why)

| Data | Why not | Recovery plan |
|---|---|---|
| [Cache layer] | Can be rebuilt | Repopulate from primary |
| [Search index] | Can be rebuilt | Reindex from primary |
| [Logs] | Separate retention | N/A |

---

## Backup verification (run weekly)

Backups can silently fail. The system should confirm working backups:

- [ ] Last backup completed within expected window
- [ ] Backup size is within expected range (sudden shrinkage = data loss alarm)
- [ ] Backup file integrity check passes (checksum / restore-test on subset)
- [ ] Off-site copy exists (different region, different provider, or both)
- [ ] Backup encryption verified (key accessible, encryption intact)

---

## Restore procedure (rehearsal — quarterly)

**Rehearse this on a staging environment, not by restoring production data
into production.**

1. **Decide what to restore.** Full restore vs point-in-time vs single record?
2. **Identify the target:** restoration environment (NOT production initially).
3. **Communicate** if this is an emergency restore — incident timeline starts.
4. **Verify backup integrity** before relying on it.
5. **Provision target environment** with the same schema/version.
6. **Restore data** from backup.
7. **Verify data:**
   - Row counts match expected
   - Sample integrity check (random records readable, foreign keys intact)
   - Encryption / decryption works
8. **Run smoke tests** against restored system.
9. **Document the restore** — time taken, any surprises, what needed manual fix.

---

## Emergency restore (production)

When you need to restore to production:

1. **Authorization required** — rollback-orchestrator does not auto-restore.
   Restore is destructive (overwrites current state). Get explicit human OK.
2. **Capture current state** if possible — even a corrupted current state
   may contain transactions not yet in the backup.
3. **Notify users** if restore involves data loss between backup time and now.
4. **PIPEDA evaluation**: did the incident causing the restore involve a
   breach of personal information? If yes, breach notification timer is
   already running.
5. **Execute restore** following the rehearsed procedure.
6. **Verify** before declaring incident resolved.
7. **Post-incident**: document timeline, what data was lost (if any), what
   users were affected, what notifications were sent.

---

## Point-in-time recovery (PITR)

If using a database with PITR (e.g., Postgres with WAL archiving, RDS with
PITR, Aurora):

- Confirm PITR window covers your recovery needs (typically 7-35 days)
- Document the exact command/console steps to do a PITR
- Rehearse PITR specifically — it's different from snapshot restore

---

## Disaster recovery (region/provider failure)

If the primary region or provider becomes unavailable:

1. **Off-site backup location**: [where it is]
2. **Failover provisioning**: [what needs to be set up — and is it ready or cold?]
3. **DNS update**: [TTL, where DNS lives, who can update]
4. **RTO target** (recovery time objective): [how long can users be down?]
5. **RPO target** (recovery point objective): [how much data can be lost?]
6. **Actual capability**: be honest about RTO/RPO actually achievable, not
   just aspirational. Document the gap if any.

---

## Tracking

Per quarter, log:

- Date of restore rehearsal
- Time taken (cold start vs warm)
- Any procedural updates discovered
- Pass / fail

If you skip a quarterly rehearsal, mark it red on the reliability scorecard.

---

## When you don't have this

If your project doesn't yet have a backup strategy:

- **Add one before launch.** Not after. Not "soon."
- Most cloud databases offer automated backups — turn them on with sensible
  retention (30 days minimum for production).
- Object storage versioning is usually one toggle away.
- Test the restore *once* before relying on it.

A documented but untested backup procedure is roughly as useful as no backup
procedure.
