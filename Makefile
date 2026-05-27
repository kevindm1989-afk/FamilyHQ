# Family HQ — common project commands.
#
# Usage: `make` shows available targets. `make <target>` runs that target.

.PHONY: help install dev build preview test test-rules verify ship lint format typecheck clean emulators

# Default target
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install dependencies (reproducible)
	@npm ci

dev: ## Run the Vite dev server
	@npm run dev

build: ## Type-check and build the production bundle
	@npm run build

preview: ## Preview the production build locally
	@npm run preview

lint: ## Run ESLint (no warnings allowed)
	@npm run lint

format: ## Auto-fix formatting with Prettier
	@npm run format

typecheck: ## Run the TypeScript type checker
	@npm run typecheck

test: ## Run unit/component tests (vitest)
	@npm test

test-rules: ## Run firestore.rules tests against the Firestore emulator
	@npx firebase emulators:exec --only firestore "npm run test:rules"

emulators: ## Start the Firebase emulator suite (Auth + Firestore)
	@npx firebase emulators:start --only auth,firestore

verify: ## Run the full verification gate stack
	@bash scripts/verify.sh

ship: verify ## Run verify and prepare for deploy (does not deploy)
	@echo "All gates passed. Ready to merge / deploy via CI."

clean: ## Remove build artifacts and caches
	@rm -rf dist/ dev-dist/ coverage/ node_modules/.cache/ .firebase/ 2>/dev/null || true
	@echo "Cleaned build artifacts"
