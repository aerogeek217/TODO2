import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace } from './fixtures/workspace'
import { box } from './fixtures/geometry'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'

/**
 * The person / tag menu (Show tasks · Edit… · Delete…) on the person / tag
 * rows of the `@ #` popups in Quick Add and the notes editor: right-click or
 * Shift+F10 on the active row, nothing picked, the text and caret kept; Esc
 * closes only the menu; Edit… / Delete… stack above with the popup still open
 * and its rows updated. Focus and caret handoffs between the menu, the input
 * / CodeMirror and the dialogs need a real browser.
 */

const SEED = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] }] }] }],
  people: [{ name: 'Anna', initials: 'AN' }, { name: 'Andy Ross', initials: 'AR' }],
  tags: ['q4'],
  tasks: [{ title: 'Plan the offsite', people: ['Andy Ross'] }],
}

const popup = (page: Page) => page.locator('[data-nlp-popup]')

/** Whether the middle of `locator` is what the page shows on top there. */
async function isOnTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!top && el.contains(top)
  })
}

async function openQuickAdd(page: Page): Promise<Locator> {
  await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
  await page.keyboard.press('Control+Space')
  const input = page.getByRole('dialog', { name: 'Quick add task' }).getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return input
}

const caret = (input: Locator) => input.evaluate((el) => (el as HTMLInputElement).selectionStart)

