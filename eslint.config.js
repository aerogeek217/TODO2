import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  // TEMPORARY lint ignores (cr1 P1, canvas replacement). Each entry is
  // removed by the phase that deletes or rewrites the file — never add a
  // file here to dodge a fix in code that survives.
  //
  // Retired by the replacement: non-trivial findings in files the canvas
  // replacement deletes outright.
  globalIgnores([
    'src/components/canvas/CanvasView.tsx',
    'src/components/canvas/ProjectNode.tsx',
    'src/components/canvas/SortableTaskList.tsx',
    'src/components/canvas/TaskboardNode.tsx',
    'src/components/taskboard/TaskboardPanel.tsx',
    'src/views/ListView.tsx',
  ]),
  // Survives, reshaped in cr3 P1 (rails → workspace): fixed there, not twice.
  globalIgnores([
    'src/components/canvas/rails/TabStrip.tsx',
    'src/components/canvas/rails/RailContainer.tsx',
    'src/components/canvas/rails/DockOverlay.tsx',
    'src/components/canvas/rails/DraggableSlot.tsx',
  ]),
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
        project: ['./tsconfig.app.json', './tsconfig.node.json', './tsconfig.e2e.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/test/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        project: null,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
])
