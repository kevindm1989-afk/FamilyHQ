# Common project commands. Customize per project.
#
# Usage: `make` shows available targets. `make <target>` runs that target.
#
# This is a TEMPLATE. Remove targets that don't apply; add ones specific to
# your stack. The point is one command per common task.

.PHONY: help install dev test verify ship lint format clean

# Default target
help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nUsage:\n  make \033[36m<target>\033[0m\n\nTargets:\n"} /^[a-zA-Z_-]+:.*?##/ { printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)

install: ## Install dependencies
	@# npm install / pnpm install / pip install / etc.
	@echo "Override: customize install for your stack"

dev: ## Run the dev server
	@# npm run dev / python -m flask run / etc.
	@echo "Override: customize dev for your stack"

test: ## Run tests
	@# Customize for your test runner
	@bash scripts/verify.sh

verify: ## Run the full verification gate stack
	@bash scripts/verify.sh

lint: ## Run linter only (faster than full verify)
	@# Customize for your stack
	@echo "Override: customize lint for your stack"

format: ## Auto-fix formatting
	@# prettier --write / ruff format / etc.
	@echo "Override: customize format for your stack"

ship: verify ## Run verify and prepare for deploy (does not deploy)
	@echo "All gates passed. Ready to merge / deploy via CI."

clean: ## Remove build artifacts and caches
	@# Customize for your stack
	@rm -rf dist/ build/ .turbo/ node_modules/.cache/ .pytest_cache/ 2>/dev/null || true
	@echo "Cleaned build artifacts"

# Add project-specific targets below.

# Example:
# migrate: ## Run pending database migrations
# 	@npm run db:migrate

# Example:
# seed: ## Seed the dev database with sample data
# 	@npm run db:seed
