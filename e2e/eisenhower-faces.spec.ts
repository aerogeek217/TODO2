import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Eisenhower's faces (D26 P4) in a real browser, picked by the cell's
 * measured size: in a short fixed row its small face — the 2×2 of counts,
 * the old Eisenhower summary — whose click opens the whole widget in the
 * face popover (Esc closes it); a little taller its medium face — the
 * counts and each pane's first titles, a title opening the task and a
 * count the pane's tasks; in a tall cell the whole widget.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Fix the outage', urgent: true, important: true, dueInDays: 0 },
  { title: 'Sign the contract', urgent: true, important: true, dueInDays: 1 },
  { title: 'Hire a designer', urgent: true, important: true },
  { title: 'Draft the OKRs', important: true },
  { title: 'Answer the vendor', urgent: true },
  { title: 'Tidy the wiki' },
]

/** An Eisenhower in a fixed row `px` tall, beside a tall notes cell; a second, tall one under the notes. */
function seed(px: number): WorkspaceSeed {
  return {
    tasks: TASKS,
    layouts: [{
      name: 'Faces',
      table: {
        areas: ['face notes', 'big big'],
        rows: [{ px }, 1000],
        cells: [
          { id: 'face', tabs: [{ id: 'eisFace', kind: 'eisenhower' }] },
          { id: 'notes', tabs: [{ id: 'n', kind: 'notes' }] },
          { id: 'big', tabs: [{ id: 'eisBig', kind: 'eisenhower' }] },
        ],
      },
    }],
  }
}

const face = (page: Page, tabId: string) => page.locator(`[data-eis-face-tab="${tabId}"]`)
const count = (page: Page, tabId: string, q: string) => face(page, tabId).locator(`[data-eis-cell="${q}"]`).getByTestId('eis-face-count')
const popover = (page: Page) => page.getByTestId('widget-face-popover')

test('a short cell shows the small face — the 2×2 of counts; a click opens the whole widget over it', async ({ page }) => {
  await seedWorkspace(page, seed(120))
  const cell = wsCell(page, 'face')
  await expect(cell).toHaveAttribute('data-face', 'small')
  await expect(face(page, 'eisFace')).toHaveAttribute('data-eis-face', 'small')
  await expect(count(page, 'eisFace', 'do')).toHaveText('3')
  await expect(count(page, 'eisFace', 'schedule')).toHaveText('1')
  await expect(count(page, 'eisFace', 'delegate')).toHaveText('1')
  await expect(count(page, 'eisFace', 'drop')).toHaveText('1')
  // Its four panes fit the cell: a 2×2, nothing cut off below.
  const faceBox = (await face(page, 'eisFace').boundingBox())!
  const dropBox = (await face(page, 'eisFace').locator('[data-eis-cell="drop"]').boundingBox())!
  expect(dropBox.y + dropBox.height).toBeLessThanOrEqual(faceBox.y + faceBox.height + 0.5)
  const doBox = (await face(page, 'eisFace').locator('[data-eis-cell="do"]').boundingBox())!
  expect(Math.abs(doBox.y - (await face(page, 'eisFace').locator('[data-eis-cell="schedule"]').boundingBox())!.y)).toBeLessThan(1)

  // The tall Eisenhower beside it is the whole widget.
  await expect(page.locator('[data-eisenhower="eisBig"]')).toBeVisible()
  await expect(face(page, 'eisBig')).toHaveCount(0)

  await face(page, 'eisFace').click()
  await expect(popover(page)).toBeVisible()
  await expect(popover(page).locator('[data-eisenhower="eisFace"]')).toBeVisible()
  await expect(popover(page).locator('[data-eisenhower="eisFace"] [data-eis-quadrant="do"] [data-todo-id]')).toHaveCount(3)
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
})

test('a little taller, the medium face: the counts and each pane’s first titles; a title opens the task, a count the pane’s tasks', async ({ page }) => {
  await seedWorkspace(page, seed(180))
  const cell = wsCell(page, 'face')
  await expect(cell).toHaveAttribute('data-face', 'medium')
  await expect(face(page, 'eisFace')).toHaveAttribute('data-eis-face', 'medium')
  await expect(count(page, 'eisFace', 'do')).toHaveText('3')
  // Do's first two, in the widget's order (by due date).
  const doTitles = face(page, 'eisFace').locator('[data-eis-cell="do"] [data-todo-id]')
  await expect(doTitles).toHaveText(['Fix the outage', 'Sign the contract'])
  await expect(face(page, 'eisFace').locator('[data-eis-cell="schedule"] [data-todo-id]')).toHaveText(['Draft the OKRs'])

  await doTitles.first().click()
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0)

  await face(page, 'eisFace').getByRole('button', { name: 'Do: 3. Show tasks' }).click()
  const dialog = page.locator('[data-task-dialog]')
  await expect(dialog.getByRole('heading')).toHaveText('Do')
  await expect(dialog.locator('[data-todo-id]')).toHaveCount(3)
})
