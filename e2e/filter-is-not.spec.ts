import { expect, test, type Page } from '@playwright/test'
import { readListDefinitions, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'
import { rowTitles } from './fixtures/seed'

/**
 * Is / Is not on the People, Status and Tags filters: a toggle at the top of
 * each picker turns the ticked values into the ones hidden. In the top
 * bar's screen filter, a list's own filter (Edit list) and the phone's
 * Filters sheet.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Ann waiting', people: ['Ann'], status: 'Waiting' },
    { title: 'Bob task', people: ['Bob'] },
    { title: 'Nobody task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const ALL = ['Ann waiting', 'Bob task', 'Nobody task']
const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('top bar: Status is not Waiting hides the Waiting task; Is keeps the ticks; × clears it', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect.poll(() => titles(page)).toEqual(ALL)

    await page.getByRole('button', { name: 'Status filter' }).click()
    const mode = page.getByRole('radiogroup', { name: 'Status: is or is not' })
    await expect(mode.getByRole('radio', { name: 'Is', exact: true })).toHaveAttribute('aria-checked', 'true')
    await mode.getByRole('radio', { name: 'Is not' }).click()
    await expect(mode.getByRole('radio', { name: 'Is not' })).toHaveAttribute('aria-checked', 'true')
    // Nothing ticked yet: no filter.
    await expect.poll(() => titles(page)).toEqual(ALL)
    await page.locator('label', { hasText: 'Waiting' }).click()
    await expect.poll(() => titles(page)).toEqual(['Bob task', 'Nobody task'])

    // Is: the same tick now picks the Waiting task.
    await mode.getByRole('radio', { name: 'Is', exact: true }).click()
    await expect.poll(() => titles(page)).toEqual(['Ann waiting'])
    await mode.getByRole('radio', { name: 'Is not' }).click()
    await expect.poll(() => titles(page)).toEqual(['Bob task', 'Nobody task'])
    // The last tick removed: no filter, and the picker stays on Is not.
    const waitingRow = page.locator('label', { hasText: 'Waiting' })
    await waitingRow.click()
    await expect.poll(() => titles(page)).toEqual(ALL)
    await expect(mode.getByRole('radio', { name: 'Is not' })).toHaveAttribute('aria-checked', 'true')
    await expect(waitingRow.locator('span').first()).not.toHaveClass(/checked/)
    await waitingRow.click()
    await expect.poll(() => titles(page)).toEqual(['Bob task', 'Nobody task'])
    await page.keyboard.press('Escape')

    const button = page.getByRole('button', { name: 'Status filter: not Waiting' })
    await expect(button).toBeVisible()
    await button.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/Status: not Waiting\s*Hides tasks with that status/)
    // The list shows the screen filter as a chip.
    await expect(wsListWidget(page, 't1').getByText('not Waiting')).toBeVisible()

    await page.getByRole('button', { name: 'Clear status filter' }).click()
    await expect.poll(() => titles(page)).toEqual(ALL)
    // Cleared with its switch: the picker opens on Is.
    await page.getByRole('button', { name: 'Status filter' }).click()
    await expect(mode.getByRole('radio', { name: 'Is', exact: true })).toHaveAttribute('aria-checked', 'true')
  })

  test('Edit list: People is not Ann, saved, survives a reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsListWidget(page, 't1').getByTestId('list-summary').click()
    const editList = page.getByTestId('edit-list')
    await expect(editList).toBeVisible()
    await editList.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menuitem', { name: 'People' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radio', { name: 'Is not' }).click()
    await picker.locator('label', { hasText: '@Ann' }).click()
    await expect.poll(() => titles(page)).toEqual(['Bob task', 'Nobody task'])
    await expect(editList.getByTestId('list-filter-chip')).toHaveText(/People\s*not Ann/)
    await expect(editList.locator('[data-changed]')).toHaveText(['Filters'])
    // Esc closes the picker and Edit list (the draft is kept).
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await expect(editList).toHaveCount(0)

    // The list's filter line: the chip, whose tooltip spells it out.
    const chip = wsListWidget(page, 't1').getByTestId('list-filter-chip')
    await expect(chip).toHaveText(/People\s*not Ann/)
    await chip.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/People: not Ann\s*Hides tasks assigned to them/)
    const save = wsListWidget(page, 't1').getByTestId('save-list')
    await save.click()
    await expect(save).toHaveCount(0)
    const people = await readStore<{ id: number; name: string }>(page, 'people')
    const ann = people.find((p) => p.name === 'Ann')!.id
    await expect.poll(async () => ((await readListDefinitions(page))[0]?.membership as { predicate: unknown }).predicate)
      .toMatchObject({ personIds: [ann], negate: { personIds: true } })

    await page.reload()
    await expect.poll(() => titles(page)).toEqual(['Bob task', 'Nobody task'])
    await expect(wsListWidget(page, 't1').getByTestId('list-filter-chip')).toHaveText(/People\s*not Ann/)
    // Reopened, the picker is on Is not with Ann ticked.
    await wsListWidget(page, 't1').getByTestId('list-filter-chip').click()
    await expect(picker.getByRole('radio', { name: 'Is not' })).toHaveAttribute('aria-checked', 'true')
    // Is not Ann + Unassigned: only Bob's task.
    await picker.locator('label', { hasText: 'None' }).click()
    await expect.poll(() => titles(page)).toEqual(['Bob task'])
    // Is with the same ticks: the other two.
    await picker.getByRole('radio', { name: 'Is', exact: true }).click()
    await expect.poll(() => titles(page)).toEqual(['Ann waiting', 'Nobody task'])
  })
})

test.describe('narrow window', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('the folded Filters menu: People is not Bob', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('group', { name: 'Screen filters' }).getByRole('button', { name: 'People filter' }).click()
    await page.getByRole('radiogroup', { name: 'People: is or is not' }).getByRole('radio', { name: 'Is not' }).click()
    await page.locator('label', { hasText: '@Bob' }).click()
    await expect.poll(() => titles(page)).toEqual(['Ann waiting', 'Nobody task'])
    await expect(page.getByRole('group', { name: 'Screen filters' }).getByRole('button', { name: 'People filter: not Bob' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Filters, 1 active' })).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Filters sheet: Status is not Waiting', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const rows = page.locator('[data-todo-id]')
    await expect(rows).toHaveCount(3)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: 'Filters', exact: true }).click()
    const statusRow = page.getByText('Status', { exact: true })
    await statusRow.click()
    const mode = page.getByRole('radiogroup', { name: 'Status: is or is not' })
    const isNot = mode.getByRole('radio', { name: 'Is not' })
    expect((await isNot.boundingBox())!.height).toBeGreaterThanOrEqual(36)
    await isNot.click()
    await expect(isNot).toHaveAttribute('aria-checked', 'true')
    await expect(rows).toHaveCount(3)
    await page.getByText('Waiting', { exact: true }).click()
    await expect(rows).toHaveCount(2)
    await expect(statusRow.locator('..')).toContainText('not Waiting')
    // Is keeps the tick.
    await mode.getByRole('radio', { name: 'Is', exact: true }).click()
    await expect(rows).toHaveCount(1)
  })
})
