# Constraints — Family HQ (commercial, multi-tenant SaaS)

**These are hard requirements, not preferences. Every agent reads this before
any task touching user data, auth, storage, telemetry, or external services.**

This is not legal advice. For commercial launch, get a privacy lawyer to review
the actual compliance posture. Family HQ is a **commercial, multi-tenant SaaS**
serving many independent families from a single deployment, and **children
under 13 are users**. That combination is the strictest posture this pack
supports — treat every rule below as a floor, not a target.

---

## Product shape (drives everything below)

- **Multi-tenant SaaS:** one hosted Firebase project serves many customer
  families. There is no per-family deployment.
- **Tenant = family.** Every record belongs to exactly one family. A
  `families/{familyId}` document replaces the spec's single `settings/family`
  doc, and **every** other document (`users`, `events`, `posts`, `chores`,
  `transactions`, `invites`) carries a `familyId`.
- **Backend:** Firebase (Firestore + Authentication), Google-hosted.
- **Children under 13 are users**, created and managed by a parent who acts as
  guardian. See "Children's data" — it is the most sensitive area in the app.
- **Allowance is tracked numbers only** — no real money moves. See "Money".

---

## Tenant isolation — the #1 security requirement

Because one deployment holds many families' data, **cross-tenant leakage is the
worst thing that can happen** in this product. It is a confidentiality breach
involving children's data across unrelated households.

- **Every Firestore read and write is scoped to the caller's `familyId`.** A
  user can never read, list, or write a document belonging to another family.
  This is enforced in `firestore.rules` server-side, never trusted from the
  client.
- **A user's `familyId` is immutable** and is established at account creation
  (signup creates a new family; invite attaches the new member to the inviter's
  family). A user can never change their own `familyId`.
- **No query may be allowed to span families.** List/collection rules must
  require a `familyId == request.auth's family` constraint.
- Tenant isolation gets the same security-critical treatment as auth: extra
  review, no autonomous merge, explicit tests in the threat model's mitigation
  set.

---

## PIPEDA — the federal baseline (in force)

Every feature touching personal information must satisfy the ten
fair-information principles:

1. **Accountability** — designated privacy contact, published policy,
   accountable for transfers to third parties.
