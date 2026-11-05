import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { emptyPredicate, seedWorkspace, wsListWidget, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * An or group edited in Edit list while the list's own filter line shows the
 * same filter (cr31 UI F1). Emptying one of the group's two filters leaves it
 * one item under the open picker; the filter line, which made no edit, must
 * not dissolve it there, or the picker's next keystrokes land in the wrong
 * clauses (OR became AND, the text split across chips). Once the picker
 * closes, a group of one still becomes its item.
 */

/** An or group's clauses: the empty predicate's, without Show completed. */
const clauses = (patch: Record<string, unknown>) => {
  const rest = emptyPredicate()
  delete rest.showCompleted
  return { ...rest, ...patch }
}

const SEED: WorkspaceSeed = {
  listDefinitions: [{
    name: 'Team',
    predicate: { orGroups: [clauses({ dates: { deadline: { match: 'set' } }, searchText: '1499' })] },
  }],
  tasks: [
    { title: 'Task 1499' },
    { title: 'Task 1498' },
    { title: 'Due task', dueInDays: 3 },
    { title: 'Other' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const titles = async (page: Page) => (await rowTitles(wsListWidget(page, 't1'))).toSorted()

test.use({ viewport: { width: 1600, height: 900 } })

test('editing a group’s chip in Edit list beside the filter line keeps OR as OR', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const widget = wsListWidget(page, 't1')
  await expect.poll(() => titles(page)).toEqual(['Due task', 'Task 1499'])

  await wsTab(page, 't1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  const editor = page.getByTestId('edit-list')
  await expect(editor).toBeVisible()
  // Both show the group.
  await expect(widget.getByTestId('or-group')).toHaveCount(1)
  await expect(editor.getByTestId('or-group')).toHaveCount(1)

  await editor.getByTestId('or-group').getByTestId('list-filter-chip').filter({ hasText: 'Text' }).click()
  const field = page.getByTestId('list-filter-picker').getByRole('textbox')
  await field.press('ControlOrMeta+a')
  await field.press('Backspace')
  // One item left under the open picker: still a group on both rows.
  await expect(widget.getByTestId('or-group')).toHaveCount(1)
  await field.pressSequentially('1498')
  await expect(field).toHaveValue('1498')
  await expect.poll(() => titles(page)).toEqual(['Due task', 'Task 1498'])
  await expect(widget.getByTestId('or-group')).toHaveText(/Due\s*.*\s*or\s*Text\s*“1498”/)
  await expect(widget.getByTestId('list-filter-chip')).toHaveCount(2)

  // Emptied and closed: the group of one becomes its item, on both rows.
  await field.press('ControlOrMeta+a')
  await field.press('Backspace')
  await field.press('Enter')
  await expect(page.getByTestId('list-filter-picker')).toHaveCount(0)
  await expect(widget.getByTestId('or-group')).toHaveCount(0)
  await expect(editor.getByTestId('or-group')).toHaveCount(0)
  await expect(widget.getByTestId('list-filter-chip')).toHaveCount(1)
  await expect.poll(() => titles(page)).toEqual(['Due task'])
})
