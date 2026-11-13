import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedTaskList } from './fixtures/workspace'
import { readStores } from './fixtures/db'

/**
 * cr34 H2 / M10 / M11 in a real browser, through Settings › Import / Export ›
 * Import JSON:
 *
 * - a file whose layout the check rejects (a Number named past 80
 *   characters, as Name and icon… once wrote it; a tab whose id names an
 *   `Object.prototype` member) imports with that layout repaired and a
 *   warning that says what changed — it used to refuse the whole file —,
 *   and the workspace then draws it;
 * - a file whose layout holds far more parts than the app keeps is refused
 *   with a message, and nothing changes.
 */

const IMPORT_FILE = 'layouts.json'
const AT = '2026-11-01T09:00:00.000Z'
const LONG_NAME = `Waiting on ${'the regional leads '.repeat(8)}`.trim()
const FILTER = { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {} }
const area = (col: number, row: number) => ({ col, row, colSpan: 1, rowSpan: 1 })

const base = {
  __schemaVersion: 80,
  todos: [{ id: 1, uid: 'u-1', title: 'Imported task', isCompleted: false, sortOrder: 0, createdAt: AT, modifiedAt: AT }],
  settings: [{ key: 'activeLayoutId', value: '1' }],
}

const REPAIRABLE = {
  ...base,
  layouts: [{
    id: 1, name: 'Numbers', sortOrder: 0, createdAt: AT, modifiedAt: AT,
    grid: { columns: [{ id: 'c1', weight: 500 }, { id: 'c2', weight: 500 }], rows: [{ id: 'r1', weight: 1000 }] },
    cells: [
      { id: 'k1', area: area(0, 0), tabs: [{ id: 'n1', kind: 'number', config: { name: LONG_NAME, filter: FILTER, show: 'count', litWhen: 'never', compare: 'none' } }] },
      { id: 'k2', area: area(1, 0), tabs: [
        { id: 'constructor', kind: 'breakdown', config: { name: 'By person', filter: FILTER, splitBy: 'people', style: 'bars', show: 'count', showNone: true } },
        { id: 't2', kind: 'notes', config: {} },
      ] },
    ],
  }],
}

const OVERSIZED = {
  ...base,
  layouts: [{
    id: 1, name: 'Huge', sortOrder: 0, createdAt: AT, modifiedAt: AT,
    grid: { columns: Array.from({ length: 40_000 }, (_, i) => ({ id: `c${i}`, weight: 1 })), rows: [{ id: 'r', weight: 1 }] },
    cells: [{ id: 'k1', area: area(0, 0), tabs: [{ id: 't1', kind: 'notes', config: {} }] }],
  }],
}

/** Seeds a workspace, puts `file` where the file picker finds it and clicks Import JSON; returns the Settings dialog. */
async function importFile(page: Page, file: unknown) {
  await page.addInitScript((name) => {
    const handle = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await handle()], configurable: true })
  }, IMPORT_FILE)
  await seedTaskList(page, { tasks: [{ title: 'Before' }] })
  await page.evaluate(async ({ name, text }) => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
    const w = await handle.createWritable()
    await w.write(text)
    await w.close()
  }, { name: IMPORT_FILE, text: JSON.stringify(file) })
  const settings = await openSettings(page, 'Import / Export')
  await settings.getByRole('button', { name: 'Import JSON' }).click()
  return settings
}

test('a file with a layout the check rejects imports with the layout repaired and a warning; the workspace draws it', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const settings = await importFile(page, REPAIRABLE)
  await expect(settings.getByText('Imported successfully. Fixed 1 layout: "Numbers" (tab name shortened, tab dropped)')).toBeVisible()

  // What is stored is the repaired shape: the name cut to 80 characters (not reset), the oddly named tab gone.
  const { layouts, todos } = await readStores(page, ['layouts', 'todos'])
  expect(todos.map((t) => t.title)).toEqual(['Imported task'])
  expect(layouts).toHaveLength(1)
  const cells = layouts[0]!.cells as Array<{ id: string; tabs: Array<{ id: string; config: { name?: string } }> }>
  expect(cells.map((c) => c.tabs.map((t) => t.id))).toEqual([['n1'], ['t2']])
  expect(cells[0]!.tabs[0]!.config.name).toBe(LONG_NAME.slice(0, 80))

  // The workspace opens on it: the Number under its cut name, the Notes tab, no error screen and no repair notice.
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-number="n1"]')).toContainText(LONG_NAME.slice(0, 80))
  await expect(page.locator('[data-ws-tab="t2"]')).toBeVisible()
  await expect(page.getByText(/Repaired layout/)).toHaveCount(0)
  await expect(page.getByText(/failed to render|Something went wrong/i)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('a file whose layout holds far more parts than the app keeps is refused with a message; nothing changes', async ({ page }) => {
  const settings = await importFile(page, OVERSIZED)
  await expect(settings.getByText(
    'Import failed — Layout "Huge" holds too many parts to read: 40,003 columns, rows, cells and tabs. TODO2 reads at most 10,000 in one layout (and keeps 1,000 of each).',
  )).toBeVisible()
  const { todos, layouts } = await readStores(page, ['todos', 'layouts'])
  expect(todos.map((t) => t.title)).toEqual(['Before'])
  expect(layouts.map((l) => l.name)).not.toContain('Huge')
})
