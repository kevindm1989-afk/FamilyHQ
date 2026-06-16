# Runbook — Observability dashboard (PR E · ADR-0013, ADR-0015)

**Status:** operator playbook. The dashboard JSON in
`infra/monitoring/dashboard.json` is the source of truth; this runbook is the
operator's deploy / update / alert manual.

**Companion:** `infra/monitoring/dashboard.json`,
`infra/monitoring/alert-policies/`, `docs/runbooks/billing-killswitch.md`,
threat-model §A.10 (E-T6), mitigation M38, push-notifications design §16.

This document satisfies acceptance criterion E-T6 and the dashboard schema test
(`test/observability/dashboard-schema.test.ts`).

---

## 1. Purpose and scope

The Cloud Monitoring dashboard exposes four operational series the on-call
needs to triage push-notifications + cost-cap incidents at a glance:

1. **Notify-callable invocations by kind** — per-callable throughput. A
   sudden drop on one kind without a matching drop on the rest is usually a
   deploy or a Firestore rules regression.
2. **Notify-callable success ratio by kind** — ratio of `status="ok"`
   executions to total executions, per callable. Below 0.95 sustained for
   15 minutes is the operational alert.
3. **FCM stale-token cleanups per kind** — log-based metric over the
   `cleanedTokenCount` payload field emitted by every notify-* callable
   (M37). A 100+ spike in an hour suggests mass token invalidation (a
   common signal: the Firebase project's FCM key got rotated, or APNs
   revoked our certificate).
4. **Billing kill-switch detach events** — counts actual detach
   attempts via the `billing_killswitch_detach_count` log-based metric
   (§4.2). Filters on `jsonPayload.action ∈ {billing_detached,
   update_billing_info_failed}` so routine Cloud Billing budget-update
   pings (which invoke the function but exit with `below_threshold`)
   stay invisible. **Any non-zero rate here is an incident** — the cap
   actually fired.

ADR-0013 documents the kill-switch design; ADR-0015 documents the
notification observability surface (M37 cleanup logs, M38 structured-log
allow-list).

---

## 0. Operator prerequisites — first deploy of PR F's scheduled functions

If you have NEVER deployed PR F's `onSchedule` v2 functions
(`notifyEventReminders`, `notifyBirthdays`) to a project before, the
deploy SA cannot bootstrap the prerequisites on its own. You will
hit a four-step cascade of failures on the first attempt. Bundle
the four operator gates here BEFORE triggering the deploy and the
cascade collapses to a single one-time setup.

Captured 2026-06-16 from the PR F first-deploy attempt sequence
(see `.context/lessons.md` "Server-trigger feature: first deploy
will fail four times in a predictable cascade").

### 0.1 Enable the two new Google Cloud APIs

```bash
gcloud services enable cloudscheduler.googleapis.com pubsub.googleapis.com \
  --project="$FIREBASE_PROJECT_ID"
```

Why both: `onSchedule` v2 needs Cloud Scheduler for the cron job
and lazily provisions Pub/Sub for the scheduler→function plumbing.
Enabling both up front avoids two sequential operator gates.

### 0.2 Grant the deploy SA Cloud Scheduler admin

The deploy SA already has the bindings for Hosting + Firestore +
Functions + Eventarc + Pub/Sub. Cloud Scheduler is the new
permission PR F adds.

```bash
gcloud projects add-iam-policy-binding "$FIREBASE_PROJECT_ID" \
  --member="serviceAccount:{DEPLOY_SA}" \
  --role="roles/cloudscheduler.admin" \
  --condition=None
```

Use the deploy SA email tied to `FIREBASE_SERVICE_ACCOUNT` in
GitHub Actions secrets (find via
`gcloud iam service-accounts list --project=$FIREBASE_PROJECT_ID
--format='value(email,displayName)'` and pick the one with
"firebase-adminsdk" or "github-actions-deploy" in the name).

### 0.3 Verify both gates

```bash
gcloud services list --enabled --project="$FIREBASE_PROJECT_ID" \
  --filter='config.name:(cloudscheduler.googleapis.com OR pubsub.googleapis.com)' \
  --format='value(config.name)'

gcloud projects get-iam-policy "$FIREBASE_PROJECT_ID" \
  --flatten='bindings[].members' \
  --filter='bindings.role:roles/cloudscheduler.admin' \
  --format='value(bindings.members)'
```

Expected: both services listed, the deploy SA email returned.

### 0.4 Confirm the SDK option shape (CI catches but worth knowing)

`firebase-functions` v2 `ScheduleOptions` exposes retry options
**flat** on the options object: `retryCount?: number` directly,
NOT nested under `retryConfig`. PR F learned this the hard way —
the local vitest mock accepted the nested shape; tsc in the CI
deploy job did not. If a future scheduled function lands with
`retryConfig: {...}`, expect `error TS2769: Object literal may
only specify known properties, and 'retryConfig' does not exist
in type 'ScheduleOptions'`.

Reference: `functions/node_modules/firebase-functions/lib/v2/providers/scheduler.d.ts`.

---

## 2. Prerequisites

| Token | Where it comes from | Notes |
| ----- | ------------------- | ----- |
| `{PROJECT_ID}` | `.firebaserc.projects.default` — currently `familyhq-68638` | The Firebase / GCP project where the dashboard lives. |
| `{DASHBOARD_ID}` | output of `gcloud monitoring dashboards create` (the resource name `projects/.../dashboards/<id>`) | Captured at first create, used by every subsequent update. Store in your operator notes, not the repo. |
| `{DEPLOY_SA}` | the deploy service account used by the operator running the gcloud command | Needs `roles/monitoring.dashboardEditor`. The runtime SA for the functions does NOT need this role. |

IAM:

```bash
gcloud projects add-iam-policy-binding "$FIREBASE_PROJECT_ID" \
  --member="serviceAccount:{DEPLOY_SA}" \
  --role="roles/monitoring.dashboardEditor"
```

The deploy SA is the operator's identity (or a CI service account if/when we
move dashboards into CI — not today; see §6). End users never have any of
these roles.

