import { expect, test } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { seedTaskList } from './fixtures/workspace'

/**
 * Regression: opening `TaskEditPopup` in *edit* mode for an existing task
 * showed an empty Tags chip-picker dropdown, even when the registry had tags.
 * Root cause was a missing `allTags` prop in the edit-mode mount sites —
 * `taskEdit.editProps` doesn't carry `allTags` (only `assignedTags`), so
 * `TaskEditPopup` defaulted `allTags = []` and the picker had nothing to
 * render. Create mode was unaffected — it threaded `allTags` directly.
 */
test('TaskEditPopup edit mode shows registry tags in the Tags picker', async ({ page }) => {
  await seedTaskList(page, {
    tags: ['urgent', 'later'],
    tasks: [{ title: 'Some task' }],
  })

  // Open the task edit popup for the seeded task. TaskRow's row `<div>`
  // fires `onOpenDetail` (→ openEditPopup) on double-click; single click is
  // just selection.
  const taskRow = taskRowByTitle(page, 'Some task')
  await taskRow.locator('span[data-task-title="Some task"]').dblclick()

  // Wait for the popup. The "Tags" row in `TaskEditMetadata` exposes a
  // `+ Add` button that toggles the chip selector dropdown.
  // (The top bar's Tags filter button reads "Tags" too — skip the filter tray.)
  const tagsLabel = page.getByText('Tags', { exact: true }).and(page.locator(':not([data-filter-row] *)'))
  await expect(tagsLabel).toBeVisible()
  // The Tags row's "+ Add" button — `.chipAddBtn` is reused by people/tags
  // rows, so we scope to the Tags row by walking from the visible label.
  const tagsRow = tagsLabel.locator('..')
  await tagsRow.getByRole('button', { name: '+ Add' }).click()

  // Both seeded tags appear in the picker. Pre-fix this list would be empty.
  await expect(page.getByRole('option', { name: 'urgent', exact: true })).toBeVisible()
  await expect(page.getByRole('option', { name: 'later', exact: true })).toBeVisible()
})
