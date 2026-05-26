#!/usr/bin/env bash
# token-audit.sh — fail if UI code contains values that should come from design tokens.
#
# Catches:
#   - raw hex colors                (#abc, #aabbcc, #aabbccdd)
#   - raw rgb()/rgba()/hsl()/hsla() literals
#   - raw px / rem / em values in style props (rough heuristic)
#   - `outline: none` without an adjacent focus replacement
#   - `!important`
#
# Scope:
#   - Scans typical UI source dirs: src/, app/, components/, pages/, lib/, ui/, styles/
#   - Ignores: design-tokens.json, node_modules, .next, dist, build, coverage, .git
#   - Ignores: files matching '*.tokens.*', '*.theme.*', or under a 'tokens/' or 'theme/' dir
#
# Exit codes:
#   0 — clean
#   1 — violations found
#   2 — no UI source found (treated as pass, with a note)
#
# Override: set TOKEN_AUDIT_SKIP=1 to skip entirely.

set -uo pipefail

if [ "${TOKEN_AUDIT_SKIP:-0}" = "1" ]; then
  echo "token-audit: skipped (TOKEN_AUDIT_SKIP=1)"
  exit 0
fi

# Find candidate source dirs that exist
dirs=()
for d in src app components pages lib ui styles; do
  [ -d "$d" ] && dirs+=("$d")
done

if [ "${#dirs[@]}" -eq 0 ]; then
  echo "token-audit: no UI source dirs found — nothing to check"
  exit 0
fi

# File patterns we care about
include_globs=(
  "--include=*.css"
  "--include=*.scss"
  "--include=*.sass"
  "--include=*.less"
  "--include=*.ts"
  "--include=*.tsx"
  "--include=*.js"
  "--include=*.jsx"
  "--include=*.vue"
  "--include=*.svelte"
  "--include=*.html"
  "--include=*.astro"
)

# Files/dirs to exclude
exclude_args=(
  "--exclude-dir=node_modules"
  "--exclude-dir=.next"
  "--exclude-dir=dist"
  "--exclude-dir=build"
  "--exclude-dir=coverage"
  "--exclude-dir=.git"
  "--exclude-dir=tokens"
  "--exclude-dir=theme"
  "--exclude=*.tokens.*"
  "--exclude=*.theme.*"
  "--exclude=design-tokens.json"
  "--exclude=tailwind.config.*"
)

violations=0

check() {
  local label="$1"
  local pattern="$2"
  local matches
  # shellcheck disable=SC2068
  matches=$(grep -rEn ${include_globs[@]} ${exclude_args[@]} "$pattern" "${dirs[@]}" 2>/dev/null || true)
  if [ -n "$matches" ]; then
    echo
    echo "[FAIL] $label"
    echo "$matches" | sed 's/^/    /'
    local count
    count=$(echo "$matches" | wc -l | tr -d ' ')
    violations=$((violations + count))
  fi
}

# 1. Hex colors (3, 4, 6, or 8 hex digits)
check "raw hex color (use color tokens)" '#[0-9a-fA-F]{3,8}\b'

# 2. rgb()/rgba()/hsl()/hsla()
check "raw rgb/rgba/hsl/hsla literal (use color tokens)" '(rgb|rgba|hsl|hsla)\s*\('

# 3. `outline: none` (must have replacement — we can't tell here, so flag for review)
check "outline: none — replace with token-driven focus style" 'outline\s*:\s*(none|0)'

# 4. !important
check "!important — avoid; use specificity or token override" '!important'

# 5. Inline style props with literal px/rem (TSX/JSX heuristic)
#    Matches: style={{ fontSize: '14px' }} or padding: "1rem"
check "inline style with literal px/rem (use token)" "style\s*=\s*\{[^}]*['\"][0-9.]+(px|rem|em)['\"]"

echo

if [ "$violations" -gt 0 ]; then
  echo "token-audit: $violations violation(s). Fix or move values into design-tokens.json."
  exit 1
fi

echo "token-audit: clean"
exit 0
