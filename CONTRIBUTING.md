# Contributing

Thanks for your interest in contributing.

## Getting started

1. Fork and clone the repository.
2. Install dependencies: `npm install` (or whatever the project uses).
3. Copy `.env.example` to `.env` and fill in values.
4. Run the verification stack: `bash scripts/verify.sh` — confirm a clean baseline.
5. Read `README.md` and the project's `.context/` files to understand
   conventions before writing code.

## Development workflow

This project uses an agent-assisted workflow. See `workflows/` for details.
The short version:

1. **Pick or open an issue** to scope the work.
2. **Branch** from `main` with a descriptive name.
3. **Make your changes**, following the patterns in `.context/patterns.md`.
4. **Run verify locally**: `bash scripts/verify.sh`
5. **Open a PR** using the template. Fill in every section honestly.
6. **Address review feedback** (automated reviewers and human reviewers).

## What to expect

- Multiple review gates: security, privacy, accessibility (where applicable),
  and human review.
- Verification must pass before merge.
- For changes touching auth, billing, personal data, or migrations: expect
  additional scrutiny per `constraints.md`.

## Code style

- Follow existing patterns. If you need a new pattern, propose it in your PR.
- Tests required for new behavior. The test-writer agent can help.
- Documentation updated in the same PR as code changes.

## Reporting issues

- **Bugs:** Use the bug report template.
- **Features:** Use the feature request template.
- **Security:** See `SECURITY.md` — do not file public issues for vulnerabilities.

## Code of Conduct

We expect contributors to:
- Be respectful
- Assume good faith
- Focus on the work
- Welcome diverse perspectives

Harassment, discrimination, and personal attacks are not acceptable. Report
violations to [contact].

## License

By contributing, you agree your contributions will be licensed under the
project's license (see `LICENSE`).
