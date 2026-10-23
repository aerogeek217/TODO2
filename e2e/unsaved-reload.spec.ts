import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { expectOpenLayout, openLayoutAction, openSettings, seedTaskList, seedWorkspace, wsCell, wsListWidget, wsShape, wsTab, TASK_LIST_TAB, type WsLayoutSeed } from './fixtures/workspace'
import { createTab } from '../src/models/workspace-layout'
import { readStore } from './fixtures/db'

/**
 * Unsaved layout and list changes survive a reload — kept in the browser,
 * still shown unsaved — and go on save, discard or a data restore. Closing
 * the tab asks nothing while they are kept.
 */

test.use({ viewport: { width: 1280, height: 800 } })

const twoColumns: WsLayoutSeed = {
  name: 'Main',
  columns: [
    { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'eisTab', kind: 'eisenhower' }] }] },
    { id: 'colB', cells: [{ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar' }] }] },
  ],
}

const saveButton = (page: Page) => page.getByTestId('layout-save')

/** Whether the page's unload asks "Leave site?" (a `beforeunload` that prevents the default). */
function unloadAsks(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ev = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(ev)
    return ev.defaultPrevented
  })
}

async function closeEisenhower(page: Page) {
  await wsTab(page, 'eisTab').click()
  await wsTab(page, 'eisTab').getByRole('button', { name: 'Close Eisenhower' }).click()
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
}

test('an unsaved layout change survives a reload, still unsaved; Discard then forgets it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  await closeEisenhower(page)
  // Kept, so closing the tab doesn't ask.
  expect(await unloadAsks(page)).toBe(false)

  await page.reload()
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  // The stored layout never changed.
  const [stored] = await readStore<{ columns: unknown[] }>(page, 'layouts')
  expect(JSON.stringify(stored?.columns)).toContain('eisTab')

  await openLayoutAction(page, 'Discard changes')
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  await page.reload()
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
})

test('an unsaved new layout an older build kept still opens, after the saved tabs; its Save asks a name', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  // An older build's New layout wasn't stored until saved: it kept the
  // unsaved layout in the browser (stamped v68, the oldest version read).
  const tab = createTab('notes', 'keptNotes')
  await page.evaluate((columns) => {
    localStorage.setItem('todo2-unsaved-layout', JSON.stringify({ kind: 'new', name: 'Untitled layout', columns, listNames: {}, schemaVersion: 68 }))
  }, [{ id: 'kc', weight: 1, cells: [{ id: 'kk', weight: 1, activeTabId: tab.id, tabs: [tab] }] }])
  await page.reload()
  await expectOpenLayout(page, 'Untitled layout')
  await expect(page.getByTestId('layout-tab')).toHaveText(['Main', 'Untitled layout'])
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  await expect.poll(() => wsShape(page)).toEqual([[['keptNotes']]])

  await saveButton(page).click()
  const dialog = page.getByRole('dialog', { name: 'Save layout' })
  await expect(dialog.getByLabel('Name')).toHaveValue('Untitled layout')
  await dialog.getByLabel('Name').fill('Planning')
  await dialog.getByRole('button', { name: 'Save layout' }).click()
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  await expectOpenLayout(page, 'Planning')
  await page.reload()
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  await expectOpenLayout(page, 'Planning')
  await expect(page.getByTestId('layout-tab')).toHaveText(['Main', 'Planning'])
  await expect.poll(() => wsShape(page)).toEqual([[['keptNotes']]])
})

test('an unsaved list filter survives a reload, still unsaved; Save writes it', async ({ page }) => {
  await seedTaskList(page, {
    tasks: [{ title: 'Important one', important: true }, { title: 'Plain one' }],
  })
  // A screen filter shows the filter row (with its + Filter).
  await page.getByRole('button', { name: 'Show completed' }).click()
  const widget = wsListWidget(page, TASK_LIST_TAB)
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Priority' }).click()
  await page.getByTestId('list-filter-picker').getByRole('radiogroup', { name: 'Important', exact: true }).getByRole('radio', { name: 'Yes' }).click()
  await page.keyboard.press('Escape')
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toBeVisible()
  expect(await unloadAsks(page)).toBe(false)

  await page.reload()
  const after = wsListWidget(page, TASK_LIST_TAB)
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toBeVisible()
  await expect(after.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Important/)
  await expect.poll(() => rowTitles(after)).toEqual(['Important one'])

  await wsCell(page, 'cell').getByTestId('save-list').click()
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toHaveCount(0)
  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one'])
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toHaveCount(0)
})

test('a backup restore drops the kept changes: after a reload nothing is unsaved', async ({ page }) => {
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
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  await page.reload()
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab', 'eisTab']], [['calTab']]])
})

test('when the browser can’t keep them, closing the tab asks first', async ({ page }) => {
  await seedWorkspace(page, { layouts: [twoColumns] })
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException('full', 'QuotaExceededError') }
  })
  await closeEisenhower(page)
  expect(await unloadAsks(page)).toBe(true)
})

test('a backup restore drops a kept list change too', async ({ page }) => {
  await seedTaskList(page, { tasks: [{ title: 'Important one', important: true }, { title: 'Plain one' }] })
  const settings = await openSettings(page, 'Backups')
  await settings.getByRole('button', { name: 'Create Backup Now' }).click()
  await expect(settings.getByText('Backup created!')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  await page.getByRole('button', { name: 'Show completed' }).click()
  await wsListWidget(page, TASK_LIST_TAB).getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Priority' }).click()
  await page.getByTestId('list-filter-picker').getByRole('radiogroup', { name: 'Important', exact: true }).getByRole('radio', { name: 'Yes' }).click()
  await page.keyboard.press('Escape')
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toBeVisible()

  await openSettings(page, 'Backups')
  const manual = settings.locator('[data-trigger="manual"]')
  await manual.getByRole('button', { name: 'Restore' }).click()
  await manual.getByRole('button', { name: 'Confirm' }).click()
  await expect(settings.getByText('Restored successfully! The data it replaced was backed up first.')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toHaveCount(0)

  await page.reload()
  await expect.poll(() => rowTitles(wsListWidget(page, TASK_LIST_TAB))).toEqual(['Important one', 'Plain one'])
  await expect(wsCell(page, 'cell').getByTestId('save-list')).toHaveCount(0)
})
