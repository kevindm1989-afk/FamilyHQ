#!/usr/bin/env bash
# verify.sh — run the full verification gate stack
#
# Usage: bash scripts/verify.sh
# Exit code: 0 if all gates pass, 1 if any gate fails
#
# Gates are organized in tiers. Lower tiers run first and fail fast.
# Each gate runs only if the relevant tool is available.
#
# Customize: add or remove gates for your project. The agents read this file
# to know what's enforced.

set -uo pipefail

overall_status=0
gates_run=0
gates_passed=0
gates_failed=0

# Default per-gate timeout (seconds). Override with GATE_TIMEOUT env var.
GATE_TIMEOUT="${GATE_TIMEOUT:-300}"

# --- helpers ---

run_gate() {
  local name="$1"
  shift
  local tool="$1"

  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "  [skip] $name — '$tool' not installed"
    return 0
  fi

  echo "  [run]  $name"
  gates_run=$((gates_run+1))

  if timeout "$GATE_TIMEOUT" "$@"; then
    echo "  [pass] $name"
    gates_passed=$((gates_passed+1))
  else
    local code=$?
    if [ "$code" -eq 124 ]; then
      echo "  [FAIL] $name (timed out after ${GATE_TIMEOUT}s)"
    else
      echo "  [FAIL] $name (exit $code)"
    fi
    gates_failed=$((gates_failed+1))
    overall_status=1
  fi
}

# For commands that need shell features (pipes, command substitution, etc.)
run_gate_shell() {
  local name="$1"
  local cmd="$2"

  echo "  [run]  $name"
  gates_run=$((gates_run+1))

  if timeout "$GATE_TIMEOUT" bash -c "$cmd"; then
    echo "  [pass] $name"
    gates_passed=$((gates_passed+1))
  else
    local code=$?
    if [ "$code" -eq 124 ]; then
      echo "  [FAIL] $name (timed out after ${GATE_TIMEOUT}s)"
    else
      echo "  [FAIL] $name (exit $code)"
    fi
    gates_failed=$((gates_failed+1))
    overall_status=1
  fi
}

section() {
  echo
  echo "=== $1 ==="
}

# Check for a script in package.json (precise — won't false-positive on substrings)
has_npm_script() {
  [ "$has_node" = true ] || return 1
  node -e "process.exit(require('./package.json').scripts && require('./package.json').scripts['$1'] ? 0 : 1)" 2>/dev/null
}

# Detect stacks
has_node=false
has_python=false
has_go=false
has_rust=false

[ -f "package.json" ] && has_node=true
{ [ -f "pyproject.toml" ] || [ -f "requirements.txt" ] || [ -f "setup.py" ]; } && has_python=true
[ -f "go.mod" ] && has_go=true
[ -f "Cargo.toml" ] && has_rust=true

# Warn if Node project has no node_modules — npx --no-install will fail confusingly without it
if [ "$has_node" = true ] && [ ! -d "node_modules" ]; then
  echo "WARNING: package.json exists but node_modules is missing."
  echo "Run 'npm install' (or 'pnpm install') before verification."
  echo
fi

# --- Tier 1: Static checks (fast) ---
section "Tier 1: Static checks"

if [ "$has_node" = true ]; then
  run_gate "eslint"     npx --no-install eslint . --max-warnings=0
  run_gate "prettier"   npx --no-install prettier --check .
  run_gate "tsc"        npx --no-install tsc --noEmit
fi

if [ "$has_python" = true ]; then
  run_gate "ruff"       ruff check .
  run_gate "ruff-fmt"   ruff format --check .
  run_gate "mypy"       mypy --strict .
fi

if [ "$has_go" = true ]; then
  # gofmt needs shell because we test the output
  if command -v gofmt >/dev/null 2>&1; then
    run_gate_shell "gofmt" 'test -z "$(gofmt -l .)"'
  else
    echo "  [skip] gofmt — not installed"
  fi
  run_gate "go-vet"     go vet ./...
fi

if [ "$has_rust" = true ]; then
  run_gate "rustfmt"    cargo fmt --check
  run_gate "clippy"     cargo clippy --all-targets --all-features -- -D warnings
fi

# Token consumption — enforces design-tokens.json as the only source of UI values.
# Skipped when no UI source dirs exist. Override with TOKEN_AUDIT_SKIP=1.
if [ -f "scripts/token-audit.sh" ]; then
  run_gate_shell "token-audit" "bash scripts/token-audit.sh"
fi

# Locale drift — every non-en locale file must mirror en.json's key shape
# exactly. Catches the silent failure mode where a French user sees English
# fallback because someone forgot to add a key to fr.json. Skipped if
# src/locales/ doesn't exist or no script is present.
if [ -f "scripts/locale-drift.cjs" ] && [ -d "src/locales" ]; then
  run_gate "locale-drift" node scripts/locale-drift.cjs
fi

# Bail early if Tier 1 failed
if [ "$overall_status" -ne 0 ]; then
  echo
  echo "Tier 1 failed. Stopping."
  echo "Total: $gates_run run, $gates_passed passed, $gates_failed failed"
  exit 1
fi

# --- Tier 2: Analysis ---
section "Tier 2: Analysis"

