import { expect, test } from '@playwright/test'
import { openSettings, seedTaskList, wsTab, TASK_LIST_TAB } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * Hot: a derived marker from Settings' Hot rule (lines joined by OR, each an
 * AND of Focus / Urgent / Important; default (Urgent AND Important) OR
 * Focus). The Markers filter offers Hot first; ticking it greys out the
 * single markers. Editing the rule in Settings › Task defaults re-filters a
 * list filtered on Hot at once.
 */

const tasks = [
  { title: 'Fix checkout outage', urgent: true, important: true },
  { title: 'Draft homepage copy', important: true, dueInDays: 1 },
  { title: 'Book venue', focus: true },
  { title: 'Review analytics', urgent: true },
  { title: 'Plan offsite', important: true },
  { title: 'Water plants' },
]

test('the Markers picker: Hot first, greying the others; Urgent Yes + Important Yes AND', async ({ page }) => {
  const widget = await seedTaskList(page, { statuses: ['Doing'], tasks })
  await expect.poll(() => rowTitles(widget)).toHaveLength(6)

  await page.getByRole('button', { name: 'Priority filter' }).click()
  const picker = page.getByRole('group', { name: 'Priority' })
  await expect(picker.getByRole('checkbox')).toHaveText(['Hot'])
  await expect(picker.getByRole('radiogroup')).toHaveCount(3)
  const yes = (name: string) => picker.getByRole('radiogroup', { name, exact: true }).getByRole('radio', { name: 'Yes' })

  // Urgent + Important: tasks with both (Urgent includes urgent by due date).
  await yes('Urgent').click()
  await yes('Important').click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Fix checkout outage', 'Draft homepage copy'])
  await expect(page.getByRole('button', { name: 'Priority filter: Urgent, Important' })).toBeVisible()

  // Hot replaces them and greys them out.
  await picker.getByRole('checkbox', { name: 'Hot' }).click()
  await expect.poll(() => rowTitles(widget)).toEqual(['Fix checkout outage', 'Draft homepage copy', 'Book venue'])
  await expect(page.getByRole('button', { name: 'Priority filter: Hot' })).toBeVisible()
  for (const name of ['Urgent', 'Important', 'Focus']) {
    const group = picker.getByRole('radiogroup', { name, exact: true })
    await expect(group).toHaveAttribute('aria-disabled', 'true')
    await expect(group.getByRole('radio', { name: 'Any' })).toHaveAttribute('aria-checked', 'true')
    await expect(group.locator('..')).toHaveCSS('opacity', '0.4')
  }
  await expect(picker).toContainText('Hot already combines these. Clear Hot to pick them one by one.')
  await yes('Focus').click({ force: true })
  await expect.poll(() => rowTitles(widget)).toEqual(['Fix checkout outage', 'Draft homepage copy', 'Book venue'])

  // Unticking Hot is no filter; the markers are enabled again.
  await picker.getByRole('checkbox', { name: 'Hot' }).click()
  await expect.poll(() => rowTitles(widget)).toHaveLength(6)
  await expect(picker.getByRole('radiogroup', { name: 'Urgent', exact: true })).not.toHaveAttribute('aria-disabled', 'true')
})

test('editing the Hot rule in Settings changes a Hot list’s tasks and count at once', async ({ page }) => {
  const widget = await seedTaskList(page, { tasks, list: { predicate: { markers: 'hot' } } })
  await expect.poll(() => rowTitles(widget)).toEqual(['Fix checkout outage', 'Draft homepage copy', 'Book venue'])
  await expect(wsTab(page, TASK_LIST_TAB)).toContainText('3')

  const settings = await openSettings(page, 'Task defaults')
  const line = (n: number) => settings.getByRole('group', { name: `Hot rule line ${n}` })
  await expect(line(1).getByText('2 now')).toBeVisible()
  await expect(line(2).getByText('1 now')).toBeVisible()
  await expect(settings.getByTestId('hot-rule-total')).toHaveText('3 open tasks are hot right now.')

  // Line 1 becomes Important alone: Plan offsite turns hot too.
  await line(1).getByRole('button', { name: 'Urgent' }).click()
  await expect(line(1).getByText('3 now')).toBeVisible()
  await expect(settings.getByTestId('hot-rule-total')).toHaveText('4 open tasks are hot right now.')
  // + Or… Urgent: Review analytics joins.
  await settings.getByRole('button', { name: 'Or…' }).click()
  await line(3).getByRole('button', { name: 'Urgent' }).click()
  await expect(settings.getByTestId('hot-rule-total')).toHaveText('5 open tasks are hot right now.')

  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect.poll(() => rowTitles(widget)).toEqual([
    'Fix checkout outage', 'Draft homepage copy', 'Book venue', 'Review analytics', 'Plan offsite',
  ])
  await expect(wsTab(page, TASK_LIST_TAB)).toContainText('5')

  // Saved: still the same rule after a reload; Reset to default brings back 3.
  await page.reload()
  await expect.poll(() => rowTitles(widget)).toHaveLength(5)
  const again = await openSettings(page, 'Task defaults')
  await again.getByRole('button', { name: 'Reset to default' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(() => rowTitles(widget)).toEqual(['Fix checkout outage', 'Draft homepage copy', 'Book venue'])
})
