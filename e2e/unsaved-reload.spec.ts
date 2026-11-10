import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { ADD_FILTER, closeListFilterEditor, expectOpenLayout, openCellMenu, openListFilterEditor, openSettings, seedTaskList, seedWorkspace, wsListWidget, wsShape, wsTab, TASK_LIST_TAB, type WsLayoutSeed, wsRow, expectLayoutStep, expectLayoutStored } from './fixtures/workspace'
import { createTab } from '../src/models/workspace-layout'
import { readStore } from './fixtures/db'

/**
 * A layout change is saved at once (an undo step), and so is a list's —
 * Edit list's Save; an Edit list left open with changes is not kept for a
 * reload. A layout or list change an older build kept in the browser is
 * applied once at launch, one undo step each. Closing the tab never asks.
 */

test.use({ viewport: { width: 1280, height: 800 } })

const twoColumns: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'eisTab', kind: 'eisenhower' }] })] },
    { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] })] },
  ],
}


/** Whether the page's unload asks "Leave site?" (a `beforeunload` that prevents the default). */
function unloadAsks(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  })
}

/** Edit list (from the task list's line) › + Filter › Priority › Important; left open. */
async function addImportantFilter(page: Page) {
  const editor = await openListFilterEditor(page, wsListWidget(page, TASK_LIST_TAB))
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: 'Priority' }).click()
  await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Important' }).click()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('list-filter-picker')).toBeHidden()
}

async function closeEisenhower(page: Page) {
  await wsTab(page, 'eisTab').click()
  await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
  await expectLayoutStep(page, 'Closed tab “Eisenhower”')
}

test('a layout change is saved at once: closing the tab asks nothing, a reload keeps it, Undo puts it back', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  await closeEisenhower(page)
  expect(await unloadAsks(page)).toBe(false)
  const [stored] = await readStore<{ cells: unknown[] }>(page, 'layouts')
  expect(JSON.stringify(stored?.cells)).not.toContain('eisTab')
  expect(await page.evaluate(() => localStorage.getItem('todo2-unsaved-layout'))).toBeNull()

  await page.reload()
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])

  // Undo lasts until a reload: made again, then undone.
  await openCellMenu(page, 'b1')
  await page.getByRole('menuitem', { name: /^Close cell/ }).click()
  await expectLayoutStep(page, 'Closed cell “Calendar”')
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']]])
  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  await expectLayoutStored(page)
  await page.reload()
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
})

test('a layout change an older build kept unsaved is applied once at launch, as one undo step', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  const [row] = await readStore<{ id: number; grid: unknown; cells: Array<{ id: string; tabs: Array<{ id: string }> }> }>(page, 'layouts')
  // The older build's draft: the stored table as its base, the Eisenhower tab closed.
  const body = row!.cells.map((c) => ({ ...c, tabs: c.tabs.filter((t) => t.id !== 'eisTab'), activeTabId: c.tabs[0]?.id }))
  await page.evaluate(({ id, grid, cells, base }) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'saved', layoutId: id, grid, cells, baseGrid: grid, baseCells: base, schemaVersion: 78 }))
  }, { id: row!.id, grid: row!.grid, cells: body, base: row!.cells })
  await page.reload()
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  await expectLayoutStep(page, 'Applied unsaved changes to layout “Main”')
  expect(await page.evaluate(() => localStorage.getItem('todo2-unsaved-layout'))).toBeNull()
  const [stored] = await readStore<{ cells: unknown[] }>(page, 'layouts')
  expect(JSON.stringify(stored?.cells)).not.toContain('eisTab')

  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
  await expectLayoutStored(page)
  // Once: a reload applies nothing.
  await page.reload()
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
})

