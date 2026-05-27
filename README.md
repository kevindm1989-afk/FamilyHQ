# Family HQ

A shared family home base (PWA) for schedules, a bulletin board, chores, and
allowance. Multi-tenant: one Firebase project serves many independent families;
children under 13 are users, managed by a parent guardian.

Built with the Agent OS pack. The specialist agents live in `.claude/agents/`,
this project's institutional memory in `.context/`, and the verification gate
stack in `scripts/`. See `workflows/orchestration.md` for how the agents wire
together and `CLAUDE.md` for the orchestration conventions.

## Stack

- React 18 + Vite + TypeScript (strict) — `vite-plugin-pwa` for the PWA baseline
- Tailwind CSS, with the theme built entirely from `design-tokens.json` (ADR-0007)
- Firebase v10: Auth (email/password) + Cloud Firestore (offline-first via
  `persistentLocalCache`, ADR-0005)
- Vitest + Testing Library (component) and `@firebase/rules-unit-testing` against
  the Firestore emulator (security rules)

> Phase 0 scaffold: this is a runnable, fully-tooled shell. Auth, security-rules
> logic, shared primitives, and feature screens are built in later phases by the
> implementer / test-writer.

## Prerequisites

- Node 20 (see `.nvmrc`; `nvm use` picks it up)
- Java 11+ (the Firestore emulator runs on a JVM — only needed for `make test-rules`)

## Getting started (clean machine)

```bash
nvm use                 # Node 20
npm install             # install pinned dependencies
cp .env.example .env    # fill in Firebase web config (or keep VITE_USE_EMULATOR=true)
npm run dev             # serve the app shell at http://localhost:5173
```

## Common commands

| Command            | What it does                                              |
| ------------------ | --------------------------------------------------------- |
| `make dev`         | Vite dev server                                           |
| `make build`       | Type-check + production build                             |
| `make lint`        | ESLint (no warnings allowed)                              |
| `make format`      | Prettier auto-fix                                         |
| `make typecheck`   | `tsc --noEmit`                                            |
| `make test`        | Vitest component/unit tests                               |
| `make test-rules`  | Firestore rules tests against the emulator (needs Java)   |
| `make emulators`   | Start the Auth + Firestore emulator suite                 |
| `make verify`      | Full verification gate stack (`scripts/verify.sh`)        |

## Environment

All config is injected via `VITE_`-prefixed env vars (see `.env.example`). The
Firebase web config keys are **public identifiers**, not secrets — real access
control lives in `firestore.rules`. `.env` is gitignored and never committed.

Set `VITE_USE_EMULATOR=true` to point Auth + Firestore at the local emulator
suite (`make emulators`).

## Verification

`scripts/verify.sh` (or `make verify`) runs the gate stack: ESLint, Prettier,
`tsc`, the token audit, `npm audit`, gitleaks, semgrep, knip, Vitest, and the
a11y placeholder. CI runs the same stack on every PR/push (`.github/workflows/
verify.yml`), plus a dedicated **`firestore-rules`** job that runs the rules
isolation tests against the emulator on every change.

## Design tokens

`design-tokens.json` is the single source of truth for color, type, spacing,
radius, and shadow (ADR-0007). `tailwind.config.ts` consumes it directly — no
raw hex/px literals in `src/` (enforced by `scripts/token-audit.sh`). Dark mode
is deferred to post-v1; the `color.dark` tokens are present but not wired.
