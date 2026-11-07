import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A filter is Graphical (chips, ANDed) or a typed expression (schema v75).
 * In Edit list: Expression turns the chips into their text; typing writes
 * once it reads (an autocomplete pick for a status), a text that doesn't read
 * says why and writes nothing, Esc puts the written text back; Graphical over
 * an expression no chip says is locked (Edit expression / Clear), over a
 * plain `and` it is chips again. On the list's filter line an expression is
 * one chip that opens Edit list. A lens holding an expression filters every
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
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const sorted = async (page: Page) => (await rowTitles(wsListWidget(page, 't1'))).toSorted()

test.use({ viewport: { width: 1600, height: 900 } })

test('Edit list: type an expression with an autocomplete pick; an error writes nothing; Graphical locks it; the filter line shows it as one chip', async ({ page }) => {
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
  await expect(editList.getByRole('status')).toBeVisible()
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

  // Back to an or, then out of Edit list: the filter line holds it as one chip that opens Edit list.
  await editList.getByRole('radio', { name: 'Expression' }).click()
  await field.fill('@Ann or !Waiting')
  await field.blur()
  await expect.poll(() => sorted(page)).toEqual(['Ann active', 'Ann waiting', 'Bob waiting'])
  await page.keyboard.press('Escape')
  await expect(editList).toHaveCount(0)
  const chip = widget.getByTestId('list-filter-expression')
  await expect(chip).toContainText('@Ann or !Waiting')
  await chip.click()
  await expect(page.getByTestId('edit-list').getByRole('textbox', { name: 'Filter expression' })).toHaveValue('@Ann or !Waiting')
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