test('an unsaved new layout an older build kept becomes a stored layout, after the others, and opens', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  // An older build's New layout wasn't stored until saved: it kept the
  // unsaved layout in the browser (stamped v68, the oldest version read — in
  // its shape: a column's cells, read back as rows through v76).
  const tab = createTab('notes', 'keptNotes')
  await page.evaluate((columns) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'Untitled layout', columns, listNames: {}, schemaVersion: 68 }))
  }, [{ id: 'kc', weight: 1, cells: [{ id: 'kk', weight: 1, activeTabId: tab.id, tabs: [tab] }] }])
  await page.reload()
  await expectOpenLayout(page, 'Untitled layout')
  await expect(page.getByTestId('layout-tab')).toHaveText(['Main', 'Untitled layout'])
  await expect(page.getByText('Kept the unsaved new layout “Untitled layout”.')).toBeVisible()
  await expect.poll(() => wsShape(page)).toEqual([[['keptNotes']]])
  await expect.poll(async () => (await readStore(page, 'layouts')).length).toBe(2)
  await page.reload()
  await expectOpenLayout(page, 'Untitled layout')
  await expect(page.getByTestId('layout-tab')).toHaveText(['Main', 'Untitled layout'])
  await expect.poll(() => wsShape(page)).toEqual([[['keptNotes']]])
})

test('a list filter saved in Edit list survives a reload; an open Edit list’s changes are not kept', async ({ page }) => {
  await seedTaskList(page, {
    tasks: [{ title: 'Important one', important: true }, { title: 'Plain one' }],
  })
  const widget = wsListWidget(page, TASK_LIST_TAB)
  await addImportantFilter(page)
  // Left open, its changes drawn but not stored: a reload drops them, and asks nothing.
  await expect.poll(() => rowTitles(widget)).toEqual(['Important one'])
  expect(await unloadAsks(page)).toBe(false)
  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one', 'Plain one'])
  expect(await page.evaluate(() => localStorage.getItem('todo2-unsaved-lists'))).toBeNull()

  await addImportantFilter(page)
  await closeListFilterEditor(page)
  await expect(wsListWidget(page, TASK_LIST_TAB).getByTestId('list-filter-expression')).toContainText('Important')
  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one'])
})

test('a list change an older build kept unsaved is applied once at launch, as one undo step', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'Beta' }, { title: 'Alpha' }] })
  const [list] = await readStore<Record<string, unknown> & { id: number; name: string }>(page, 'listDefinitions')
  await page.evaluate((def) => {
    localStorage.setItem('todo2-unsaved-lists', JSON.stringify({ [def.id]: { draft: { ...def, sort: 'name' }, base: def, schemaVersion: 78 } }))
  }, list!)
  await page.reload()
  await expect(page.getByText(`Applied unsaved changes to list “${list!.name}”`)).toBeVisible()
  await expect.poll(async () => (await readStore<{ sort: string }>(page, 'listDefinitions'))[0]?.sort).toBe('name')
  expect(await page.evaluate(() => localStorage.getItem('todo2-unsaved-lists'))).toBeNull()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Alpha', 'Beta'])

  await page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await readStore<{ sort: string }>(page, 'listDefinitions'))[0]?.sort).toBe(list!.sort)
  // Once: a reload applies nothing.
  await page.reload()
  await expect.poll(async () => (await readStore<{ sort: string }>(page, 'listDefinitions'))[0]?.sort).toBe(list!.sort)
})

test('a backup restore brings back the layout as backed up, also after a reload', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  const settings = await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByText('Backup created!')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await closeEisenhower(page)
  await openSettings(page, 'Backups')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  await expect(settings.getByText('Restored successfully! The data it replaced was backed up first.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expectLayoutStored(page)

  await page.reload()
  await expectLayoutStored(page)
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
})

test('a layout change never asks on closing the tab, even when the browser can’t keep anything', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  })
  await closeEisenhower(page)
  expect(await unloadAsks(page)).toBe(false)
})

test('a backup restore brings back the list as backed up', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'Important one', important: true }, { title: 'Plain one' }] })
  const settings = await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByText('Backup created!')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await addImportantFilter(page)
  await closeListFilterEditor(page)
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one'])

  await openSettings(page, 'Backups')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  await expect(settings.getByText('Restored successfully! The data it replaced was backed up first.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one', 'Plain one'])

  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one', 'Plain one'])
})
