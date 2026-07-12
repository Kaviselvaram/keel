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
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
