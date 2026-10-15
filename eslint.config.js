import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.stryker-tmp/**', '**/reports/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // Core must stay framework-free; the boundary script enforces imports, this
    // catches reaching for runtime globals that tie it to Node or a browser.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-globals': ['error', 'process', 'Buffer', 'fetch', 'setTimeout', 'setInterval', 'window', 'document'],
    },
  },
);
