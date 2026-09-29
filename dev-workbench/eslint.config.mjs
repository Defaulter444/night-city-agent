import js from '@eslint/js';
import globals from 'globals';
export default [
  { ignores: ['node_modules/**', '.tools/**', 'repos/**', 'dist/**', 'reports/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  { files: ['**/*.mjs'], languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] } }
];
