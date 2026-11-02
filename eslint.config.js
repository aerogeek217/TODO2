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
    },
  },
])