---

## 3. Deploy the dashboard

### First-time create

```bash
export FIREBASE_PROJECT_ID="familyhq-68638"   # or your project

gcloud monitoring dashboards create \
  --config-from-file=infra/monitoring/dashboard.json \
  --project="$FIREBASE_PROJECT_ID"
```

The command prints the new dashboard's resource name. Capture the trailing
`{DASHBOARD_ID}` segment — you will need it for every subsequent update.

### Update an existing dashboard

```bash
gcloud monitoring dashboards update "{DASHBOARD_ID}" \
  --config-from-file=infra/monitoring/dashboard.json \
  --project="$FIREBASE_PROJECT_ID"
```

The update is idempotent: re-running with the same JSON produces no diff.

### Verifying the result

The dashboard appears at:

```
https://console.cloud.google.com/monitoring/dashboards/builder/{DASHBOARD_ID}?project={PROJECT_ID}
```

Four widgets must render:

- "Notify-callable invocations by kind"
- "Notify-callable success ratio by kind"
- "FCM stale-token cleanups per kind"
- "Billing kill-switch detach events"

If the cleanups widget shows "No data," confirm the log-based metric in §4
exists in the same project.

---

## 4. Create the log-based metric `notify_callable_cleaned_token_count`

The "FCM stale-token cleanups per kind" widget queries a user-defined
log-based metric that does NOT exist by default. Create it once per project:

The `gcloud logging metrics create` CLI only exposes a small subset of the
LogMetric API as flags (`--description`, `--log-filter`). The advanced
fields we need — `valueExtractor`, `metricDescriptor.metricKind`,
`metricDescriptor.valueType`, `bucketOptions` — require a YAML config
file via `--config-from-file`. Save this YAML, then create from it:

```bash
cat > /tmp/cleaned-token-metric.yaml <<'EOF'
filter: |
  resource.type="cloud_run_revision" AND
  resource.labels.service_name=~"^notify" AND
  jsonPayload.cleanedTokenCount>0
description: Distribution of cleanedTokenCount across notify-* callables (M37 stale-token cleanup events).
valueExtractor: EXTRACT(jsonPayload.cleanedTokenCount)
metricDescriptor:
  metricKind: DELTA
  valueType: DISTRIBUTION
  unit: "1"
bucketOptions:
  exponentialBuckets:
    numFiniteBuckets: 10
    growthFactor: 2.0
    scale: 1.0
EOF

gcloud logging metrics create notify_callable_cleaned_token_count \
  --config-from-file=/tmp/cleaned-token-metric.yaml \
  --project="$FIREBASE_PROJECT_ID"
```

The notify-* callables are Cloud Functions v2 (Cloud Run-backed), so the
log filter pins `resource.type="cloud_run_revision"` and uses
`resource.labels.service_name` (lowercase). A gen-1 `cloud_function`
filter would silently match zero events — the dashboard's other widgets
use the matching gen-2 metric surface.

