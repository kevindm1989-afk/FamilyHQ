# Runbook — Billing kill-switch (PR A · ADR-0013)

**Status:** operator playbook. The IAM steps described here are a **manual
operator action**; they are deliberately NOT a CI job. Run this runbook end
to end the first time the kill-switch is provisioned on a project, and
re-run the negative-binding audits (sections below) any time IAM in the
project changes.

**Companion:** `functions/src/billingKillSwitch.ts`, threat-model §A.4.3
(T-KS.1..T-KS.6), mitigations M33b + M42, push-notifications design §12 A3.

This document satisfies acceptance criteria A3 and the runbook-IAM tests
(A-T6 + A-T7 — `test/functions/runbook-iam.test.ts`).

---

## 0. Placeholders the operator fills in

| Token | Where it comes from | Notes |
| ----- | ------------------- | ----- |
| `{PROJECT_ID}` | `.firebaserc.projects.default` — currently `familyhq-68638` | The Firebase project the function runs on. |
| `{BILLING_ACCOUNT}` | `gcloud beta billing accounts list` — pick the account that pays for `{PROJECT_ID}` | Format: `XXXXXX-XXXXXX-XXXXXX`. **HUMAN-ENTERED** at provisioning time — do NOT commit the real value to the repo. |
| `{KILL_SWITCH_SA}` | created by step 1 below | Full email, e.g. `kill-switch@{PROJECT_ID}.iam.gserviceaccount.com`. |
| `{RUNTIME_SA}` | the default 2nd-gen Cloud Functions runtime SA — `{PROJECT_ID}@appspot.gserviceaccount.com` (or the project's Compute Engine default, depending on Firebase plan) | Verify via `gcloud projects get-iam-policy {PROJECT_ID}`. |

Open question for the operator: confirm `{BILLING_ACCOUNT}` value at
provisioning. The runbook intentionally uses the placeholder so the real
billing-account id is never echoed into git history.

---

## 0a. First-deploy prerequisites — APIs (one-time, per project)

When deploying the kill-switch to a **fresh** project (or any project
that has never deployed a 2nd-gen Cloud Function), the deploy
`firebase deploy --only functions:billingKillSwitch` will whack-a-mole
through ~10 different "API not enabled" failures, each requiring the
operator to enable the missing API and re-trigger. **Enable them all
up front** to skip the dance:

```bash
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  firebaseextensions.googleapis.com \
  run.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com \
  storage.googleapis.com \
  cloudbilling.googleapis.com \
  --project={PROJECT_ID}

# Verify (expect 9 lines)
gcloud services list --enabled --project={PROJECT_ID} \
  --filter='config.name:(cloudfunctions.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firebaseextensions.googleapis.com run.googleapis.com eventarc.googleapis.com pubsub.googleapis.com storage.googleapis.com cloudbilling.googleapis.com)' \
  --format='value(config.name)' | sort
```

Why each is needed:
- `cloudfunctions.googleapis.com` — Cloud Functions itself.
- `cloudbuild.googleapis.com` — Functions are built via Cloud Build.
- `artifactregistry.googleapis.com` — built container images live here.
- `firebaseextensions.googleapis.com` — firebase-tools reads this even when no extensions exist.
- `run.googleapis.com` — 2nd-gen Functions run on Cloud Run under the hood.
- `eventarc.googleapis.com` — the Pub/Sub-to-Cloud-Run trigger machinery.
- `pubsub.googleapis.com` — the topic itself.
- `storage.googleapis.com` — Cloud Build uses GCS to stage builds.
- `cloudbilling.googleapis.com` — the API the function actually calls.

---

## 0b. First-deploy prerequisites — deploy SA project roles

The CI's deploy SA (typically `firebase-adminsdk-fbsvc@{PROJECT_ID}.iam.gserviceaccount.com`)
ships with `roles/firebase.adminsdkServiceAgent` by default, which does
NOT include enough permission to deploy 2nd-gen Cloud Functions. Grant
these three project-level roles BEFORE the first deploy:

```bash
export DEPLOY_SA=firebase-adminsdk-fbsvc@{PROJECT_ID}.iam.gserviceaccount.com

gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:$DEPLOY_SA --role=roles/pubsub.editor

gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:$DEPLOY_SA --role=roles/eventarc.developer

gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:$DEPLOY_SA --role=roles/run.admin
```

Verify with `gcloud projects get-iam-policy {PROJECT_ID} --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$DEPLOY_SA" --format='value(bindings.role)' | sort` — the output should include those three plus whatever `firebase-adminsdk-fbsvc` already had.

---

## 0c. First-deploy prerequisites — `actAs` bindings on three SAs

The deploy SA needs `roles/iam.serviceAccountUser` (the "actAs" role) on
THREE service accounts. Firebase's Cloud Functions deploy machinery
touches each of them at different stages — missing any one of these
errors out the deploy partway through.

```bash
# 1. actAs the kill-switch SA (so the deploy can pin it as the function's
#    runtime SA per §4 below)
gcloud iam service-accounts add-iam-policy-binding \
  kill-switch@{PROJECT_ID}.iam.gserviceaccount.com \
  --member=serviceAccount:$DEPLOY_SA \
  --role=roles/iam.serviceAccountUser \
  --project={PROJECT_ID}

# 2. actAs the App Engine default SA (firebase-tools touches this during
#    function creation even when serviceAccount is overridden)
gcloud iam service-accounts add-iam-policy-binding \
  {PROJECT_ID}@appspot.gserviceaccount.com \
  --member=serviceAccount:$DEPLOY_SA \
  --role=roles/iam.serviceAccountUser \
  --project={PROJECT_ID}

# 3. actAs the Compute Engine default SA (2nd-gen functions use this as
#    the Cloud Run service identity DURING creation, before the
#    runtime-SA override takes effect)
export PROJECT_NUMBER=$(gcloud projects describe {PROJECT_ID} --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  $PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --member=serviceAccount:$DEPLOY_SA \
  --role=roles/iam.serviceAccountUser \
  --project={PROJECT_ID}
```

---

## 0d. First-deploy prerequisites — Pub/Sub + Eventarc service-agent bindings

When the deploy first creates the `billingKillSwitch` function with a
Pub/Sub trigger, Google's machinery needs three service-agent IAM
bindings the deploy SA can't grant itself:

```bash
export PROJECT_NUMBER=$(gcloud projects describe {PROJECT_ID} --format='value(projectNumber)')

# Pub/Sub service identity needs to create signed tokens for delivery
gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator

# Compute Engine default SA needs to receive Eventarc events
gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/eventarc.eventReceiver

# Compute Engine default SA needs run.invoker on the project (a service-
# level binding is also needed — see §0e below — but the project-level
# is the gate firebase-tools checks during deploy)
gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:$PROJECT_NUMBER-compute@developer.gserviceaccount.com \
  --role=roles/run.invoker
```

firebase-tools will print these three commands verbatim in its error
output the first time deploy fails on missing service-agent bindings.

---

## 0e. First-deploy prerequisites — invoker + token-creator on the function itself

This is the step that bit us hardest on 2026-06-11. Firebase 2nd-gen
Pub/Sub-triggered functions are wired such that the **trigger
invokes the Cloud Run service using the FUNCTION'S OWN runtime SA via
an OIDC token signed by Pub/Sub**. For the kill-switch this means:

- The kill-switch SA must have `roles/run.invoker` on its OWN service
  (self-invocation).
- The Pub/Sub service identity must be able to mint OIDC tokens AS the
  kill-switch SA — i.e. `roles/iam.serviceAccountTokenCreator` ON the
  kill-switch SA (not at the project level).

These ONLY work after the function has been deployed once (the service
must exist). Run them AFTER the first `firebase deploy` completes:

```bash
# Self-invocation: kill-switch SA invokes its own Cloud Run service
gcloud run services add-iam-policy-binding billingkillswitch \
  --region=northamerica-northeast1 \
  --project={PROJECT_ID} \
  --member=serviceAccount:kill-switch@{PROJECT_ID}.iam.gserviceaccount.com \
  --role=roles/run.invoker

# Pub/Sub can mint OIDC tokens AS the kill-switch SA (on the SA itself,
# not at the project level)
export PROJECT_NUMBER=$(gcloud projects describe {PROJECT_ID} --format='value(projectNumber)')
gcloud iam service-accounts add-iam-policy-binding \
  kill-switch@{PROJECT_ID}.iam.gserviceaccount.com \
  --member=serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com \
  --role=roles/iam.serviceAccountTokenCreator \
  --project={PROJECT_ID}
```

Without §0e the function deploys, the runtime SA is bound correctly,
the synthetic fire publishes — and every invocation 403s. The
diagnostic that surfaces this is `gcloud run services logs read
billingkillswitch ... | grep 403` — the standard logs.read command
only shows access logs, NOT the function's structured `logger.info`
output. To see the latter, use `gcloud logging read` (see §5 below).

---

## 1. Service accounts (TWO distinct SAs)

This kill-switch design uses **two separate** service accounts. Conflating
them is the failure mode this runbook exists to prevent.

### 1.1 Kill-switch service account — `{KILL_SWITCH_SA}` (DEDICATED)

The kill-switch SA is a **dedicated** identity, created solely for the
`billingKillSwitch` function. It is **NOT** the default 2nd-gen Cloud
Functions runtime SA. This separation is mandatory per threat-model
mitigation **M33b**: the runtime SA must not carry billing rights, and the
kill-switch SA must not carry data or project-write rights. Cross-bleeding
either way turns a single SA compromise into either a data exfiltration
incident OR a billing-detach DoS hidden inside a routine push deploy.

Create it once per project (idempotent — re-running is safe):

```bash
gcloud iam service-accounts create kill-switch \
  --display-name="Billing kill-switch (dedicated, M33b)" \
  --description="Sole purpose: detach billing on budget breach. roles/billing.projectManager on the billing account only. Never grant data or project-level roles." \
  --project={PROJECT_ID}
```

Resulting email: `kill-switch@{PROJECT_ID}.iam.gserviceaccount.com` — record
this as `{KILL_SWITCH_SA}` and use it in every subsequent command below.

### 1.2 Runtime service account — `{RUNTIME_SA}` (the OTHER Functions' identity)

Other Cloud Functions (the notify-callables shipped in PR C..PR E) run as
the default 2nd-gen runtime service account. The kill-switch Function does
NOT run as this identity — the deploy step in `.github/workflows/deploy.yml`
binds `billingKillSwitch` to `{KILL_SWITCH_SA}` explicitly when the operator
configures the function's `serviceAccount` setting.

Identify the runtime SA via:

```bash
gcloud projects get-iam-policy {PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.members ~ ^serviceAccount:.*@appspot.gserviceaccount.com" \
  --format="value(bindings.members)" \
  | sort -u
```

Record the result as `{RUNTIME_SA}`. The negative-binding audits in §3
operate on this SA.

---

## 2. Positive bindings (the ONE role the kill-switch needs)

The kill-switch needs **one** capability and only one: detach the project
from its billing account. That capability is conferred by
`roles/billing.projectManager`, granted **on the project** — NOT on
the billing account.

This distinction is the one that bit us on 2026-06-11: trying to grant
`roles/billing.projectManager` on the billing account fails with
`Role roles/billing.projectManager is not supported for this resource`.
The role exists in the billing-permissions namespace but it is a
PROJECT-level role — Google's docs are confusing about this. The
permissions it carries (`billing.resourceAssociations.delete`,
`billing.resourceAssociations.list`) are evaluated against the
project's IAM policy, not the billing account's. Grant accordingly.

The narrower alternative would be `roles/billing.admin` granted on the
billing account, but that over-scopes the SA — it lets it manage the
entire billing account (link other projects, change payment methods).
Project-level `roles/billing.projectManager` is the least-privilege
choice.

### 2.1 Grant the role

```bash
gcloud projects add-iam-policy-binding {PROJECT_ID} \
  --member=serviceAccount:{KILL_SWITCH_SA} \
  --role=roles/billing.projectManager
```

### 2.2 Verify the role landed

```bash
gcloud projects get-iam-policy {PROJECT_ID} \
  --flatten='bindings[].members' \
  --filter="bindings.members:serviceAccount:{KILL_SWITCH_SA} AND bindings.role:roles/billing.projectManager" \
  --format='value(bindings.role)'
```

Expected: a single line `roles/billing.projectManager`. If empty,
re-run §2.1 and re-verify. Do NOT proceed to §3 until §2.2 prints the
expected role.

---

## 3. Negative bindings (the bindings that MUST NOT exist)

Every entry below is a `must NOT have` assertion. If the audit command
prints any matching rows for the listed SA, the kill-switch design is
compromised — STOP, remove the binding via
`gcloud ... remove-iam-policy-binding ...`, and re-run the audit.

### 3.1 Runtime SA — must NOT have any `roles/billing.*` binding (M33)

The runtime service account (the identity other Functions run as) must
not be able to touch billing. If it could, a compromised dependency in any
Functions runtime (e.g. a poisoned npm package picked up by an unrelated
function) would have the same billing-detach capability as the kill-switch
SA, defeating the M33b separation.

**Audit command:**

```bash
gcloud projects get-iam-policy {PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:{RUNTIME_SA} AND bindings.role:roles/billing." \
  --format="value(bindings.role)"
```

Expected output: **empty** (no rows). The runtime SA should not have
`roles/billing.projectManager`, `roles/billing.admin`, `roles/billing.user`,
or any other `roles/billing.*` role.

If anything prints: `gcloud projects remove-iam-policy-binding {PROJECT_ID}
--member=serviceAccount:{RUNTIME_SA} --role=<printed-role>` and re-audit.

### 3.2 Kill-switch SA — must NOT have `roles/owner` or `roles/editor` (M33b)

The kill-switch SA must not have project-level write authority. If it did,
a compromise of the kill-switch SA escalates from "detach billing
(DoS-only)" to "full project write" — including Firestore writes that
would breach tenant isolation.

**Audit command:**

```bash
gcloud projects get-iam-policy {PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:{KILL_SWITCH_SA} AND (bindings.role:roles/owner OR bindings.role:roles/editor)" \
  --format="value(bindings.role)"
```

Expected output: **empty**. The kill-switch SA should not have
`roles/owner` and should not have `roles/editor`.

If anything prints: remove via `gcloud projects
remove-iam-policy-binding {PROJECT_ID} --member=serviceAccount:{KILL_SWITCH_SA}
--role=<printed-role>` and re-audit.

### 3.3 Kill-switch SA — must NOT have any `roles/datastore.*` or `roles/firestore.*` binding (M33b)

The kill-switch SA does not read or write Firestore at any point. Granting
it `roles/datastore.user`, `roles/datastore.owner`, `roles/firestore.app`,
or any other `roles/datastore.*` / `roles/firestore.*` binding would let a
compromise of the kill-switch SA exfiltrate every family's data — the
worst-case outcome described in threat-model §0.

**Audit command:**

```bash
gcloud projects get-iam-policy {PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:{KILL_SWITCH_SA} AND (bindings.role:roles/datastore. OR bindings.role:roles/firestore.)" \
  --format="value(bindings.role)"
```

Expected output: **empty**. The kill-switch SA should not have any
`roles/datastore.*` and should not have any `roles/firestore.*` binding.

If anything prints: remove via `gcloud projects
remove-iam-policy-binding {PROJECT_ID} --member=serviceAccount:{KILL_SWITCH_SA}
--role=<printed-role>` and re-audit.

### 3.4 Kill-switch SA — must NOT have `roles/billing.admin` (over-privileged)

The runbook deliberately uses `roles/billing.projectManager` (§2.1) and
NOT the broader `roles/billing.admin`. The admin role would let the SA
modify the billing account itself (add other projects to it, change
payment instruments, etc.), which is far beyond what the function needs.

**Audit command:**

```bash
gcloud beta billing accounts get-iam-policy {BILLING_ACCOUNT} \
  --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:{KILL_SWITCH_SA} AND bindings.role:roles/billing.admin" \
  --format="value(bindings.role)"
```

Expected output: **empty**. The kill-switch SA should not have
`roles/billing.admin` on the billing account.

---

## 3.5 Pub/Sub topic publisher restriction (M41)

The `billing-budget-alerts` Pub/Sub topic MUST only accept publishes from
the Google-managed Cloud Billing notifications service account. Without
this restriction, anyone with `roles/pubsub.publisher` on the project
could publish a forged budget-alert message and trip the kill-switch (the
T-KS.1 attack — denial-of-service against your own project's billing
state).

**Audit command (no other principal should hold `roles/pubsub.publisher` on the topic):**

```bash
gcloud pubsub topics get-iam-policy billing-budget-alerts \
  --project={PROJECT_ID} \
  --flatten="bindings[].members" \
  --filter="bindings.role:roles/pubsub.publisher" \
  --format="value(bindings.members)"
```

Expected output: **exactly one member**, the Google-managed billing
notifier — `serviceAccount:billing-budget-alert@system.gserviceaccount.com`
(note: singular `alert`; an older runbook draft pointed at
`cloud-billing-notifications@…` which is the wrong SA for current
projects). If any other principal appears, remove it:

```bash
gcloud pubsub topics remove-iam-policy-binding billing-budget-alerts \
  --project={PROJECT_ID} \
  --member={OFFENDING_MEMBER} \
  --role=roles/pubsub.publisher
```

---

## 4. Wire the function to the kill-switch SA at deploy time

The function source code pins `serviceAccount: '{KILL_SWITCH_SA}'` in the
`onMessagePublished` trigger options (see `functions/src/billingKillSwitch.ts`
constant `KILL_SWITCH_SA`). This is the **structural enforcement** of
M33b — `firebase deploy` reads the literal and binds the Cloud Run
service to that SA on every deploy. There is no Console-click step.

If the literal SA email in the source does not match the SA you created
in §1.1 (e.g. you used a different naming convention), override at deploy
time via the `KILL_SWITCH_SA` env var on the `deploy-functions` step in
`.github/workflows/deploy.yml`.

**Verification (REQUIRED before A5 staging fire — FAIL CLOSED):**

```bash
gcloud run services describe billingkillswitch \
  --region=northamerica-northeast1 \
  --project={PROJECT_ID} \
  --format="value(spec.template.spec.serviceAccountName)"
```

Expected: `{KILL_SWITCH_SA}` exactly.

**If the output is ANYTHING ELSE (especially `{RUNTIME_SA}` or the
default Compute Engine SA):**

1. **STOP.** Do NOT proceed to §5 staging fire.
2. **DO NOT enable `deploy_functions: true` in production** — the
   kill-switch will silently 403 on every `updateBillingInfo` call and
   billing will keep climbing past the cap.
3. Check that the source literal `KILL_SWITCH_SA` (or the env-var
   override) matches the SA email you created in §1.1.
4. Re-deploy. If the binding still doesn't take, escalate — this is a
   structural failure of M33b.

This step is the gate for §5. Do not proceed until the audit command
returns `{KILL_SWITCH_SA}` exactly.

---

## 5. Manual end-to-end verification (M43, quarterly)

**Prerequisite:** §4 verification has passed (the deployed Cloud Run
service is bound to `{KILL_SWITCH_SA}`, not the default runtime SA). If
§4 has not passed, §5 will succeed accidentally (the function might run
under a SA that ALSO happens to have billing rights through some other
binding the operator forgot about) and give false confidence. **Do not
proceed to §5 until §4 returned `{KILL_SWITCH_SA}` exactly.**

Quarterly, publish a synthetic budget-alert message to the staging
project's `billing-budget-alerts` topic to confirm the kill-switch still
works end to end. **Re-attach billing manually after each exercise.**

```bash
# 1. Synthetic over-cap alert (costAmount > budgetAmount → detach expected)
gcloud pubsub topics publish billing-budget-alerts \
  --project={PROJECT_ID} \
  --message='{"budgetDisplayName":"familyhq-monthly","budgetAmount":5.0,"costAmount":9.99,"currencyCode":"CAD"}'

# 2. Wait ~20 seconds for cold start + getBillingInfo + updateBillingInfo
sleep 20

# 3. Read the function's STRUCTURED log (NOT the access log).
# `gcloud run services logs read` shows only HTTP access lines (POST/GET
# + status code) — to see the function's `logger.info` output, you MUST
# use `gcloud logging read` with a structured filter. The 2026-06-11
# operator-debug pinned this distinction the hard way.
gcloud logging read \
  'resource.type="cloud_run_revision" AND resource.labels.service_name="billingkillswitch" AND severity>=INFO' \
  --project={PROJECT_ID} \
  --limit=10 \
  --format='value(timestamp, severity, jsonPayload.action, jsonPayload.message)' \
  --freshness=5m

# 4. Confirm billing was detached
gcloud beta billing projects describe {PROJECT_ID}

# 5. Re-attach billing (MANDATORY — do not skip)
gcloud beta billing projects link {PROJECT_ID} \
  --billing-account={BILLING_ACCOUNT}
```

**Pass condition:**
- Step 3 prints a row with `INFO`, `action=billing_detached`, and
  message `billingKillSwitch: billing detached`.
- Step 4 prints `billingEnabled: false`.
- Step 5 returns successfully and a re-describe prints
  `billingEnabled: true`.

**Diagnostic action codes** (what to look for if step 3 doesn't print
`billing_detached`):
- `malformed_payload_dropped` (WARN) — payload decode failed; re-check
  the publish command's JSON.
- `below_threshold` (INFO) — `costAmount <= budgetAmount` per M42 / A-T3
  strict-`>` semantics; raise the cost or lower the budget in step 1.
- `client_init_failed` (ERROR) — googleapis client construction failed;
  check ADC / SA identity.
- `update_billing_info_failed` (ERROR) — the billing API rejected the
  detach; the kill-switch SA's `roles/billing.projectManager` binding
  on the project hasn't propagated, OR was granted on the billing
  account instead of the project (see §2).
- (no log at all + HTTP 403 in `gcloud run services logs read`) — the
  invocation chain is broken; re-check §0e (`run.invoker` and
  `tokenCreator` on the SA itself).

If the synthetic exercise does not detach billing, file an incident and
re-run §§1-3 from the top.

---

## 6. Provenance

- Companion design: `.context/push-notifications-design.md` §12 PR A (A3).
- Companion threat model: `.context/threat-model.md` §A.4.3 (T-KS.1..T-KS.6),
  mitigations M33, M33b, M42.
- Companion ADR: `.context/decisions.md` ADR-0013 (push notifications +
  Blaze + kill-switch).
- Test gate: `test/functions/runbook-iam.test.ts` (A-T6, A-T7).
