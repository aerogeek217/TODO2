import { expect, test, type Page } from '@playwright/test'
import { readListDefinitions, seedWorkspace, withSpareLayouts, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * Priority Yes / No / Any per marker: each marker's three-way control in the
 * Priority picker — the top bar's screen filter, a list's own filter (Edit
 * list) and the phone's Filters sheet. Urgent is effective urgent, so
 * Urgent No also leaves out a task urgent only by its due date.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Flagged urgent', urgent: true },
    { title: 'Due tomorrow', dueInDays: 1 },
    { title: 'Important only', important: true },
    { title: 'Plain' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const ALL = ['Flagged urgent', 'Due tomorrow', 'Important only', 'Plain']
const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const sorted = async (page: Page) => (await titles(page)).toSorted()

/** A marker's Any / Yes / No segment. */
function choice(page: Page, marker: string, label: 'Any' | 'Yes' | 'No') {
  return page.getByRole('radiogroup', { name: marker, exact: true }).getByRole('radio', { name: label, exact: true })
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('top bar: Priority › Urgent No hides flagged and due-soon tasks; Yes keeps only them; Any clears', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect.poll(() => sorted(page)).toEqual(ALL.toSorted())

    await page.getByRole('button', { name: 'Priority filter' }).click()
    await expect(choice(page, 'Urgent', 'Any')).toHaveAttribute('aria-checked', 'true')
    await choice(page, 'Urgent', 'No').click()
    await expect(choice(page, 'Urgent', 'No')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => sorted(page)).toEqual(['Important only', 'Plain'])
    // The picker stays open: Important No too (AND).
    await choice(page, 'Important', 'No').click()
    await expect.poll(() => titles(page)).toEqual(['Plain'])
    await choice(page, 'Important', 'Any').click()

    // Arrow keys move between the segments: No → Any → Yes.
    await choice(page, 'Urgent', 'No').focus()
    await page.keyboard.press('ArrowRight')
    await expect(choice(page, 'Urgent', 'Any')).toBeFocused()
    await page.keyboard.press('ArrowRight')
    await expect(choice(page, 'Urgent', 'Yes')).toHaveAttribute('aria-checked', 'true')
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent'])
    await page.keyboard.press('ArrowRight')
    await expect(choice(page, 'Urgent', 'No')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')

    const button = page.getByRole('button', { name: 'Priority filter: not Urgent' })
    await expect(button).toBeVisible()
    await button.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/Priority: not Urgent\s*Hides tasks that are Urgent \(flagged or due soon\)/)
    // The list shows the screen filter as a chip.
    await expect(wsListWidget(page, 't1').getByText('not Urgent')).toBeVisible()

    // Hot clears the markers and greys them out.
    await button.click()
    await page.getByRole('checkbox', { name: 'Hot' }).click()
    await expect(page.getByRole('radiogroup', { name: 'Urgent', exact: true })).toHaveAttribute('aria-disabled', 'true')
    await expect(choice(page, 'Urgent', 'Any')).toHaveAttribute('aria-checked', 'true')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Clear priority filter' }).click()
    await expect.poll(() => sorted(page)).toEqual(ALL.toSorted())
  })

  test('Edit list: Important No, saved, survives a reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsListWidget(page, 't1').getByTestId('list-summary').click()
    const editList = page.getByTestId('edit-list')
    await expect(editList).toBeVisible()
    await editList.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Priority' }).click()
    const picker = page.getByTestId('list-filter-picker')
    await picker.getByRole('radiogroup', { name: 'Important', exact: true }).getByRole('radio', { name: 'No' }).click()
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent', 'Plain'])
    await picker.getByRole('radiogroup', { name: 'Urgent', exact: true }).getByRole('radio', { name: 'Yes' }).click()
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent'])
    await expect(editList.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Urgent, not Important/)
    await expect(editList.locator('[data-changed]')).toHaveText(['Filters'])
    // Esc closes the picker, then Edit list (the draft is kept).
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await page.keyboard.press('Escape')
    await expect(editList).toHaveCount(0)

    const chip = wsListWidget(page, 't1').getByTestId('list-filter-chip')
    await chip.hover()
    await expect(page.getByRole('tooltip')).toHaveText(/Priority: Urgent, not Important\s*Hides tasks that are Important/)
    const save = wsListWidget(page, 't1').getByTestId('save-list')
    await save.click()
    await expect(save).toHaveCount(0)
    await expect.poll(async () => ((await readListDefinitions(page))[0]?.membership as { predicate: unknown }).predicate)
      .toMatchObject({ markers: { urgent: true, important: false } })

    await page.reload()
    await expect.poll(() => sorted(page)).toEqual(['Due tomorrow', 'Flagged urgent'])
    await expect(wsListWidget(page, 't1').getByTestId('list-filter-chip')).toHaveText(/Priority\s*Urgent, not Important/)
    // Reopened, the picker shows Urgent Yes and Important No.
    await wsListWidget(page, 't1').getByTestId('list-filter-chip').click()
    await expect(picker.getByRole('radiogroup', { name: 'Urgent', exact: true }).getByRole('radio', { name: 'Yes' })).toHaveAttribute('aria-checked', 'true')
    await expect(picker.getByRole('radiogroup', { name: 'Important', exact: true }).getByRole('radio', { name: 'No' })).toHaveAttribute('aria-checked', 'true')
  })
})

test.describe('narrow window', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('the folded Filters menu: Priority › Important Yes', async ({ page }) => {
    // Other layouts take the bar's room: the filters fold.
    await seedWorkspace(page, withSpareLayouts(SEED))
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    await page.getByRole('group', { name: 'Screen filters' }).getByRole('button', { name: 'Priority filter' }).click()
    await choice(page, 'Important', 'Yes').click()
    await expect.poll(() => titles(page)).toEqual(['Important only'])
    await expect(page.getByRole('group', { name: 'Screen filters' }).getByRole('button', { name: 'Priority filter: Important' })).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Filters sheet: Urgent No', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const rows = page.locator('[data-todo-id]')
    await expect(rows).toHaveCount(4)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: 'Filters', exact: true }).click()
    const priorityRow = page.getByText('Priority', { exact: true })
    await priorityRow.click()
    const no = choice(page, 'Urgent', 'No')
    expect((await no.boundingBox())!.height).toBeGreaterThanOrEqual(32)
    await no.click()
    await expect(no).toHaveAttribute('aria-checked', 'true')
    await expect(rows).toHaveCount(2)
    await expect(priorityRow.locator('..')).toContainText('not Urgent')
    await choice(page, 'Urgent', 'Yes').click()
    await expect(rows).toHaveCount(2)
    await choice(page, 'Important', 'Yes').click()
    await expect(rows).toHaveCount(0)
  })
})