if [ "$has_node" = true ]; then
  if command -v pnpm >/dev/null 2>&1 && [ -f "pnpm-lock.yaml" ]; then
    run_gate "pnpm-audit"  pnpm audit --audit-level=high
  elif [ -f "package-lock.json" ]; then
    run_gate "npm-audit"   npm audit --audit-level=high
  fi
fi

[ "$has_python" = true ] && run_gate "pip-audit" pip-audit
[ "$has_rust" = true ] && run_gate "cargo-audit" cargo audit

# Secrets scan (works on any project)
run_gate "gitleaks" gitleaks detect --no-banner --no-git

# Static analysis (any language)
run_gate "semgrep" semgrep --config auto --error --quiet .

# Dead code (Node)
[ "$has_node" = true ] && run_gate "knip" npx --no-install knip

# Production bundle build — catches anything tsc/test miss at the bundler
# level: a dynamic import path vitest happens to resolve but vite doesn't,
# a Workbox/PWA config that errors on real build, a tree-shake that drops
# something used. Runs vite directly (npm run build re-runs tsc, which is
# already a Tier 1 gate).
[ "$has_node" = true ] && run_gate "build" npx --no-install vite build --logLevel=error

# Bundle-size budget — runs AFTER the build gate so dist/assets exists.
# Catches code-split regressions: a new direct import that pulls Firebase
# into the login bundle (PR #19's fix), a feature route that grows past
# its per-route budget, etc. Budgets live in scripts/bundle-budget.json
# and are deliberately tight — when one needs to grow, the same PR that
# adds the weight bumps the budget. Skipped if dist/ wasn't produced
# (the build gate above will have already failed).
if [ -f "scripts/bundle-budget.cjs" ] && [ -d "dist/assets" ]; then
  run_gate "bundle-budget" node scripts/bundle-budget.cjs
fi

# --- Tier 3: Tests ---
section "Tier 3: Tests"

if has_npm_script "coverage"; then
  # Coverage replaces a plain `npm test` here: vitest run --coverage runs
  # the entire test suite AND enforces the lines/branches/functions
  # thresholds pinned in vite.config.ts. A regression that drops below
  # the floor fails the gate. Wall-clock cost over plain `npm test` is
  # ~negligible in practice (v8 instrumentation is cheap on this codebase).
  run_gate "npm-test" npm run coverage --silent
elif has_npm_script "test"; then
  run_gate "npm-test" npm test --silent
elif [ "$has_node" = true ]; then
  echo "  [skip] tests — no 'test' script in package.json"
fi

[ "$has_python" = true ] && run_gate "pytest" pytest -q
[ "$has_go" = true ] && run_gate "go-test" go test ./...
[ "$has_rust" = true ] && run_gate "cargo-test" cargo test --quiet

# --- Tier 4: UI (if applicable) ---
section "Tier 4: UI"

if has_npm_script "a11y"; then
  run_gate "a11y" npm run a11y --silent
else
  echo "  [skip] a11y — no 'a11y' script in package.json"
fi

# Playwright e2e smoke (public surface). Gracefully SKIPS when no browser
# binary is available — CI provides one via the workflow's `playwright
# install chromium` step, devs run it once locally. The gate distinguishes
# "no Playwright" (skip, fine) from "Playwright present but failing" (fail).
#
# Browser path: only override PLAYWRIGHT_BROWSERS_PATH to the team's
# prebuilt-container location when that directory ACTUALLY exists. On a
# fresh laptop or in CI it's absent, and forcing it would point Playwright
# at a nonexistent binary (the CI failure that prompted this comment).
# When unset, Playwright uses its own default (~/.cache/ms-playwright).
if has_npm_script "e2e"; then
  if [ -z "${PLAYWRIGHT_BROWSERS_PATH:-}" ] && [ -d /opt/pw-browsers ]; then
    export PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
  fi
  if npx --no-install playwright --version >/dev/null 2>&1; then
    run_gate_shell "e2e" "npm run e2e --silent"
  else
    echo "  [skip] e2e — Playwright not installed (run 'npx playwright install chromium')"
  fi
fi

# Authed e2e — wraps Playwright in `firebase emulators:exec` so a real
# Firebase Auth + Firestore emulator suite is up for the founding-parent
# happy path. Skipped gracefully when Playwright OR Java is missing —
# both are needed and a clear skip beats an opaque failure. CI installs
# both up front (see .github/workflows/verify.yml).
if has_npm_script "e2e:authed"; then
  if npx --no-install playwright --version >/dev/null 2>&1 \
     && command -v java >/dev/null 2>&1; then
    run_gate_shell "e2e-authed" "npm run e2e:authed --silent"
  else
    echo "  [skip] e2e-authed — Playwright and/or Java not available"
  fi
fi

# --- Tier 5: Adversarial (warn only) ---
section "Tier 5: Adversarial (warnings only)"

if has_npm_script "mutation"; then
  echo "  [run]  mutation"
  if timeout "$GATE_TIMEOUT" npm run mutation --silent; then
    echo "  [pass] mutation"
  else
    echo "  [warn] mutation — review score (not blocking)"
  fi
fi

# --- Summary ---
section "Summary"
echo "  Gates run:    $gates_run"
echo "  Gates passed: $gates_passed"
echo "  Gates failed: $gates_failed"
echo

if [ "$overall_status" -eq 0 ]; then
  echo "OVERALL: PASS"
else
  echo "OVERALL: FAIL"
fi

exit "$overall_status"
