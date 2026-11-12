import { expect, test } from '@playwright/test'
import { openSettings, seedTaskList } from './fixtures/workspace'
import { readStores } from './fixtures/db'

/**
 * Schema v79 in a real browser: an export the deployed v78 build wrote —
 * holding an Eisenhower tab that empties its cell, the Eisenhower's hidden
 * list and settings rows, a Review widget's saved kind, pick and place, a
 * Breakdown's `badges` and `checkins`, a Number's config lens switch, a
 * Strips list tab — imported through Settings › Import / Export › Import
 * JSON arrives in the v79 shape: the app opens it with no repair notice and
 * stores none of the retired parts.
 */

const IMPORT_FILE = 'v78-export.json'
const AT = '2026-11-01T09:00:00.000Z'
const PRED = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
const area = (col: number, row: number) => ({ col, row, colSpan: 1, rowSpan: 1 })

const V78_FILE = {
  __schemaVersion: 78,
  todos: [{ id: 1, uid: 'u-1', title: 'Imported task', isCompleted: false, sortOrder: 0, createdAt: AT, modifiedAt: AT }],
  people: [{ id: 1, name: 'Aisha', initials: 'A' }],
  settings: [
    { key: 'activeLayoutId', value: '1' },
    { key: 'eisenhowerPanes', value: '{"do":{"name":"Now"}}' },
    { key: 'eisenhowerSource', value: 'list:2' },
    { key: 'rowDensity', value: 'strips' },
  ],
  listDefinitions: [
    { id: 1, name: 'Mine', sortOrder: 0, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: PRED }, owner: { layoutId: 1 } },
    { id: 2, name: 'Eisenhower', sortOrder: 1, sort: 'manual', grouping: 'none', membership: { kind: 'custom', predicate: PRED }, owner: { eisenhower: true } },
  ],
  listOrders: [{ id: 1, listDefinitionId: 2, todoId: 1, rank: 1 }],
  layouts: [{
    id: 1, name: 'Main', sortOrder: 0, createdAt: AT, modifiedAt: AT,
    grid: { columns: [{ id: 'c1', weight: 500 }, { id: 'c2', weight: 500 }], rows: [{ id: 'r1', weight: 500 }, { id: 'r2', weight: 500 }] },
    cells: [
      { id: 'k-list', area: area(0, 0), activeTabId: 'mine', tabs: [{ id: 'mine', kind: 'lens', config: { listDefinitionId: 1 }, viewState: { zoom: 'strips' } }] },
      { id: 'k-eis', area: area(1, 0), tabs: [{ id: 'eis', kind: 'eisenhower', config: {} }] },
      { id: 'k-review', area: area(0, 1), tabs: [{ id: 'rev', kind: 'review', config: { by: 'person', pick: { kind: 'person', id: 1 } }, viewState: { sort: 'due', currentId: 1 } }] },
      { id: 'k-charts', area: area(1, 1), activeTabId: 'bd', tabs: [
        { id: 'bd', kind: 'breakdown', config: { name: 'People', filter: PRED, splitBy: 'people', style: 'bars', show: 'count', showNone: true, checkins: true, badges: { due: 'overdue' } }, viewState: { sorts: { people: { by: 'overdue' } } } },
        { id: 'num', kind: 'number', config: { name: 'Open', filter: PRED, show: 'count', litWhen: 'never', compare: 'yesterday', ignoreLens: true } },
      ] },
    ],
  }],
}

test('a v78 export imported through Settings arrives in the v79 shape: no repair notice, none of the retired parts stored', async ({ page }) => {
  await page.addInitScript((name) => {
    const handle = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await handle()], configurable: true })
  }, IMPORT_FILE)
  await seedTaskList(page, { tasks: [{ title: 'Before' }] })
  await page.evaluate(async ({ name, text }) => {
    const file = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    const w = await file.createWritable()
    await w.write(text)
    await w.close()
  }, { name: IMPORT_FILE, text: JSON.stringify(V78_FILE) })

  const settings = await openSettings(page, 'Import / Export')
  await settings.getByRole('button', { name: 'Import JSON' }).click()
  // No warning: nothing was left for the layout repair.
  await expect(settings.getByText('Imported successfully!')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // The layout opens: the list and the Review widget; the Eisenhower's cell closed; no repair notice.
  await expect(page.locator('[data-ws-cell="k-list"]')).toBeVisible()
  await expect(page.getByTestId('review-empty')).toContainText('Pick who or what to review')
  await expect(page.locator('[data-ws-cell="k-eis"]')).toHaveCount(0)
  await expect(page.getByText(/Repaired layout|Fixed \d+ layout/)).toHaveCount(0)

  const { layouts, listDefinitions, listOrders, settings: rows } = await readStores(page, ['layouts', 'listDefinitions', 'listOrders', 'settings'])
  const layout = layouts[0] as { cells: Array<{ id: string; tabs: Array<Record<string, unknown>> }> }
  const tabs = Object.fromEntries(layout.cells.flatMap((c) => c.tabs).map((t) => [t.id as string, t]))
  expect(layout.cells.map((c) => c.id).sort()).toEqual(['k-charts', 'k-list', 'k-review'])
  expect(tabs.mine).toMatchObject({ viewState: { zoom: 'lines' } })
  expect(tabs.rev).toEqual({ id: 'rev', kind: 'review', config: {}, viewState: { sort: 'due' } })
  expect(tabs.bd!.config).not.toHaveProperty('badges')
  expect(tabs.bd!.config).not.toHaveProperty('checkins')
  expect((tabs.bd!.config as { columns: Array<{ id: string }> }).columns.map((c) => c.id)).toEqual(['due', 'followup'])
  expect(tabs.bd!.viewState).toEqual({ sorts: { people: { by: 'due' } } })
  expect(tabs.num).toMatchObject({ viewState: { ignoreLens: true } })
  expect(tabs.num!.config).not.toHaveProperty('ignoreLens')
  expect(listDefinitions.map((d) => d.id)).toEqual([1])
  expect(listOrders).toEqual([])
  const keys = rows.map((r) => r.key)
  expect(keys).not.toContain('eisenhowerPanes')
  expect(keys).not.toContain('eisenhowerSource')
  expect(rows.find((r) => r.key === 'rowDensity')).toEqual({ key: 'rowDensity', value: 'lines' })
})
