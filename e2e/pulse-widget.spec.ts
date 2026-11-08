import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Project pulse (D25 L) in a real browser: a card per picked tag, a card
 * opening its tag's open tasks.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TAGS: WorkspaceSeed['tags'] = [{ name: 'Project: Atlas', color: '#4f8cff' }, { name: 'Project: Beta', color: '#e05050' }]

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Ship the beta', focus: true, dueInDays: 2, tags: ['Project: Atlas'] },
  { title: 'Book the venue', focus: true, tags: ['Project: Beta'] },
  { title: 'Write the notes', focus: true, completedInDays: 0 },
  { title: 'Pay the invoice', dueInDays: 0, tags: ['Project: Atlas'] },
  // There since before yesterday (a task created today with a past due date came in late; it didn't go late).
  { title: 'Renew the domain', dueInDays: -1, modifiedInDays: -10, tags: ['Project: Atlas'] },
  { title: 'Plan the offsite', tags: ['Project: Beta'] },
]

/** One column: Project pulse over a notes cell. */
function seed(tasks: WorkspaceSeed['tasks'] = TASKS): WorkspaceSeed {
  return {
    tags: TAGS,
    tasks,
    layouts: [{ name: 'Brief', columns: [{ id: 'c1', rows: [
      { cells: [{ id: 'kp', tabs: [{ id: 'pulse', kind: 'pulse', tagNames: ['Project: Atlas', 'Project: Beta'] }] }] },
      { cells: [{ id: 'kn', tabs: [{ id: 'notes', kind: 'notes' }] }] },
    ] }] }],
  }
}

const dialog = (page: Page) => page.locator('[data-task-dialog]')

test('Project pulse: a card per picked tag; a click opens the tag’s open tasks', async ({ page }) => {
  await seedWorkspace(page, seed())
  const cards = page.locator('[data-glance="pulse"] [data-pulse-card]')
  await expect(cards).toHaveCount(2)
  const atlas = cards.first()
  await expect(atlas).toContainText('Project: Atlas')
  await expect(atlas).toContainText('1 late (33%)')
  // Every task was added today: +3 this week.
  await expect(atlas).toContainText('Growing: +3 net in 4 weeks')
  await atlas.click()
  await expect(dialog(page).getByRole('heading')).toHaveText('#Project: Atlas')
  await expect(dialog(page).locator('[data-todo-id]')).toHaveCount(3)
})