test.describe('Quick Add', () => {
  test('a right-click on a person row opens the menu at the pointer; nothing picked; Esc leaves the popup, text and caret', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const input = await openQuickAdd(page)
    await page.keyboard.type('Call @an')
    await expect(popup(page).getByRole('option')).toHaveText(['@Anna', '@Andy Ross'])

    const andy = popup(page).getByRole('option', { name: '@Andy Ross' })
    const b = await box(andy)
    const at = { x: b.x + 30, y: b.y + b.height / 2 }
    await page.mouse.click(at.x, at.y, { button: 'right' })
    const menu = page.getByRole('menu', { name: '@Andy Ross' })
    // The bar is on the dialog tier: the task dialog couldn't show above it.
    await expect(menu.getByRole('menuitem')).toHaveText(['Edit…', 'Delete…'])
    const m = await box(menu)
    expect(Math.abs(m.x - at.x)).toBeLessThan(6)
    expect(Math.abs(m.y - at.y)).toBeLessThan(6)
    expect(await isOnTop(menu)).toBe(true)
    await expect(input).toHaveValue('Call @an')

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(popup(page)).toBeVisible()
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Call @an')
    expect(await caret(input)).toBe(8)

    // Shift+F10 on the active row (↓ → Andy Ross), under it.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Shift+F10')
    await expect(page.getByRole('menu', { name: '@Andy Ross' })).toBeVisible()
    expect((await box(page.getByRole('menu'))).y).toBeGreaterThanOrEqual(b.y + b.height - 1)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(input).toBeFocused()

    // Esc again is the popup's, then the bar's.
    await page.keyboard.press('Escape')
    await expect(popup(page)).toHaveCount(0)
    await expect(input).toHaveValue('Call @an')
  })

  test('Edit… opens the editor above the bar; the rename shows in the open popup; saving closes it, the bar keeps the text', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const input = await openQuickAdd(page)
    await page.keyboard.type('Call @an')
    await popup(page).getByRole('option', { name: '@Anna' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    const editor = page.getByRole('dialog', { name: 'People', exact: true })
    const name = editor.getByPlaceholder('Name')
    await expect(name).toHaveValue('Anna')
    expect(await isOnTop(name)).toBe(true)
    await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
    await name.fill('Annabel')
    await name.press('Enter')
    await expect(popup(page).getByRole('option', { name: '@Annabel' })).toBeAttached()
    // Saving the entry it opened on closes the editor.
    await expect(editor).toHaveCount(0)
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Call @an')
    await expect(popup(page).getByRole('option')).toHaveCount(2)
    await expect(popup(page).getByRole('option', { name: '@Annabel' })).toBeVisible()
  })

  test('Delete… asks above the bar; the person leaves the open popup', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const input = await openQuickAdd(page)
    await page.keyboard.type('@andy')
    await popup(page).getByRole('option', { name: '@Andy Ross' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Delete…' }).click()
    const confirm = page.getByRole('dialog', { name: 'Delete person' })
    await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
    expect(await isOnTop(confirm)).toBe(true)
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toHaveCount(0)
    await expect(popup(page).getByRole('option', { name: '@Andy Ross' })).toHaveCount(0)
    await expect(popup(page).getByRole('option')).toHaveText([/create @andy/])
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('@andy')
    expect((await readStore<{ name: string }>(page, 'people')).map((p) => p.name)).toEqual(['Anna'])
  })
})

test.describe('notes editor', () => {
  async function typeInNotes(page: Page, text: string): Promise<Locator> {
    await expect(page.getByRole('button', { name: 'People filter' })).toBeVisible()
    const editor = page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')
    await editor.click()
    await page.keyboard.type(text)
    return editor
  }

  test('right-click / Shift+F10 open the menu over the popup; Esc keeps the popup and the caret; Show tasks closes the popup', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const editor = await typeInNotes(page, '- Call @an')
    await expect(popup(page).getByRole('option')).toHaveText(['@Anna', '@Andy Ross'])
    await popup(page).getByRole('option', { name: '@Andy Ross' }).click({ button: 'right' })
    const menu = page.getByRole('menu', { name: '@Andy Ross' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Show tasks', 'Edit…', 'Delete…'])
    expect(await isOnTop(menu)).toBe(true)
    // The editor lost the focus to the menu; the popup stays.
    await expect(popup(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)
    await expect(popup(page)).toBeVisible()
    await expect(editor).toBeFocused()
    // The caret is where it was: typing narrows the same token.
    await page.keyboard.type('d')
    await expect(popup(page).getByRole('option')).toHaveText(['@Andy Ross'])
    await expect(editor.locator('.cm-line').first()).toHaveText('- Call @and')

    await page.keyboard.press('Shift+F10')
    await page.getByRole('menu', { name: '@Andy Ross' }).getByRole('menuitem', { name: 'Show tasks' }).click()
    await expect(popup(page)).toHaveCount(0)
    const dialog = page.locator('[data-task-dialog]')
    await expect(dialog.getByRole('heading')).toHaveText('Andy Ross')
    await expect(dialog.locator('[data-todo-id]')).toHaveCount(1)
    await expect(editor.locator('.cm-line').first()).toHaveText('- Call @and')
  })

  test('Edit… opens the editor above the popup; the rename shows in it; saving closes it and hands the caret back', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const editor = await typeInNotes(page, '- Call @an')
    await popup(page).getByRole('option', { name: '@Anna' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    const peopleEditor = page.getByRole('dialog', { name: 'People', exact: true })
    const name = peopleEditor.getByPlaceholder('Name')
    await expect(name).toBeFocused()
    expect(await isOnTop(name)).toBe(true)
    await expect(popup(page)).toBeVisible()
    expect(await isOnTop(popup(page))).toBe(false)
    await name.fill('Annabel')
    await name.press('Enter')
    await expect(popup(page).getByRole('option', { name: '@Annabel' })).toBeAttached()
    // Saving the entry it opened on closes the editor.
    await expect(peopleEditor).toHaveCount(0)
    await expect(editor).toBeFocused()
    await expect(popup(page)).toBeVisible()
    await page.keyboard.type('n')
    await expect(editor.locator('.cm-line').first()).toHaveText('- Call @ann')
    await expect(popup(page).getByRole('option')).toHaveText(['@Annabel'])
  })
})

test.describe('task row notes popover', () => {
  const ROW_SEED = {
    ...SEED,
    listDefinitions: [{ name: 'Everything' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'list', kind: 'lens' as const, listDefIdx: 0 }] }] }] }],
  }

  test('a click on Edit… in the person menu opens the editor; Esc and clicks in it leave the popover open', async ({ page }) => {
    await seedWorkspace(page, ROW_SEED)
    await taskRowByTitle(page, 'Plan the offsite').locator('[data-row-cell="notes"]').click()
    const notesPopover = page.getByRole('dialog', { name: 'Progress and notes' })
    await expect(notesPopover).toBeVisible()
    const editor = notesPopover.locator('.cm-content')
    await editor.click()
    await page.keyboard.type('- Call @an')
    await popup(page).getByRole('option', { name: '@Anna' }).click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit…' }).click()
    const peopleEditor = page.getByRole('dialog', { name: 'People', exact: true })
    await expect(peopleEditor.getByPlaceholder('Name')).toBeFocused()
    await expect(notesPopover).toBeVisible()

    // Esc in the editor's name field is the editor's (it cancels the edit).
    await page.keyboard.press('Escape')
    await expect(peopleEditor.getByPlaceholder('Name')).toHaveCount(0)
    await expect(notesPopover).toBeVisible()
    await peopleEditor.getByRole('button', { name: '×' }).first().click()
    await expect(peopleEditor).toHaveCount(0)
    await expect(notesPopover).toBeVisible()
    await expect(editor).toBeFocused()
    await expect(editor.locator('.cm-line').first()).toHaveText('- Call @an')
  })
})
