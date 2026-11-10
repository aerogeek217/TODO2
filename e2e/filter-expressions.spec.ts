import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * A filter is Graphical (chips, ANDed) or a typed expression (schema v75).
 * In Edit list: Expression turns the chips into their text; typing writes
 * once it reads (an autocomplete pick for a status), a text that doesn't read
 * says why and writes nothing, Esc puts the written text back; Graphical over
 * an expression no chip says is locked (Edit expression / Clear), over a
 * plain `and` it is chips again. On the list's filter line an expression
 * reads in words and opens Edit list. A lens holding an expression filters every
 * list under the top bar.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  statuses: ['Waiting', 'Active'],
  listDefinitions: [{ name: 'Team', people: ['Ann'] }],
  tasks: [
    { title: 'Ann waiting', people: ['Ann'], status: 'Waiting' },
    { title: 'Ann active', people: ['Ann'], status: 'Active' },
    { title: 'Bob waiting', people: ['Bob'], status: 'Waiting' },
    { title: 'Bob urgent', people: ['Bob'], urgent: true },
    { title: 'Focus plain', focus: true },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

const sorted = async (page: Page) => (await rowTitles(wsListWidget(page, 't1'))).toSorted()

test.use({ viewport: { width: 1600, height: 900 } })

test('Edit list: type an expression with an autocomplete pick; an error writes nothing; Graphical locks it; the filter line reads it in words', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting'])
  const widget = wsListWidget(page, 't1')
  await widget.getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')

  // Expression reads the chips as their text.
  await editList.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editList.getByRole('textbox', { name: 'Filter expression' })
  await expect(field).toHaveValue('@Ann')

  // `!Wa` offers the status; Tab picks it.
  await field.press('End')
  await field.pressSequentially(' or !Wa')
  const popup = page.getByRole('listbox')
  await expect(popup.getByRole('option', { name: /Waiting/ })).toBeVisible()
  await field.press('Tab')
  await expect(field).toHaveValue(/^@Ann or !Waiting\s*$/)
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob waiting'])
  await expect(editList.getByTestId('expression-reads-as')).toBeVisible()

  // A text that doesn't read says why and writes nothing; Esc puts the written text back.
  await field.press('End')
  await field.pressSequentially(' and (')
  await expect(editList.getByTestId('expression-error')).toBeVisible()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob waiting'])
  await field.press('Escape')
  await expect(field).toHaveValue('@Ann or !Waiting')
  await expect(editList).toBeVisible()

  // Graphical can't say an or: locked, until edited or cleared.
  await editList.getByRole('radio', { name: 'Graphical' }).click()
  const locked = editList.getByTestId('expression-locked')
  await expect(locked).toContainText('@Ann or !Waiting')
  await locked.getByRole('button', { name: 'Edit expression' }).click()
  await expect(field).toHaveValue('@Ann or !Waiting')

  // A plain `and` is chips again.
  await field.fill('@Bob and /urgent')
  await field.blur()
  await expect.poll(() => sorted(page)).toEqual(['Bob urgent'])
  await editList.getByRole('radio', { name: 'Graphical' }).click()
  await expect(editList.getByTestId('list-filter-chip')).toHaveText([/Priority\s*Urgent/, /People\s*Bob/])

  // Back to an or, then out of Edit list: the filter line reads it in words and opens Edit list.
  await editList.getByRole('radio', { name: 'Expression' }).click()
  await field.fill('@Ann or !Waiting')
  await field.blur()
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob waiting'])
  await editList.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editList).toHaveCount(0)
  const chip = widget.getByTestId('list-filter-expression')
  await expect(chip).toHaveText('Ann, or Waiting')
  await chip.click()
  await expect(page.getByTestId('edit-list').getByRole('textbox', { name: 'Filter expression' })).toHaveValue('@Ann or !Waiting')
})

