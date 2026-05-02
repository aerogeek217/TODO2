import { expect, test } from '@playwright/test'
import { seedCanvasWithProjects, taskRowByTitle } from './fixtures/seed'

const DB_NAME = 'todo2'

/**
 * Regression for triage-2026-05-01 P3: opening `TaskEditPopup` in *edit*
 * mode for an existing task showed an empty Tags chip-picker dropdown,
 * even when the registry had tags. Root cause was a missing `allTags`
 * prop in the edit-mode mount sites — `taskEdit.editProps` doesn't carry
 * `allTags` (only `assignedTags`), and CanvasPage / ListView / CalendarView
 * were spreading editProps + threading `allPeople` + `allOrgs` explicitly
 * but not `allTags`. So `TaskEditPopup` defaulted `allTags = []` and the
 * picker had nothing to render. Create mode was unaffected — it threaded
 * `allTags={taskEdit.allTags}` directly.
 */
test('TaskEditPopup edit mode shows registry tags in the Tags picker', async ({ page }) => {
  await seedCanvasWithProjects(page, {
    projects: [{ name: 'Project A', tasks: ['Some task'] }],
  })

  // Seed the tag registry directly. (`tagStore.add` would also work via
  // page.evaluate but raw IDB sidesteps the store load timing.)
  await page.evaluate(async ({ db }) => {
    return await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => {
        const idb = req.result
        const tx = idb.transaction(['tags'], 'readwrite')
        tx.objectStore('tags').add({ name: 'urgent', color: '#ff5555' })
        tx.objectStore('tags').add({ name: 'later', color: '#5555ff' })
        tx.oncomplete = () => { idb.close(); resolve() }
        tx.onerror = () => { idb.close(); reject(tx.error) }
      }
      req.onerror = () => reject(req.error)
    })
  }, { db: DB_NAME })

  await page.reload()
  await page.locator('.react-flow__viewport').first().waitFor({ state: 'visible' })

  // Open the task edit popup for the seeded task. TaskRow's row `<div>`
  // fires `onOpenDetail` (→ openEditPopup) on double-click; single click is
  // just selection.
  const taskRow = taskRowByTitle(page, 'Some task')
  await taskRow.locator('span[title="Some task"]').dblclick()

  // Wait for the popup. The "Tags" row in `TaskEditMetadata` exposes a
  // `+ Add` button that toggles the chip selector dropdown.
  await expect(page.getByText('Tags', { exact: true })).toBeVisible()
  // The Tags row's "+ Add" button — `.chipAddBtn` is reused by people/orgs/tags
  // rows, so we scope to the Tags row by walking from the visible label.
  const tagsRow = page.getByText('Tags', { exact: true }).locator('..')
  await tagsRow.getByRole('button', { name: '+ Add' }).click()

  // Both seeded tags appear in the picker. Pre-fix this list would be empty.
  await expect(page.getByRole('button', { name: 'urgent' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'later' })).toBeVisible()
})
