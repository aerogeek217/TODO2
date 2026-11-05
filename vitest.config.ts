import { readFileSync, readdirSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'

// Test files that replace modules with vi.mock / vi.doMock. A mocked module is
// cached by the worker, so sharing it would leak the fake (e.g. a pinned
// CURRENT_DB_VERSION) into later files — these keep a fresh worker per file.
// Every other file runs in a shared worker (isolate: false), which skips the
// per-file jsdom + import cost; src/test/setup-shared.ts resets the shared
// state at each file boundary. In both projects src/test/setup.ts resets the
// stores and module state before each test.
const MOCKING = readdirSync('src', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.test\.tsx?$/.test(f))
  .map((f) => `src/${f.replaceAll('\\', '/')}`)
  .filter((f) => /\bvi\.(mock|doMock)\(/.test(readFileSync(f, 'utf8')))
// Files whose database open is refused below the floor: the floor's upgrade
// throws, which leaves Dexie's in-memory schema of the shared `db` at the
// floor's tables, so every database it created later in the worker would
// lack the tables added since (v72's `statusUpdates`).
const REFUSED_OPEN = ['src/test/data/database-too-old.test.tsx']
const ISOLATED = [...MOCKING, ...REFUSED_OPEN]

// `.claude/` is gitignored tooling (agent worktrees hold whole checkouts): never test files here.
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Well above any test's own time (the slowest take ~1 s alone): a
    // loaded machine (the full suite beside a browser run) can make a heavy
    // test take several times as long, and a hang still fails.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // What `vi.useFakeTimers()` fakes when a test names nothing: vitest's own
    // default (every timer but nextTick / queueMicrotask) less setImmediate,
    // which fake-indexeddb runs every database step on. Faked, a database
    // open started under fake timers was dropped by useRealTimers and every
    // later database op in the file hung (cr31 tests 2.4). A test naming
    // its own `toFake` replaces this list.
    fakeTimers: {
      toFake: [
        'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date',
        'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback',
        'performance', 'hrtime', 'Intl', 'Temporal',
      ],
    },
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
