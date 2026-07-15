import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    files: ['**/*.ts'],
    rules: {
      // C62: no console outside the CLI renderer
      'no-console': 'error',
      // Doc 23 import conventions
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // The CLI adapter is the human renderer — console is its output device (C62 exemption).
    files: ['packages/keel/src/cli/**'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Tests may report metrics (e.g. eval-corpus precision/recall, Doc 07 §5).
    files: ['packages/**/__tests__/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Operational scripts (Doc 03) and plain-JS test fixtures: Node ESM with runtime globals.
    files: ['scripts/**/*.mjs', 'packages/**/__tests__/fixtures/**/*.mjs', 'examples/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
      },
    },
  },
  {
    // Tool configs that must be CommonJS (dependency-cruiser).
    files: ['**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
      },
    },
  },
);
