import { expect, test, type Page } from '@playwright/test'
import {
  enterLayoutEdit,
  expectLayoutStored,
  layoutTab,
  newestUndoStep,
  openCellLayoutMenu,
  openLayoutTab,
  pickSplit,
  seedWorkspace,
  wsCell,
  type WsLayoutSeed,
} from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The layout edit mode (layout edit mode E1) in a real browser: the layout tab menu’s Edit layout…
 * opens it — its bar in the top bar's place, the focus on Done, the
 * workspace tinted and each cell's content taking no presses; an edit (a
 * card menu's Split ▸ Below) changes only the draft; Cancel puts the
 * layout back and offers Restore, which brings the draft back; Done stores
 * it as one undo step, and the global Undo puts the layout back. Leaving
 * the layout with changes asks Save / Discard / Keep editing.
 */

const notesCalendar = (name: string): WsLayoutSeed => ({
  name,
  table: {
    areas: [`${name}-a ${name}-b`],
    cells: [
      { id: `${name}-a`, tabs: [{ id: `${name}-notes`, kind: 'notes' }] },
      { id: `${name}-b`, tabs: [{ id: `${name}-cal`, kind: 'calendar' }] },
    ],
  },
})

const bar = (page: Page) => page.locator('[data-layout-edit-bar]')
const barButton = (page: Page, name: string) => bar(page).getByRole('button', { name, exact: true })
const cellCount = (page: Page) => page.locator('[data-ws-table] [data-ws-cell]').count()

async function storedCells(page: Page, name: string): Promise<number> {
  const rows = await readStore<{ name: string; cells: unknown[] }>(page, 'layouts')
  return rows.find((r) => r.name === name)?.cells.length ?? -1
}

test('enter, split on the draft, Cancel, Restore, Done, then the global Undo', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar('Main')] })
  await enterLayoutEdit(page)

  // The mode: its bar, Done focused, the layouts' tabs shown but disabled, the workspace tinted.
  await expect(bar(page)).toBeVisible()
  await expect(bar(page)).toContainText('Editing “Main”')
  await expect(barButton(page, 'Done')).toBeFocused()
  await expect(layoutTab(page, 'Main')).toHaveAttribute('aria-disabled', 'true')
  await expect(page.locator('[data-ws-area][data-layout-editing]')).toHaveCount(1)
  await expect(page.getByRole('textbox', { name: 'Filter tasks' })).toHaveCount(0)
  // A cell's content takes no presses.
  const body = page.locator('[data-ws-cell-body="Main-a"]')
  await expect(body).toHaveCSS('pointer-events', 'none')

  // A card's menu acts on the draft: nothing stored, no global step.
  await openCellLayoutMenu(page, 'Main-a')
  await pickSplit(page, 'Below')
  await expect.poll(() => cellCount(page)).toBe(3)
  expect(await storedCells(page, 'Main')).toBe(2)
  expect(await newestUndoStep(page)).toBeNull()
  await expect(barButton(page, 'Undo')).toBeEnabled()

  // Cancel: the layout as stored, a snackbar offering Restore.
  await barButton(page, 'Cancel').click()
  await expect(bar(page)).toHaveCount(0)
  await expect.poll(() => cellCount(page)).toBe(2)
  const snackbar = page.locator('[data-snackbar-live]')
  await expect(snackbar).toContainText('Layout changes discarded')
  await snackbar.getByRole('button', { name: 'Restore' }).click()

  // Restore: the draft and its undo step back.
  await expect(bar(page)).toBeVisible()
  await expect.poll(() => cellCount(page)).toBe(3)
  await expect(barButton(page, 'Undo')).toBeEnabled()

  // Done: one write, one undo step.
  await barButton(page, 'Done').click()
  await expect(bar(page)).toHaveCount(0)
  await expect(snackbar).toContainText('Edited layout “Main”')
  await expectLayoutStored(page)
  await expect.poll(() => storedCells(page, 'Main')).toBe(3)
  await expect.poll(() => newestUndoStep(page)).toBe('Edited layout “Main”')

  // The global Undo puts the layout back.
  await snackbar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => cellCount(page)).toBe(2)
  await expect.poll(() => storedCells(page, 'Main')).toBe(2)
})

test('in the mode, Ctrl+Z steps its own undo and never a step behind it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar('Main')] })
  await enterLayoutEdit(page)
  await openCellLayoutMenu(page, 'Main-a')
  await pickSplit(page, 'Right')
  await expect.poll(() => cellCount(page)).toBe(3)
  await barButton(page, 'Done').focus()
  await page.keyboard.press('Control+z')
  await expect.poll(() => cellCount(page)).toBe(2)
  await page.keyboard.press('Control+y')
  await expect.poll(() => cellCount(page)).toBe(3)
  await page.keyboard.press('Control+z')
  // An empty stack: nothing more happens.
  await page.keyboard.press('Control+z')
  await expect.poll(() => cellCount(page)).toBe(2)
  await expect(bar(page)).toBeVisible()
  // Esc with no changes leaves; the focus back where it was (the layout tab menu's opener: the open layout's tab).
  await page.keyboard.press('Escape')
  await expect(bar(page)).toHaveCount(0)
  await expect(openLayoutTab(page)).toBeFocused()
})

test('a layout switch with changes asks: Keep editing stays, Save stores and switches', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar('Main'), notesCalendar('Second')] })
  await enterLayoutEdit(page)
  await openCellLayoutMenu(page, 'Main-b')
  await pickSplit(page, 'Below')
  await expect.poll(() => cellCount(page)).toBe(3)

  // The palette's Go to Layout › is a way out the disabled tabs aren't.
  const field = page.getByPlaceholder(/Find tasks, commands|Type to filter/)
  const goTo = async () => {
    await page.keyboard.press('Control+k')
    await expect(field).toBeFocused()
    await field.pressSequentially('go to lay')
    await expect(page.getByRole('listbox').getByRole('option').first()).toHaveText(/^Go to Layout/)
    await page.keyboard.press('Enter')
    await field.pressSequentially('Second')
    await page.keyboard.press('Enter')
  }
  await goTo()
  const question = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
  await expect(question).toBeVisible()
  await question.getByRole('button', { name: 'Keep editing' }).click()
  await expect(bar(page)).toBeVisible()
  await expect(bar(page)).toContainText('Editing “Main”')

  await goTo()
  await question.getByRole('button', { name: 'Save' }).click()
  await expect(bar(page)).toHaveCount(0)
  await expect(page.locator('[data-testid="layout-tab"][aria-selected="true"]')).toHaveText('Second')
  await expect.poll(() => storedCells(page, 'Main')).toBe(3)
  await expect(wsCell(page, 'Second-a')).toBeVisible()
})
