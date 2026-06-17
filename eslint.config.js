// ESLint flat config. Strict TypeScript + React Hooks rules.
// `npm run lint` runs `eslint . --max-warnings=0` so any warning fails CI.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    // `functions/lib/` is the tsc build output for the Cloud Functions
    // workspace — generated, never committed (`functions/.gitignore`
    // excludes it). Re-linting transpiled JS produces no-undef noise
    // (`Buffer`, `process`) since the browser-globals baseline applies.
    // `functions/node_modules` is the per-workspace install. The
    // Functions-workspace source itself is opted into node globals
    // further down in this config.
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'node_modules',
      'functions/lib',
      'functions/node_modules',
      // `.claude/` is the local Claude Code state directory (gitignored) — it
      // may contain leftover agent worktrees that re-mount the repo on disk.
      // Without this entry, eslint crawls every worktree and floods the run
      // with thousands of errors from copies of files it has already linted.
      '.claude',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // Test + node-tooling files: allow node globals.
    files: ['test/**/*.{ts,tsx}', '**/*.{test,spec}.{ts,tsx}', '*.config.{ts,js}'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Cloud Functions workspace source — runs on Node 22 in
    // `northamerica-northeast1`, NOT in the browser. Needs node globals
    // (`Buffer`, `process`) and the Functions runtime context. The
    // workspace also typechecks via `cd functions && npx tsc --noEmit`
    // before deploy (deploy.yml's deploy-functions job builds the
    // workspace and runs its own vitest before pushing).
    files: ['functions/src/**/*.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
  {
    // Node tooling scripts under scripts/ — CommonJS .cjs files (verifier
    // gates run via `node scripts/<x>.cjs`). They need node globals AND
    // permission to use require() / __dirname (no-undef +
    // no-require-imports would otherwise flag them). Also covers the
    // project-root .cjs config files like lighthouserc.cjs.
    files: ['scripts/**/*.{cjs,js}', '*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
