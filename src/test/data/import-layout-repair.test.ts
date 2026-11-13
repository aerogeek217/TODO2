import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db } from '../../data/database'
import { buildExportData, selfCheckExportJson } from '../../data/export-data'
import { prepareImportText } from '../../data/import-pipeline'
import { rowFixes, validateRow } from '../../data/import-validation'
import { layoutRepository } from '../../data/layout-repository'
import { restoreFromImportData } from '../../data/restore'
import type { WorkspaceLayout } from '../../models/workspace-layout'
import { makeTodo, resetDb } from '../helpers'
import { cell, numberTab, single } from '../helpers/layout-builders'

/**
 * One layout row the check rejects no longer takes the whole file with it
 * (cr34 H2, answer 20): an export, a backup and the sync file holding it
 * import with that layout repaired — as the database read and the audit
 * repair it — and the repaired shape is what is written.
 */

const AT = new Date('2026-11-12T09:00:00.000Z')

/** A Number named past the stored limit, as Name and icon… wrote it before the name was held to it (cr34 D1). */
const LONG_NAME = `Quarterly ${'review '.repeat(16)}follow-ups`

function layout(name: string, body: Pick<WorkspaceLayout, 'grid' | 'cells'>, sortOrder: number): WorkspaceLayout {
  return { name, sortOrder, ...body, createdAt: AT, modifiedAt: AT }
}

beforeEach(async () => {
  await resetDb()
})

describe('a stored layout the check rejects: export → import', () => {
  beforeEach(async () => {
    expect(LONG_NAME.length).toBeGreaterThan(80)
    expect(LONG_NAME.length).toBeLessThanOrEqual(200)
    await db.todos.add(makeTodo({ title: 'Kept task' }))
    await db.layouts.bulkAdd([
      layout('Numbers', single(cell('k', [numberTab('n1', 'open', { name: LONG_NAME }), numberTab('n2', 'overdue')])), 0),
      layout('Plain', single(cell('k', [{ id: 't', kind: 'notes', config: {} }])), 1),
    ])
  })

  it('the stored row is one the check rejects', async () => {
    const [bad, good] = await db.layouts.orderBy('id').toArray()
    expect(validateRow('layouts', bad)).toBe('cells[0].tabs[0].config.name')
    expect(validateRow('layouts', good)).toBe(true)
  })

  it('the export self-check passes: a backup of this data restores', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(selfCheckExportJson(JSON.stringify(await buildExportData()))).toBeNull()
    expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringMatching(/^\[import\] Fixed 1 layout: "Numbers" \(/)])
  })

  it('the file imports with a warning naming the layout, and the repaired shape is what is written', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = JSON.stringify(await buildExportData())
    const prepared = prepareImportText(json)
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toHaveLength(1)
    expect(prepared.warnings[0]).toMatch(/^Fixed 1 layout: "Numbers" \(/)

    await resetDb()
    await restoreFromImportData(prepared.data)
    const rows = await db.layouts.orderBy('id').toArray()
    expect(rows.map((r) => r.name)).toEqual(['Numbers', 'Plain'])
    for (const row of rows) {
      expect(validateRow('layouts', row)).toBe(true)
      expect(rowFixes('layouts', row)).toEqual([])
    }
    // Every tab is still there, and the task beside it.
    expect(rows[0]!.cells[0]!.tabs.map((t) => t.id)).toEqual(['n1', 'n2'])
    expect((await db.todos.toArray()).map((t) => t.title)).toEqual(['Kept task'])
    // Read back, nothing is left to repair: no notice, and view state saves again.
    expect((await layoutRepository.getAll()).map((r) => r.fixes)).toEqual([[], []])
    // What the import wrote exports clean: the next file has no warning.
    const again = prepareImportText(JSON.stringify(await buildExportData()))
    if (!again.ok) throw new Error(again.error)
    expect(again.warnings).toEqual([])
  })
})