test('Edit list: a text that doesn’t read holds the first close, saying so, and the next drops it; the focus never falls to the page (cr33 U5, U6)', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting'])
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  await editList.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editList.getByRole('textbox', { name: 'Filter expression' })
  await expect(field).toBeFocused()

  // An or Graphical can't say: locked; Edit expression goes back into the field.
  await field.fill('@Ann or !Waiting')
  await field.blur()
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob waiting'])
  await editList.getByRole('radio', { name: 'Graphical' }).click()
  await editList.getByTestId('expression-locked').getByRole('button', { name: 'Edit expression' }).click()
  await expect(field).toBeFocused()

  // A text that doesn't read: the first close is held, saying so; the second closes, the filter as it last read.
  await field.press('End')
  await field.pressSequentially(' and (')
  const close = editList.getByRole('button', { name: 'Close Edit list' })
  await close.click()
  await expect(editList).toBeVisible()
  await expect(editList.getByTestId('expression-error')).toContainText('close again to drop it')
  await expect(field).toBeFocused()
  // The second close drops the text; the list has changes, so it asks — Save keeps the filter as it last read.
  await close.click()
  await page.getByRole('dialog', { name: /^Save changes to list/ }).getByRole('button', { name: 'Save', exact: true }).click()
  await expect(editList).toHaveCount(0)
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob waiting'])

  // Clear and use Graphical leaves the focus on + Filter.
  await wsListWidget(page, 't1').getByTestId('list-filter-expression').click()
  await page.getByTestId('edit-list').getByRole('radio', { name: 'Graphical' }).click()
  await page.getByTestId('edit-list').getByRole('button', { name: 'Clear and use Graphical' }).click()
  await expect(page.getByTestId('edit-list').getByRole('button', { name: /Filter/ })).toBeFocused()
})

/** Whether the page goes idle within `ms`: a render loop keeps the main thread busy, so its idle callback only times out. */
const goesIdle = (page: Page, ms: number) => page.evaluate((timeout) => new Promise<boolean>((resolve) => {
  requestIdleCallback((deadline) => resolve(!deadline.didTimeout), { timeout })
}), ms)

test('the field settles while its popup is open: no render loop (cr33 wave 2)', async ({ page }) => {
  // The popup's compute was a new function each render, and the popup re-reads its text whenever that changes.
  await page.addInitScript(() => {
    const w = window as unknown as { measured: number }
    w.measured = 0
    const measure = CanvasRenderingContext2D.prototype.measureText
    CanvasRenderingContext2D.prototype.measureText = function (text: string) {
      w.measured++
      return measure.call(this, text)
    }
  })
  await seedWorkspace(page, SEED)
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting'])
  await wsListWidget(page, 't1').getByTestId('list-summary').click()
  const editList = page.getByTestId('edit-list')
  await editList.getByRole('radiogroup', { name: 'Filter mode' }).getByRole('radio', { name: 'Expression' }).click()
  const field = editList.getByRole('textbox', { name: 'Filter expression' })
  await field.press('End')
  await field.pressSequentially(' and /fo')
  await expect(page.getByRole('listbox').getByRole('option', { name: /Focus/ })).toBeVisible()
  expect(await goesIdle(page, 3000)).toBe(true)
  // Idle, the popup measures its anchor no more.
  const measured = () => page.evaluate(() => (window as unknown as { measured: number }).measured)
  const before = await measured()
  expect(await goesIdle(page, 3000)).toBe(true)
  expect(await measured()).toBe(before)
  await field.press('Tab')
  await expect(field).toHaveValue(/^@Ann and \/focus\s*$/)
})

test('a lens holding an expression filters the lists under the top bar', async ({ page }) => {
  await seedWorkspace(page, {
    ...SEED,
    listDefinitions: [{ name: 'Everything' }],
    // Status 1 is Waiting.
    lenses: [{ id: 'wf', name: 'Waiting or focus', predicate: { expression: { kind: 'or', items: [{ kind: 'status', id: 1 }, { kind: 'priority', value: 'focus' }] } } }],
  })
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob urgent', 'Bob waiting', 'Focus plain'])
  const header = page.locator('header')
  await header.getByRole('button', { name: /^Lens:/ }).click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Waiting or focus/ }).click()
  await expect.poll(() => sorted(page)).toEqual(['Ann waiting', 'Bob waiting', 'Focus plain'])
  const tray = header.getByRole('group', { name: 'Screen filters — apply to every widget' })
  await expect(tray.getByRole('button', { name: /^3 of 5 open tasks shown/ })).toBeVisible()
})
