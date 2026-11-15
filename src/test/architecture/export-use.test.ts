import { describe, it, expect } from 'vitest'
import { exportUses, type ExportUse } from './export-graph'
import { TEST_SEAMS } from './test-seams'

/**
 * Every export of the app (`src/`, outside `src/test/`) is imported by
 * another of its files — the app's own, `scripts/` or a root config — or is
 * a test seam listed in `test-seams.ts` (only tests import it). An export
 * nothing imports is dead weight: un-export it (it stays a local) or delete
 * it. Imports are read from the source (`export-graph.ts`): static, type,
 * dynamic, `typeof import()`, re-exports and `export *` barrels.
 */

const key = (e: Pick<ExportUse, 'file' | 'name'>) => `${e.file.replace(/^src\//, '')} ${e.name}`

describe('the app’s exports', () => {
  const uses = exportUses()
  const seams = new Set(Object.entries(TEST_SEAMS).flatMap(([file, names]) => names.map((name) => `${file} ${name}`)))

  it('are each imported somewhere in the app, or listed as a test seam', () => {
    const unused = uses.filter((e) => e.app.length === 0 && !seams.has(key(e)))
    expect(unused.map((e) => `${key(e)}${e.tests.length > 0 ? ` (only tests: ${e.tests.length})` : ' (imported by nothing)'}`)).toEqual([])
  })

  it('lists only seams that still are ones: exported, imported by tests alone', () => {
    const byKey = new Map(uses.map((e) => [key(e), e]))
    const stale = [...seams].flatMap((k) => {
      const e = byKey.get(k)
      if (!e) return [`${k} (not exported any more)`]
      if (e.app.length > 0) return [`${k} (the app imports it: ${e.app[0]})`]
      if (e.tests.length === 0) return [`${k} (no test imports it)`]
      return []
    })
    expect(stale).toEqual([])
  })

  it('finds the imports it is meant to (a check of the reader itself)', () => {
    const find = (file: string, name: string) => uses.find((e) => e.file === file && e.name === name)
    // Through the `models/index.ts` barrel (`import type { … } from '../models'`).
    expect(find('src/models/index.ts', 'PersistedTodoItem')?.app.length).toBeGreaterThan(10)
    // A barrel's re-export uses its source's export.
    expect(find('src/models/todo-item.ts', 'PersistedTodoItem')?.app).toContain('src/models/index.ts')
    // A lazy route's `import('./views/…').then((m) => m.X)`.
    expect(find('src/views/SettingsPage.tsx', 'SettingsPage')?.app).toContain('src/App.tsx')
    // A test seam: tests only.
    expect(find('src/utils/module-reset.ts', 'resetModuleState')?.tests.length).toBeGreaterThan(0)
  })
})
