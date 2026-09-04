// ============================================================
//  A linter, at last.
//
//  The style in this repository is remarkably consistent — JSDoc on
//  anything with a decision in it, one idea per function, comments that say
//  why rather than what — and none of it was enforced by anything. There
//  was even an `// eslint-disable-next-line` in the tree for a linter that
//  was not installed.
//
//  So this is deliberately NOT a style police. Formatting is not what goes
//  wrong here; the two things that actually did go wrong in this codebase
//  are both correctness, and both are caught below:
//
//    - `no-shadow`. Wrapping the interface for translation collided with
//      eleven local variables called `t` — a share code, a transport, a
//      tool, an angle — and each one silently shadowed the translator.
//      Three of those were only found by a test, one by the build, and one
//      by a smoke check.
//
//    - `no-unused-vars`. Renaming across a codemod leaves these behind.
//
//  Everything else here is either a real bug pattern (`no-await-in-loop` is
//  a performance smell, `eqeqeq`, `no-return-assign`) or off.
// ============================================================

import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,

  {
    files: ['**/*.js', '**/*.cjs', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.es2023,
      },
    },
    rules: {
      // The one that would have caught the translator collisions.
      'no-shadow': 'error',
      'no-unused-vars': ['error', {
        // Arguments are NOT checked, deliberately. A family of methods that
        // share one signature — every `_gaitX(s, dt)` in the animator, every
        // `update(s, dt)` in the ZMF layer — is easier to read and safer to
        // extend when they all take the same two things whether or not this
        // particular one needs both. Variables and imports are a different
        // story: an unused one is either a leftover or a mistake.
        args: 'none',
        varsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-return-assign': 'error',
      'no-implicit-coercion': 'off',
      'no-console': 'off',           // the game reports its own failures
      'no-bitwise': 'off',           // this is a renderer
      'no-plusplus': 'off',
      'no-continue': 'off',
      'no-param-reassign': 'off',    // hot paths reuse their arguments
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },

  {
    // The shell and the tools run in Node, not in a page.
    files: ['electron/**/*.js', 'electron/**/*.cjs', 'tools/**/*.{js,mjs,cjs}', '*.config.js'],
    languageOptions: { globals: { ...globals.node } },
  },

  {
    files: ['tests/**/*.js', 'tests/**/*.cjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      // A test says the same thing three ways on purpose.
      'no-shadow': 'off',
    },
  },

  {
    ignores: ['dist/**', 'dist-stage/**', 'release/**', 'release2/**', 'node_modules/**', 'tools/dl/**'],
  },
];
