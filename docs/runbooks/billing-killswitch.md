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
`roles/billing.projectManager`, granted **on the billing account** — NOT on
the project.

This distinction matters: granting `roles/billing.projectManager` at the
project level (`gcloud projects add-iam-policy-binding ...`) over-scopes
the SA — it would let any project-level operator add the binding without
billing-admin review. Granting it on the billing account scopes the
capability to billing-only actions on projects this billing account owns.

### 2.1 Grant the role

```bash
gcloud beta billing accounts add-iam-policy-binding {BILLING_ACCOUNT} \
  --member=serviceAccount:{KILL_SWITCH_SA} \
  --role=roles/billing.projectManager
```

### 2.2 Verify the role landed

```bash
gcloud beta billing accounts get-iam-policy {BILLING_ACCOUNT} \
  --filter="bindings.role=roles/billing.projectManager" \
  --format="table(bindings.role,bindings.members)"
```

Expected: one row whose `members` column contains
`serviceAccount:{KILL_SWITCH_SA}`. If the row is missing, re-run §2.1
and re-verify. Do NOT proceed to §3 until §2.2 prints the expected row.

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
notifier — `serviceAccount:cloud-billing-notifications@system.gserviceaccount.com`.
If any other principal appears, remove it:

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
works end to end. Re-attach billing manually after each exercise.

```bash
# Synthetic over-cap alert (costAmount > budgetAmount → detach expected)
gcloud pubsub topics publish billing-budget-alerts \
  --project={PROJECT_ID} \
  --message='{"budgetDisplayName":"familyhq-monthly","budgetAmount":5.0,"costAmount":9.99,"currencyCode":"CAD"}'

# Observe the function log
gcloud functions logs read billingKillSwitch \
  --region=northamerica-northeast1 \
  --project={PROJECT_ID} \
  --limit=20

# Confirm billing was detached
gcloud beta billing projects describe {PROJECT_ID}

# Re-attach billing (manual)
gcloud beta billing projects link {PROJECT_ID} \
  --billing-account={BILLING_ACCOUNT}
```

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
