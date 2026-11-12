// ESLint flat config. The app (src/js/, test/browser/) is classic browser scripts that share state through the
// window.PP namespace; the server, tooling and the Node test suites are ES modules.
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      '**/*.tmp.mjs',
      'node_modules/',
      'src/vendor/',
      'dist/',
      'coverage/',
      'test-results/',
      'playwright-report/',
      'blob-report/',
      'desktop/bundle/',
    ],
  },
  js.configs.recommended,
  {
    files: ['src/js/**/*.js', 'test/browser/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, PP: 'readonly', PPTest: 'readonly' },
    },
    rules: {
      // `catch (e) { /* ignore */ }` and tool-interface params like (w, view) are the house style
      'no-unused-vars': ['error', { caughtErrors: 'none', args: 'none' }],
    },
  },
  {
    // feature-detected: the harness prefers setImmediate when it runs under Node
    files: ['test/browser/harness.js'],
    languageOptions: { globals: { setImmediate: 'readonly' } },
  },
  {
    files: ['**/*.mjs', '*.config.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // packaging (electron-builder's config and hooks) is CommonJS
    files: ['installer/**/*.cjs'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
  },
  {
    // Playwright specs run in Node but page.evaluate() callbacks run in the browser
    files: ['test/e2e/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // Vitest suites run in Node with jsdom's window globals
    files: ['test/unit/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: { ...globals.node, ...globals.browser } },
  },
  {
    // the Electron shell is CommonJS and runs in Electron's main process (Node)
    files: ['desktop/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'commonjs', globals: globals.node },
  },
];
