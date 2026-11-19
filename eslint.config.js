import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// TODO2 is local-first: the app makes no network request. Its data moves
// through IndexedDB, the File System Access API, file inputs and downloads;
// the offline build's egress check and e2e/built-csp.spec.ts enforce it on
// the built file, this on the source.
const LOCAL_FIRST = 'TODO2 is local-first and makes no network request (CLAUDE.md › Constraints): keep data in IndexedDB, the sync file, imports and downloads.'
const NETWORK_GLOBALS = ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'RTCPeerConnection', 'webkitRTCPeerConnection', 'WebTransport', 'Worker', 'SharedWorker', 'importScripts', 'open']
const GLOBAL_OBJECTS = ['window', 'globalThis', 'self']
// No markup is parsed from a string in the app: text renders as React text,
// a node is built as elements (cr31 security I2). The check-in preview's
// sandboxed `srcDoc` is the one HTML document, built with `escapeHtml`.
const NO_HTML_SINK = 'Build the nodes (React, or createElement / createElementNS) instead of parsing markup from a string.'
const HTML_SINKS = [
  { selector: "AssignmentExpression > MemberExpression.left[property.name=/^(innerHTML|outerHTML)$/]", message: NO_HTML_SINK },
  { selector: "CallExpression[callee.property.name=/^(insertAdjacentHTML|createContextualFragment|setHTMLUnsafe)$/]", message: NO_HTML_SINK },
  { selector: "CallExpression[callee.object.name='document'][callee.property.name=/^write(ln)?$/]", message: NO_HTML_SINK },
  { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: NO_HTML_SINK },
]

// One tooltip everywhere (flair P9): an element's hover text is the app's
// tooltip — `data-tooltip` (read by `TooltipHost`) or `useTooltip` — never
// the browser's native `title`, which waits and looks different. (An
// iframe's `title` is its accessible name, not a tooltip: allowed.)
const NO_NATIVE_TITLE = 'Use data-tooltip (TooltipHost) or useTooltip instead of the native title attribute; give an icon-only control an aria-label.'
const NATIVE_TITLE = { selector: "JSXOpeningElement[name.type='JSXIdentifier'][name.name=/^(?!iframe$)[a-z]/] > JSXAttribute[name.name='title']", message: NO_NATIVE_TITLE }

// One × everywhere: a pill's remove, a field's clear, a small dismiss draw
// `RemoveButton`, a dialog's or panel's close `DialogCloseButton` — the
// icon, centred, with a name. The text character sits off-centre in its
// line box. Caught: JSX text, or an expression, that is only the
// character (a label such as `People × Status` reads it as a word).
const NO_TEXT_TIMES = 'Draw a × with RemoveButton (a pill, a field, a dismiss) or DialogCloseButton (a dialog, popover or panel), not the text character: it sits off-centre.'
const TEXT_TIMES = [
  { selector: 'JSXText[value=/^\\s*(×|&times;|&#215;|&#x[dD]7;)\\s*$/]', message: NO_TEXT_TIMES },
  { selector: 'JSXExpressionContainer > Literal[value=/^\\s*×\\s*$/]', message: NO_TEXT_TIMES },
]

export default defineConfig([
  // `.claude/` is gitignored tooling (agent worktrees hold whole checkouts of
  // the repo), not this checkout's code.
  globalIgnores(['dist', '.claude']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.test.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // The app's code; tests may stub these.
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/test/**'],
    rules: {
      'no-restricted-globals': ['error', ...NETWORK_GLOBALS.map((name) => ({ name, message: LOCAL_FIRST }))],
      'no-restricted-properties': ['error',
        ...GLOBAL_OBJECTS.flatMap((object) => NETWORK_GLOBALS.map((property) => ({ object, property, message: LOCAL_FIRST }))),
        ...['sendBeacon', 'serviceWorker'].map((property) => ({ object: 'navigator', property, message: LOCAL_FIRST })),
      ],
      'no-restricted-syntax': ['error', ...HTML_SINKS, NATIVE_TITLE],
    },
  },
  {
    // The components: as above, and no text ×.
    files: ['src/components/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...HTML_SINKS, NATIVE_TITLE, ...TEXT_TIMES],
    },
  },
])
