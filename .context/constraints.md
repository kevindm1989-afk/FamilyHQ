# Constraints — Family HQ (personal, single-family PWA)

**These are hard requirements, not preferences. Every agent reads this before
any task touching user data, auth, storage, telemetry, or external services.**

This is not legal advice. The posture below is calibrated for a **private,
self-hosted app used by one family** — not a commercial product. If that ever
changes (see "Trigger to revisit"), this file must be re-opened *before* any
new-audience code ships.

---

## Scope & posture

- **Audience:** one household. The owner runs their **own** Firebase project;
  there are no third-party customers, no tenants, no public sign-up beyond the
  single founding-parent account and parent-issued invites.
- **Not commercial.** The full PIPEDA commercial apparatus (published privacy
  policy, retention schedules, DPAs, formal breach-notification workflow,
  annual pen-test cadence) is **deliberately out of scope** at this size.
  Sensible security still applies — see "Security baseline that still applies".
- **Backend:** Firebase (Firestore + Authentication), Google-hosted. Data lives
  in Google Cloud regions (US/global by default). This is **accepted** for
  personal use and documented here rather than treated as a flagged
  cross-border transfer. Choose the Firestore region closest to the family at
  project-creation time; it cannot be changed later.

### Trigger to revisit (turns this back into a commercial-grade posture)

Re-open this file and escalate to the full compliance baseline **before**:
- sharing the app with **any family other than the owner's**, or
- publishing it to an app store / public URL for sign-ups, or
- introducing **real money movement** (see "Money"), or
- adding **any third-party analytics, ads, or tracking SDK**.

---

## Children's data — the one area we do NOT relax

Members may be **children under 13**. The founding parent is the account
guardian and creates/manages children's accounts via the invite system. Even
for a private app, treat children's information as the most sensitive data here.

- **Data minimization (hard):** collect only what a feature needs — name, the
  data the family deliberately enters (chores, allowance, posts, events). No
  birthdates, no location, no device identifiers, no contacts. Adding any new
  field about a child requires a documented purpose in `.context/decisions.md`
  first.
- **No third-party tracking on anyone, ever, while children are users:** no
  analytics SDKs, no ad networks, no behavioural telemetry, no session-replay,
  no fingerprinting. Error logging, if added, must be self-contained and must
  not ship a child's name or content to a third party.
- **No marketing, profiling, or outbound email** to or about a member beyond
  the functional invite/password-reset emails Firebase Auth sends.
- **Parent-mediated:** children do not self-register. Account creation and
  deactivation flow through a parent. Deactivation disables login but preserves
  the child's data (no destructive deletion as a side effect).
- A child's content (posts, chores) is visible within the family by design;
  that is the product. It must **never** be exposed outside the authenticated
  family.

---

## Money — tracked numbers only

Allowance points and dollar values are a **ledger of numbers**. There is:
- **No** payment processing, payouts, transfers, cards, or bank-account data.
- **No** PCI DSS scope. This is an explicit out-of-scope decision.

Hard rule: **do not add any real-money feature** (payout, card, bank link,
gift-card, e-transfer) without re-opening this file first. That single change
re-activates the entire financial-data + PCI + breach-notification regime and
is a human-gated decision.

---

## Security baseline that still applies

Personal-scale does not mean insecure. These remain non-negotiable:

### Access control is the heart of this app
- **Firestore Security Rules are THE authorization boundary.** Never rely on
  the client to enforce who-can-see-what. Every rule decision (parent vs
  member, own-doc vs any-doc) is enforced server-side in `firestore.rules`.
- **No role self-elevation.** A user can never write their own `role` field to
  `parent`. Rules must reject it. This is the single most important rule in the
  app — it gets extra review and is treated as security-critical.
- **No unauthenticated access to any collection.** All reads/writes require an
  authenticated, active user.
- **Members are least-privilege:** a member can read/write only their own chore
  docs and the shared sections (board, calendar) as specified; parents manage
  everything.
- **`settings/family`** is readable by any authenticated family member,
  writable only by parents.
- **`invites`** is writable only by parents.
- Deactivated users (`isActive: false`) must not be able to act; rules and/or
  auth should reflect this, not just the UI.

### Secrets & config
- **No hardcoded credentials.** All Firebase config via `VITE_`-prefixed env
  vars; `.env` is gitignored; `.env.example` documents the shape only.
- Note: the Firebase **web** config (apiKey etc.) is an identifier, not a
  secret — but it still goes through env vars per the spec, and security rules
  (not config secrecy) are what protect the data.
- The secrets-handling rules below still bind every agent.

### Hygiene
- **No PII in logs or error messages** shown to clients — especially no child's
  name or content. Surface generic errors via the toast system; keep details
  out of anything that could leave the device.
- **No PII in URL query strings.**
- Input validation at every trust boundary (forms, Firestore writes).
- TLS is provided by Firebase Hosting / Firestore by default — do not downgrade.

### Dependencies
- Prefer popular, well-maintained packages. The pinned stack is React 18,
  Vite, Firebase v10, Tailwind, React Router v6, vite-plugin-pwa/Workbox.
- Keep the verifier's dependency audit green; address high-severity CVEs.

---

## Accessibility

The design must hit the documented bar regardless of compliance scope, because
it is the right thing and the family includes children:
- **WCAG 2.1 AA** as the target for colour contrast, focus states, and labels.
- **Minimum 44px tap targets** (already a design requirement).
- Respect `prefers-reduced-motion` for the sheet/toast animations.
- Dark/light mode must preserve contrast in both themes.

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
- **Never propagate the value** to a downstream agent's context.

Patterns that count as secret-bearing:
- Files: `.env`, `.env.*` (not `.env.example`); `*.pem`, `*.key`, `*.p12`,
  `*.pfx`, `*.jks`; files whose names contain `secret`, `credential`, `token`,
  `password`, `apikey`/`api_key`/`api-key`; cloud credential paths. A Firebase
  **service-account JSON** (private key inside) is secret-bearing and must never
  be committed or echoed.
- Inline values: AWS keys (`AKIA[0-9A-Z]{16}`), GitHub tokens (`ghp_*`, etc.),
  Stripe live keys (`sk_live_*`), Google API keys (`AIza[0-9A-Za-z-_]{35}`)
  used as *secrets*, Slack tokens, private-key headers
  (`-----BEGIN ... PRIVATE KEY-----`), JWTs hard-coded as literals.

If a secret appears inside any `.context/` file, treat that as a finding:
recommend immediate rotation **and** removal from git history.

---

## Hard rules for agents

1. **Never weaken a Firestore security rule** to make a feature work. If a
   feature seems to need a looser rule, that is a design smell — flag it.
2. **Never let a user write their own `role`** to a higher privilege, in code
   or rules.
3. **Never log, return, or display a child's name or content** beyond what the
   immediate function requires.
4. **Never add a third-party service that processes family data** (analytics,
   ads, email, error tracking) without explicit human review against the
   children's-data section above.
5. **Treat authentication, authorization, security rules, and the invite/role
   flow as security-critical** — extra review, no autonomous merge.
6. **For any new data field collected from a user**, document the purpose in
   `.context/decisions.md` before implementation.

---

## Human gates (non-negotiable)

These never get automated:

- Approving the **plan** before any code is written.
- Merging PRs.
- Any change to **`firestore.rules`**, the **role model**, or the
  **invite/account-creation flow**.
- Anything that touches **real/production family data** or deploys to the live
  Firebase project.
- Reversing any of the "Trigger to revisit" decisions (commercial use,
  real money, third-party tracking, children-under-13 handling).