**Why DISTRIBUTION (not INT64):** GCP requires a `valueExtractor` to be
paired with `valueType: DISTRIBUTION` — INT64 metrics cannot extract a
field value from log entries. The `exponentialBuckets` (1, 2, 4, 8, …,
1024) capture any realistic cleanup count; the dashboard widget can then
chart mean / p99 / sum-rate of cleanedTokenCount as needed.

Why a custom metric and not a logs-based count: the cleanup events emit a
`cleanedTokenCount` field with the *number* of tokens cleaned per invocation
(M37, allow-listed in the threat-model M38 allow-list). The metric extracts
that integer so the dashboard can chart cleanup volume, not just frequency.

To update the filter or description without re-creating, use
`gcloud logging metrics update notify_callable_cleaned_token_count
--config-from-file=...`.

### 4.2 Create the log-based metric `billing_killswitch_detach_count`

The "Billing kill-switch detach events" dashboard widget + the
`kill-switch-invoked.json` alert policy both depend on this metric.
It counts ACTUAL detach events (the kill-switch crossed the cap and
called `updateBillingInfo`), NOT routine Cloud Billing budget-update
Pub/Sub messages (which invoke the function but exit early with
`action=below_threshold`).

The original PR #115 alert filtered on raw `request_count` and
flooded the operator inbox with `[ALERT]→[RESOLVED]` cycles every
~5-20 minutes — one per routine budget-update ping. The fix here is
to count only the structured-log lines that the kill-switch emits
on actual detach attempts:

```bash
cat > /tmp/killswitch-detach-metric.yaml <<'EOF'
filter: |
  resource.type="cloud_run_revision" AND
  resource.labels.service_name="billingkillswitch" AND
  (jsonPayload.action="billing_detached" OR jsonPayload.action="update_billing_info_failed")
description: Counter for actual kill-switch detach attempts (success OR failure). Routine below_threshold no-op invocations are NOT counted. Drives the kill-switch-invoked alert policy + the Billing kill-switch detach events dashboard widget.
metricDescriptor:
  metricKind: DELTA
  valueType: INT64
  unit: "1"
EOF

gcloud logging metrics create billing_killswitch_detach_count \
  --config-from-file=/tmp/killswitch-detach-metric.yaml \
  --project="$FIREBASE_PROJECT_ID"
```

**Why a counter (INT64), not a DISTRIBUTION:** unlike the cleanup
metric (which extracts a per-event `cleanedTokenCount` value), the
detach metric is purely categorical — we just count log entries.
INT64 counter metrics do NOT require a `valueExtractor` and are
compared directly to a literal numeric threshold (no
`ALIGN_PERCENTILE_*` workaround needed).

**Both `action` values matter:** `billing_detached` is the success
path (the cap fired AND we stopped billing). `update_billing_info_failed`
is the failure path (the cap fired but the detach API call failed —
arguably WORSE because billing is still live). Either fires the
alert; the operator triages from the log message.

After creation, the dashboard's "Billing kill-switch detach events"
widget will show "No data" until the FIRST real cap breach. That is
the correct steady-state. A non-zero point here means investigate
right away.

---

## 5. Alert policies

These alerts are NOT in `dashboard.json` (alerts live in
`monitoring.googleapis.com/alertPolicies`, a separate API with a DIFFERENT
schema — alert policies use `displayName`, require a top-level `combiner`
even for a single condition, and express ratios via `denominatorFilter` or
MQL). The three policies ship as review-gated JSON in
`infra/monitoring/alert-policies/`, schema-gated by
`test/observability/alert-policies-schema.test.ts`:

- **`kill-switch-invoked.json`** — fires on actual detach events (not
  on raw kill-switch invocations). Queries the `billing_killswitch_detach_count`
  log-based metric (§4.2) — counts only log lines where
  `jsonPayload.action ∈ {billing_detached, update_billing_info_failed}`.
  Threshold: `> 0` in any 5-minute window → page the operator
  immediately (severity `CRITICAL`). ADR-0013's "kill-switch only runs
  on a real cap breach" framing was the original assumption — the
  reality (caught 2026-06-16, see lessons.md) is that Cloud Billing
  publishes routine budget-update Pub/Sub messages throughout the day,
  each of which invokes the function. The detach-only metric is the
  actionable signal. Runbook: `docs/runbooks/billing-killswitch.md`.
  **PREREQUISITE:** §4.2 must be run before this policy can fire.
- **`notify-success-ratio-low.json`** — notify-callable success ratio
  (2xx / all requests) < 0.95 over 15 minutes → operational alert (Slack
  `#familyhq-ops`, no pager; severity `WARNING`). Likely causes: FCM
  credentials rotated, Firestore rules regression breaking the recipient
  lookup, or a schema-change rollout that nobody migrated.
