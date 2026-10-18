import { readFileSync, readdirSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'

// Test files that replace modules with vi.mock / vi.doMock. A mocked module is
// cached by the worker, so sharing it would leak the fake (e.g. a pinned
// CURRENT_DB_VERSION) into later files — these keep a fresh worker per file.
// Every other file runs in a shared worker (isolate: false), which skips the
// per-file jsdom + import cost; src/test/setup-shared.ts resets the shared
// state at each file boundary. In both projects src/test/setup.ts resets the
// stores and module state before each test.
const ISOLATED = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => `src/${f.replaceAll('\\', '/')}`)
  .filter((f) => /\bvi\.(mock|doMock)\(/.test(readFileSync(f, 'utf8')))

// `.claude/` is gitignored tooling (agent worktrees hold whole checkouts): never test files here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**'],
    coverage: {
      provider: 'v8',
      exclude: ['src/test/**'],
    },
    projects: [
      {
        extends: true,
        test: { name: 'isolated', include: ISOLATED, isolate: true },
      },
      {
        extends: true,
        test: {
          name: 'shared',
          exclude: [...configDefaults.exclude, 'e2e/**', '.claude/**', ...ISOLATED],
          setupFiles: ['./src/test/setup-shared.ts'],
          isolate: false,
        },
      },
    ],
  },
})
