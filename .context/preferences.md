# Working Preferences

How I like to work. Every agent reads this before any task.

Fill in the blanks. Update it whenever you correct an agent for something
that wasn't a one-off mistake but a taste mismatch.

---

## Communication

- Be direct and objective. Skip filler, sycophancy, and "great question!"
- Lead with an executive summary for any answer over ~300 words.
- Bold key terms; use bullets for procedures and checklists, not for prose.
- Show reasoning step by step for non-trivial decisions.
- Flag tradeoffs, weaknesses, and uncertainties proactively. Don't pretend
  confidence I shouldn't have.
- If a request is ambiguous, ask before assuming.

## Code style

- Language: TypeScript (Node.js runtime by default; framework chosen per project).
- Formatter / linter: Prettier + ESLint with project-level config.
- Naming: camelCase for variables and functions, PascalCase for types and classes.
- Comments: only when the WHY isn't obvious from the code — hidden constraints,
  invariants, workarounds. No restating what the code does.
- Tests: colocated with source, named `*.test.ts`.

## This project — Family HQ

The standing preferences above hold. Project-specific calls:

- **Stack is fixed** (not up for re-litigation): React 18 + Vite, TypeScript
  (TSX), Tailwind CSS, Firebase v10 (Firestore + Auth), React Router v6,
  vite-plugin-pwa with Workbox. The spec's `.js`/`.jsx` filenames are adapted
  to `.ts`/`.tsx` (e.g. `firebase/config.js` → `firebase/config.ts`).
- **Design tokens are locked and pixel-perfect.** Colours, type scale, spacing,
  radii, and shadows come from the design handoff (mirrored into
  `design-tokens.json` / the Tailwind theme). No inventing values, no
  off-palette colours, no magic numbers. Build the Tailwind theme from the
  tokens, then consume only theme values.
- **Feature-module architecture.** Each feature is self-contained under
  `src/features/{feature}/` (its own components, hooks, and Firestore logic) so
  new features can be added without touching existing ones. Shared primitives
  live in `src/components/`; cross-cutting hooks in `src/hooks/`.
- **Multi-tenant, expansion-friendly data model.** Family HQ is a multi-tenant
  SaaS: a `families/{familyId}` collection plus top-level collections (`users`,
  `events`, `posts`, `chores`, `transactions`, `invites`) where **every
  document carries a `familyId`**. Avoid deep nesting that would force a
  restructure when collections are added later. `familyId` and `role` are
  immutable from the client — enforced in `firestore.rules`.
- **Tenant isolation is the cardinal rule.** Every read/write/query is scoped to
  the caller's `familyId`; no path may cross families. This is enforced in
  security rules, not the client, and is treated as security-critical.
- **Dynamic family, never hardcoded.** Member lists, chore-assignment
  dropdowns, parent filter tabs, and "The Fam" avatar row all derive from the
  live `users` collection for the caller's family (active members only). The
  demo's four fixed people (Sarah/David/Maya/Ben) are reference only — never
  baked in.
- **Every section ships its empty state and its loading state.** A screen is
  not done until "no data yet" reads friendly and the loading path is handled.
- **Every user action routes through the toast system** — success and error
  alike (chore approved/rejected, post deleted, invite sent, errors).
- **Errors are user-safe.** Show a friendly toast; never surface raw
  Firebase/stack errors or any child's PII to the UI or logs.
- **Avatar initials & colour by role:** initials from display name; indigo bg
  for members, amber bg for parents; amber crown badge on parent avatars.
- **Offline-first PWA:** Firestore offline persistence on; app-shell cached;
  offline fallback page; pull-to-refresh on Dashboard and Board.
- **Billing-plan posture: Blaze is live** (activated per ADR-0013 for Cloud
  Functions + FCM; scheduled jobs per ADR-0016; `storage:rules` deploy live as
  of 2026-07-08). The standing discipline is structural, not tier-based: every
  Firebase service gets its OWN `--only <service>` deploy step, never bundled,
  so one service's gate can't block another (2026-06-08 lesson). New chargeable
  surfaces still ship behind the $5/mo budget kill-switch (ADR-0013). ADR-0010
  (stay-on-Spark / ship-dormant) is superseded by ADR-0013.
- **Locale-string collisions across features are forbidden in
  tightly-spaced surfaces** (notably the BottomNav). When a second
  feature reuses a noun already taken by an existing one in a supported
  locale, pick a distinct word for the new surface — even if it's a
  looser translation. Example: French BottomNav uses "Tâches" for Chores
  and "Listes" for the Tasks tab (PR #85) so a `fr-CA` user can tell the
  two surfaces apart at a glance.

## Architecture taste

- Simple over clever, unless the clever version is documented.
- Dependency tolerance: pragmatic — popular, well-maintained libraries are fine
  when they save real time. Avoid niche or single-author packages.
- Database choice for new work: SQLite for local and small projects; Postgres
  once scale (concurrent writers, multi-host, or real data volume) demands it.
- When I accept duplication vs. abstraction: rule of three — two copies is fine,
  extract on the third occurrence. A wrong abstraction is worse than duplication.

## Risk posture

- Reversible changes: ship direct for trivial work; flag only risky or
  high-blast-radius changes (new user-facing flows, perf-sensitive paths,
  anything touching money or auth UX).
- Irreversible changes require my explicit approval before agents act:
  schema migrations, deletes, auth/permission changes, billing logic.
  Never auto-apply.
- Production data: agents may read non-PII tables freely; any query touching
  PII requires explicit per-query approval. No writes to prod without approval.

## What I want surfaced

- Security concerns: always.
- Accessibility concerns: always.
- Performance implications: when changing hot paths or bundle size.
- Cost implications (API calls, infra): when non-trivial.

---

*This file grows. Every time you correct an agent for not matching your taste,
ask whether the correction belongs here.*