- **`token-cleanup-spike.json`** — `cleanedTokenCount` sum > 100 / hour →
  potential incident (Slack `#familyhq-ops`, no pager; severity `WARNING`).
  Mass token invalidation usually means an external dependency changed (FCM
  key rotation, APNs cert revoked, or the app upgraded a major version that
  all clients re-registered through). **Prerequisite:** the log-based metric
  from §4 must exist first — the policy queries
  `logging.googleapis.com/user/notify_callable_cleaned_token_count`. The
  aligner is `ALIGN_PERCENTILE_99` with `crossSeriesReducer: REDUCE_MAX`. GCP
  rejects DISTRIBUTION→scalar comparisons unless the aligner explicitly
  collapses the distribution to a scalar — `ALIGN_SUM` and `ALIGN_DELTA` are
  both rejected at create time. `ALIGN_PERCENTILE_99` keeps the
  operational intent (any single hour where the p99 cleanup-event size
  crossed 100 fires the alert).

### Provisioning

The operator identity needs `roles/monitoring.alertPolicyEditor` (the
dashboard role from §2 does not cover alert policies). One create per file:

```bash
gcloud alpha monitoring policies create \
  --policy-from-file=infra/monitoring/alert-policies/kill-switch-invoked.json \
  --project="$FIREBASE_PROJECT_ID"

gcloud alpha monitoring policies create \
  --policy-from-file=infra/monitoring/alert-policies/notify-success-ratio-low.json \
  --project="$FIREBASE_PROJECT_ID"

gcloud alpha monitoring policies create \
  --policy-from-file=infra/monitoring/alert-policies/token-cleanup-spike.json \
  --project="$FIREBASE_PROJECT_ID"
```

Each command prints the created policy's resource name
(`projects/{PROJECT_ID}/alertPolicies/{POLICY_ID}`). Capture the trailing
`{POLICY_ID}` segment in your operator notes (not the repo) — you need it
for channel wiring and every subsequent update.

### Wiring notification channels

The JSON ships with `"notificationChannels": []` ON PURPOSE — channel IDs
are environment-specific resources and must not live in the repo. After
creating the policies:

