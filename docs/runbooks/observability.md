# Runbook — Observability dashboard (PR E · ADR-0013, ADR-0015)

**Status:** operator playbook. The dashboard JSON in
`infra/monitoring/dashboard.json` is the source of truth; this runbook is the
operator's deploy / update / alert manual.

**Companion:** `infra/monitoring/dashboard.json`,
`docs/runbooks/billing-killswitch.md`, threat-model §A.10 (E-T6), mitigation
M38, push-notifications design §16.

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
4. **Billing kill-switch invocations** — `billingKillSwitch` function
   execution count. Per ADR-0013 the kill-switch only runs when the
   monthly cost cap fired. **Any non-zero rate here is an incident.**

ADR-0013 documents the kill-switch design; ADR-0015 documents the
notification observability surface (M37 cleanup logs, M38 structured-log
allow-list).

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
- "Billing kill-switch invocations"

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

---

## 5. Recommended alerts (follow-up PR)

These alerts are NOT in `dashboard.json` (alerts live in
`monitoring.googleapis.com/alertPolicies`, a separate API). They are listed
here so the next operator wires them up consistently:

- **Kill-switch invocation count > 0 in any 5-minute window** → page the
  operator immediately. ADR-0013 §6 specifies the kill-switch only runs on a
  real cap breach, so any invocation is an incident — investigate the
  associated billing alert in the same window.
- **Notify-callable success ratio < 0.95 over 15 minutes** → operational
  alert (Slack `#familyhq-ops`, no pager). Likely causes: FCM credentials
  rotated, Firestore rules regression breaking the recipient lookup, or a
  schema-change rollout that nobody migrated.
- **`cleanedTokenCount` rate > 100 / hour** → potential incident (Slack
  `#familyhq-ops`, no pager). Mass token invalidation usually means an
  external dependency changed (FCM key rotation, APNs cert revoked, or the
  app upgraded a major version that all clients re-registered through).

When these are provisioned, mirror the JSON into `infra/monitoring/alerts/`
following the same review-gated pattern as `dashboard.json` and add an
acceptance test to `test/observability/`.

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
