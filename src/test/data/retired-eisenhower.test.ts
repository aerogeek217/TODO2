import { describe, it, expect, beforeEach } from 'vitest'
import { db, CURRENT_DB_VERSION } from '../../data/database'
import { backupRepository } from '../../data/backup-repository'
import { buildExportData } from '../../data/export-data'
import { prepareImportText } from '../../data/import-pipeline'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { emptyPredicate } from '../../models/filter-predicate'
import type { LayoutTab } from '../../models/workspace-layout'
import { restoreBackup, restoreFromImport } from '../../services/replace-data'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { makeTodo, resetDb } from '../helpers'
import { cell, grid } from '../helpers/layout-builders'

/**
 * The Eisenhower was removed while the schema stayed at v78, so a database,
 * a backup, the sync file or an import may still hold its three parts: a
 * layout tab of kind `eisenhower`, its hidden list (`owner: { eisenhower:
 * true }`, with its manual order) and its settings rows (`eisenhowerPanes`,
 * `eisenhowerSource`). Every way in takes such data: the tab is dropped by
 * the layout repair, the list and the rows are carried as stored — never
 * shown, never offered, still exported. Schema v79 deletes them.
 */

const AT = '2026-11-01T09:00:00.000Z'
const RETIRED_TAB = { id: 'eis', kind: 'eisenhower', config: {}, viewState: { collapsed: ['drop'] } } as unknown as LayoutTab
const PANES = { key: 'eisenhowerPanes', value: JSON.stringify({ delegate: { name: 'Hand off' } }) }
const SOURCE = { key: 'eisenhowerSource', value: 'list:2' }
const RETIRED_LIST = {
  id: 2, name: 'Eisenhower', sortOrder: 1, sort: 'manual', grouping: 'none',
  membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { eisenhower: true },
}

/** A v78 file holding all three, beside a layout's own list. */
function v78File(): string {
  return JSON.stringify({
    [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
    todos: [makeTodo({ id: 1, title: 'Kept' })],
    settings: [{ key: 'activeLayoutId', value: '1' }, PANES, SOURCE],
    listDefinitions: [
      { id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: emptyPredicate() }, owner: { layoutId: 1 } },
      RETIRED_LIST,
    ],
    listOrders: [{ id: 1, listDefinitionId: 2, todoId: 1, rank: 1 }],
    layouts: [{
      id: 1, name: 'Main', sortOrder: 0, createdAt: AT, modifiedAt: AT,
      ...grid([[cell('k1', [{ id: 'mine', kind: 'lens', config: { listDefinitionId: 1 } }]), cell('k2', [RETIRED_TAB, { id: 'n', kind: 'notes', config: {} }])]]),
    }],
  })
}

/** What the app shows and what stays stored, after the data is in. */
async function expectRetiredPartsIgnoredAndKept(): Promise<void> {
  await useListDefinitionStore.getState().load()
  await useSettingsStore.getState().load()
  await useWorkspaceStore.getState().init()
  // Never shown or offered: no list of the Eisenhower's, no tab, nothing in the settings store.
  expect(useListDefinitionStore.getState().listDefinitions.map((d) => d.id)).toEqual([1])
  const tabs = useWorkspaceStore.getState().working!.cells.flatMap((k) => k.tabs)
  expect(tabs.map((t) => t.kind)).toEqual(['lens', 'notes'])
  expect(Object.keys(useSettingsStore.getState()).filter((k) => /eisenhower/i.test(k))).toEqual([])
  // Still stored, untouched, and still exported.
  expect(await db.listDefinitions.get(2)).toEqual(RETIRED_LIST)
  expect(await db.listOrders.where('listDefinitionId').equals(2).count()).toBe(1)
  expect(await db.settings.get('eisenhowerPanes')).toEqual(PANES)
  expect(await db.settings.get('eisenhowerSource')).toEqual(SOURCE)
  const exported = await buildExportData()
  expect(exported.listDefinitions?.find((d) => d.id === 2)).toEqual(RETIRED_LIST)
  expect(exported.settings.filter((r) => r.key.startsWith('eisenhower'))).toEqual(expect.arrayContaining([PANES, SOURCE]))
}

beforeEach(async () => {
  await resetDb()
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true)
})

describe('the retired Eisenhower’s stored parts', () => {
  it('an import takes a file holding all three: the tab dropped with a warning, the list and rows carried', async () => {
    const prepared = prepareImportText(v78File())
    if (!prepared.ok) throw new Error(prepared.error)
    expect(prepared.warnings).toEqual(['Fixed 1 layout: "Main" (tab dropped)'])
    expect(prepared.data.listDefinitions.map((d) => d.id)).toEqual([1, 2])
    expect(prepared.data.settings).toEqual(expect.arrayContaining([PANES, SOURCE]))
    expect(await restoreFromImport(prepared.data)).toMatchObject({ status: 'done' })
    await expectRetiredPartsIgnoredAndKept()
  })

  it('a backup holding them restores', async () => {
    const id = await backupRepository.createSnapshotFromJson(v78File(), 'manual')
    expect(await restoreBackup(id)).toMatchObject({ status: 'done' })
    await expectRetiredPartsIgnoredAndKept()
  })

  it('a database already holding them opens: the stored tab is left in its row until the layout’s first edit', async () => {
    const file = JSON.parse(v78File()) as Record<string, unknown[]>
    await db.settings.bulkPut(file.settings as never)
    await db.listDefinitions.bulkPut(file.listDefinitions as never)
    await db.listOrders.bulkPut(file.listOrders as never)
    await db.layouts.put({ ...(file.layouts![0] as object), createdAt: new Date(AT), modifiedAt: new Date(AT) } as never)
    await expectRetiredPartsIgnoredAndKept()
    const stored = await db.layouts.get(1)
    expect(stored!.cells.flatMap((k) => k.tabs).map((t) => t.id)).toContain('eis')
  })
})