1. Create the channels in the console: **Monitoring → Alerting →
   "Edit notification channels"**. The kill-switch alert is page-worthy
   (PagerDuty / SMS / the operator's pager-equivalent); the other two go to
   Slack `#familyhq-ops`.
2. List the channel IDs:
   `gcloud alpha monitoring channels list --project="$FIREBASE_PROJECT_ID"`.
3. Attach each channel to its policy:

```bash
gcloud alpha monitoring policies update {POLICY_ID} \
  --add-notification-channels={CHANNEL_ID} \
  --project="$FIREBASE_PROJECT_ID"
```

### Updating an existing policy

Same review-gated process as the dashboard (§6 applies to alert policies
too — console edits are drift):

1. Edit the JSON in `infra/monitoring/alert-policies/` on a feature branch.
2. Verify: `npx vitest run test/observability/`.
3. After merge:
   `gcloud alpha monitoring policies update {POLICY_ID}
   --policy-from-file=infra/monitoring/alert-policies/<file>.json
   --project="$FIREBASE_PROJECT_ID"`.
   Note that `update` replaces the policy fields from the file but keeps
   the attached notification channels unless you also pass channel flags —
   verify the channels survived in the console after updating.

---

## 6. Never hand-edit in the Cloud Console

The dashboard is owned by `infra/monitoring/dashboard.json`. **Any edit made
in the GCP console is drift.** The next operator who re-applies the JSON
will overwrite console edits without warning — and the schema test
(`test/observability/dashboard-schema.test.ts`) will not detect the drift
because it only inspects the file, not the live resource.

Process for every change:

1. Edit `infra/monitoring/dashboard.json` on a feature branch.
2. Verify the schema test still passes: `npx vitest run test/observability/`.
3. Open a PR; reviewer confirms the widget set still covers the four E-T6
   series.
4. After merge, run §3's `gcloud monitoring dashboards update` from your
   operator workstation to apply.

If you find drift (console edits that aren't in the repo), reconcile by
re-applying the JSON — that is the rollback. If the console edit was a
genuine improvement, port it into the JSON and open the PR; never just
"leave it in the console."

---

## 7. PR F — Scheduled-push invoker pin (M45, F12 acceptance — MANUAL, not CI)

The two PR F functions (`notifyEventReminders`, `notifyBirthdays`) are
`onSchedule` v2; the deploy-managed Cloud Scheduler job invokes them over
OIDC-authenticated HTTP. Threat-model T7.1 is the `run.invoker` drift
attack — a forged invocation can't leak data (payload is ignored, markers
dedupe), but each call burns a full `families` scan and walks the project
toward the $5 kill-switch. **M45 closes this with a POSITIVE invoker pin:
each service's `roles/run.invoker` member set must contain EXACTLY the
recorded scheduler principal — and nothing else.** A negative-only
assertion (`allUsers` absent) is INSUFFICIENT per the threat-modeler's
2026-06-11 verdict (§A.18 gate condition #1).

This is a manual operator step run after the FIRST deploy of PR F, then
re-verified on every subsequent deploy of these two functions. It is NOT
CI-gated — the principal string is captured from the live Cloud Run IAM
policy after the first staging deploy and recorded in operator notes.

### 7.1 Capture the deploy-managed invoker principal (first staging deploy only)

```sh
# Set once per shell.
export PROJECT_ID="$(jq -r '.projects.default' .firebaserc)"
export REGION="northamerica-northeast1"

# Capture the IAM policy from each Cloud Run service that backs the two
# scheduled functions. The service names are lower-case versions of the
# function names (Firebase 2nd-gen naming convention).
gcloud run services get-iam-policy notifyeventreminders \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='json(bindings)' | tee /tmp/invoker-eventreminders.json

gcloud run services get-iam-policy notifybirthdays \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='json(bindings)' | tee /tmp/invoker-birthdays.json
```

Record the principal string under `roles/run.invoker` in operator notes
(it is typically of the form
`serviceAccount:<project-number>@gcp-sa-pubsub.iam.gserviceaccount.com` or
the project's deploy-managed scheduler SA). The recorded string is the
expected value for every subsequent re-deploy.

### 7.2 Negative + positive assertions (re-run on every deploy)

```sh
for SVC in notifyeventreminders notifybirthdays; do
  echo "=== $SVC ==="
  POLICY="$(gcloud run services get-iam-policy "$SVC" \
    --region="$REGION" --project="$PROJECT_ID" --format=json)"
  # NEGATIVE — `allUsers` / `allAuthenticatedUsers` must NOT appear.
  if echo "$POLICY" | jq -e '
        .bindings[]? | select(.role=="roles/run.invoker")
        | .members[]? | select(. == "allUsers" or . == "allAuthenticatedUsers")' \
       > /dev/null; then
    echo "FAIL: public invoker exposure on $SVC — see threat-model T7.1 (M45)"
    exit 1
  fi
  # POSITIVE — exactly the recorded principal under roles/run.invoker.
  MEMBERS="$(echo "$POLICY" | jq -r '.bindings[]?
    | select(.role=="roles/run.invoker") | .members[]?' | sort -u)"
  echo "$SVC invoker members:"
  echo "$MEMBERS"
  echo "Compare against the recorded principal in operator notes. If it differs,"
  echo "investigate before continuing — silent drift here is the T7.1 attack."
done
```

### 7.3 Scheduler job count + kill-switch interplay

`onSchedule` deploys ONE Cloud Scheduler job per function. After the PR F
deploy there must be EXACTLY 2 jobs in the project's scheduler region:

```sh
gcloud scheduler jobs list --project="$PROJECT_ID" \
  --location="$REGION" \
  --filter='name~firebase-schedule-(notifyEventReminders|notifyBirthdays)'
```

If the kill-switch fires (`billingKillSwitch` detaches billing), BOTH
scheduled jobs will error every tick until billing is re-attached. Pause
them to silence the error noise during the incident:

```sh
gcloud scheduler jobs pause firebase-schedule-notifyEventReminders \
  --location="$REGION" --project="$PROJECT_ID"
gcloud scheduler jobs pause firebase-schedule-notifyBirthdays \
  --location="$REGION" --project="$PROJECT_ID"

# Resume after the kill-switch incident is resolved + billing is re-attached:
gcloud scheduler jobs resume firebase-schedule-notifyEventReminders \
  --location="$REGION" --project="$PROJECT_ID"
gcloud scheduler jobs resume firebase-schedule-notifyBirthdays \
  --location="$REGION" --project="$PROJECT_ID"
```

### 7.4 Activate the `scheduledSends` TTL (one-time per environment)

```sh
# 7-day TTL on the `expiresAt` field — ADR-0015 pattern. Idempotent.
gcloud firestore fields ttls update expiresAt \
  --collection-group=scheduledSends \
  --enable-ttl \
  --project="$PROJECT_ID"
```

The TTL is OUT OF SCOPE of `test/rules/scheduledSends.test.ts` (which
covers the client deny-all); the runbook step above is the operator's
responsibility per design §14.4 + ADR-0015.
