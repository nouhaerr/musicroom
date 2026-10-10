import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default defineConfig(
  { ignores: ['node_modules/**', 'generated/**', 'dist/**', 'coverage/**'] },
  {
    files: ['src/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true }],
    },
  },
  {
    files: ['*.cjs', '*.mjs', 'test/**/*.cjs', 'scripts/**/*.cjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
);
