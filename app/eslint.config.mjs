import js from '@eslint/js'
import { defineConfig, globalIgnores } from 'eslint/config'
import prettier from 'eslint-config-prettier/flat'
import hooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default defineConfig([
  globalIgnores(['dist/**', 'public/**', 'node_modules/**']),
  {
    files: ['src/**/*.{js,jsx,ts,tsx}', '*.mjs', '*.ts', 'scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-useless-assignment': 'warn',
      // Error.cause requires ES2022; app currently targets ES2020.
      'preserve-caught-error': 'warn',
    },
  },
  {
    files: ['src/**/*.{js,jsx,ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': hooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      // Existing effects need individual review; never auto-fix dependency arrays.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommended],
    rules: {
      // TypeScript resolves names (including type-only names); keep no-undef for JS.
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['*.mjs', '*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  prettier,
])