2. **Identifying purposes** — purpose stated at or before collection.
3. **Consent** — meaningful, informed, appropriate to sensitivity. Opt-in for
   anything beyond what's reasonably expected. **Parental consent for
   under-13s** (see Children's data).
4. **Limiting collection** — only what's necessary for the stated purpose.
5. **Limiting use, disclosure, retention** — only for the stated purpose;
   retention schedule defined and enforced.
6. **Accuracy** — users can correct their data.
7. **Safeguards** — appropriate to sensitivity (see Technical Security).
8. **Openness** — privacy practices readily available.
9. **Individual access** — users can access their personal information on
   request (and, for children, the guardian acts on their behalf).
10. **Challenging compliance** — a process for handling complaints.

### Breach notification (PIPEDA s.10.1)

- Notify the **Office of the Privacy Commissioner** AND affected individuals
  **as soon as feasible** when a breach creates **real risk of significant
  harm**. A cross-tenant leak of children's data almost certainly meets this.
- Keep **breach records for 24 months** regardless of severity.
- Bake incident response into the app from day one.

---

## Children's data — strictest area of the app

Members may be **children under 13**. The parent who creates the family is the
guardian and creates/manages children's accounts via the invite system.

- **Parental consent at the tenant boundary.** The founding parent consents on
  behalf of the children they add. Children never self-register. Account
  creation, role assignment, and deactivation flow through a parent.
- **Data minimization (hard):** collect only what a feature needs — display
  name, and the data the family deliberately enters (chores, allowance, posts,
  events). **No** birthdates, location, device identifiers, contacts, or any
  field not required by a shipped feature. Any new field about a child requires
  a documented purpose in `.context/decisions.md` first.
- **No behavioural tracking, ever, while children are users:** no analytics
  SDKs, ad networks, session-replay, fingerprinting, or profiling. If
  product-analytics are added for adults, children must be excluded and it must
  be consent-gated and policy-reviewed (see product-analytics agent rules).
- **No marketing or outbound email** to or about a member beyond the functional
  invite / password-reset / transactional emails the system sends.
- **Error tracking, if added, must scrub PII at the SDK layer** — never ship a
  child's name or content to a third-party service.
- **Deletion preserves dignity:** deactivation disables login without deleting
  data; a guardian deletion request must really delete (or documented
  anonymization), tenant-scoped.
- If the product is ever marketed to or knowingly used by US children, **COPPA**
  applies and must be reviewed before launch (verifiable parental consent,
  stricter rules). Flag at that trigger.

---

## Money — tracked numbers only (PCI out of scope, for now)

Allowance points and dollar values are a **ledger of numbers**. There is **no**
payment processing, payout, transfer, card, or bank-account data, so **PCI DSS
is out of scope**.

This is the one and only out-of-scope decision, and it is conditional:
**do not add any real-money feature** (payout, card, bank link, gift-card,
e-transfer) — and do not add **subscription billing** for the SaaS itself —
without re-opening this file first. Either change re-activates the full
financial-data + PCI regime and is a human-gated decision. (Billing for the
SaaS, when added, should use a hosted provider — Stripe/Moneris — to stay
SAQ-A; card data never touches our servers.)

---

## Jurisdiction

- **Primary:** Canada (federal) + Ontario (provincial). **PIPEDA** applies to
  all commercial activity involving personal information.
- **Quebec Law 25:** out of scope until a Quebec resident is served; the regime
  is stricter than PIPEDA. As a multi-tenant SaaS you cannot easily control
  where families sign up from — **revisit before public launch.**
- **Other provinces / COPPA / GDPR:** out of scope now; each is a launch-gate
  trigger as the audience expands. A consumer SaaS with children is a likely
  GDPR-K / COPPA candidate — flag before any non-Canadian marketing.

### AODA — Accessibility for Ontarians with Disabilities Act

Public-facing service → **WCAG 2.1 Level AA minimum**, an accessibility
statement, and a feedback mechanism. The accessibility-specialist signs off on
user-facing UI. Min 44px tap targets (already a design requirement);
`prefers-reduced-motion` respected; contrast preserved in both light and dark.

---

## Technical security baseline

Non-negotiable for any app handling personal information:

### Access control & authorization
- **Firestore Security Rules are THE authorization boundary** — never trust the
  client. Tenant isolation (above), role checks (parent vs member), and
  own-doc-vs-any-doc are all enforced server-side.
- **No role self-elevation.** A user can never write their own `role` to
  `parent`. **No tenant reassignment.** A user can never change their own
  `familyId`. These two are the highest-value rules in the app.
- **No unauthenticated access to any collection.**
- **Least privilege:** members read/write only their own chore docs and the
  shared sections within their family; parents manage everything within their
  family; no one reaches outside their family.
- `settings`/`families` doc readable by that family's authenticated members,
  writable only by that family's parents. `invites` writable only by parents,
  family-scoped.
- Deactivated users (`isActive: false`) cannot act — enforced beyond the UI.
- **MFA for all admin/operator access** to the Firebase project and any
  production console. No shared admin accounts.

### Encryption
- **TLS 1.2 minimum** (prefer 1.3) in transit. **AES-256 at rest** (Firebase
  provides this). Encrypted backups; key management documented.

### Logging hygiene
- **No PII in application logs** — especially no child's name or content.
- No PII in error messages returned to clients; surface generic toasts.
- No PII in URL query strings.
- Structured logs only; redact sensitive fields at the logging layer.

### Application security
- Input validation at every trust boundary (forms and Firestore writes).
- Output encoding to prevent injection/XSS.
- Rate limiting / abuse controls on auth and invite endpoints.
- Security headers (CSP, HSTS, X-Frame-Options) on the hosted app.

### Vulnerability management
- **Dependency audit on every CI build** — block merge on high-severity CVEs.
- Static analysis on every PR.
- Penetration test before public launch and annually after — with explicit
  cross-tenant isolation tests.

### Data lifecycle
- **Retention schedule defined per data type** and enforced.
- Deletion is real deletion (or documented anonymization), tenant-scoped.
- Data export available for access requests (PIPEDA s.8), guardian-mediated for
  children.

### Third parties & data residency
- Vendor risk assessment + DPA before integrating any subprocessor.
- **Firebase data residency is a flagged cross-border decision.** Choose the
  closest available region at project creation (it is permanent); document where
  data is not in Canada. Treat any new subprocessor that touches family data as
  a human-gated decision.

### Incident response
- Written incident response plan with named contacts and escalation path.
- Communication templates for breach notification ready in advance.

---

## Secrets handling — applies to all agents

Files and inline values that look like credentials, API keys, private keys,
passwords, or session tokens must never be summarized, quoted, or echoed by any
agent. If an agent reads such content (intentionally or incidentally), it must:

- **Refuse to include the secret value** in any output — briefing, review
  comment, generated code, commit message, PR description, log line, or
  downstream-agent context.
- **Surface only the FACT** that a secret was encountered: file path, rough
  category, and a recommendation to rotate-and-remove.
- **Never propagate the value** to a downstream agent's context. The librarian
  and memory-curator are the most likely chokepoints — they must redact at the
  boundary.

Patterns that count as secret-bearing:
- Files: `.env`, `.env.*` (not `.env.example`); `*.pem`, `*.key`, `*.p12`,
  `*.pfx`, `*.jks`; files whose names contain `secret`, `credential`, `token`,
  `password`, `apikey`/`api_key`/`api-key`; cloud credential paths
  (`~/.aws/credentials`, `~/.config/gcloud/`, etc.). A Firebase
  **service-account JSON** (Admin SDK private key) is secret-bearing and must
  never be committed or echoed. Note: the Firebase **web** config (apiKey etc.)
  is a public identifier, not a secret — but it still ships via `VITE_` env
  vars per spec, and security rules (not config secrecy) protect the data.
- Inline values: AWS keys (`AKIA[0-9A-Z]{16}`), GitHub tokens (`ghp_*`, etc.),
  Stripe live keys (`sk_live_*`), Google API keys used as secrets, Slack tokens,
  private-key headers (`-----BEGIN ... PRIVATE KEY-----`), JWTs hard-coded as
  literals.

If a secret appears inside any `.context/` file, treat that as a finding:
recommend immediate rotation **and** removal from git history.

---

## Hard rules for agents

1. **Never allow a query or rule to cross tenant boundaries.** Every data path
   is scoped to the caller's `familyId`.
2. **Never weaken a Firestore security rule** to make a feature work. A feature
   that seems to need a looser rule is a design smell — flag it.
3. **Never let a user write their own `role` or `familyId`.**
4. **Never log, return, or display a child's name or content** beyond what the
   immediate function requires.
5. **Never introduce a third-party service that processes personal data**
   (analytics, ads, email, error tracking) without flagging it for human review
   against the Children's data and Third-parties sections.
6. **Always treat cross-border data transfer as a flagged decision**, even to
   Google/Firebase. Default to the closest region; document where it is not in
   Canada.
7. **Treat authentication, authorization, security rules, tenant isolation, and
   the invite/role flow as security-critical** — extra review, no autonomous
   merge.
8. **For any new data field collected from a user**, document the purpose in
   `.context/decisions.md` before implementation.

---

## Human gates (non-negotiable)

These never get automated, regardless of how much the system has learned:

- Approving the **plan** before any code is written.
- Approving the **privacy policy and terms of service**.
- Approving the **data retention schedule**.
- Approving any **cross-border data transfer** (including Firebase region
  choice).
- Approving access by any **new subprocessor or third party**.
- Any change to **`firestore.rules`**, the **role/tenant model**, or the
  **invite/account-creation flow**.
- Responding to a regulator (OPC federal, IPC Ontario).
- **Breach notification decisions.**
- Production deploys of changes touching auth, tenant isolation, children's
  data, or (when added) billing.
- Reversing any out-of-scope decision (real money, SaaS billing, third-party
  tracking, non-Canadian launch).
