// ESLint flat config. Strict TypeScript + React Hooks rules.
// `npm run lint` runs `eslint . --max-warnings=0` so any warning fails CI.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: ['dist', 'dev-dist', 'coverage', 'node_modules'],
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
