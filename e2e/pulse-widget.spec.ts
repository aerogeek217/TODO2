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

// Item 9: a tag added with the dashed + card, removed with a card's × (shown on hover / focus).
test.describe('Project pulse: + and × on the widget', () => {
  const ADD_SEED = (tagNames: string[]): WorkspaceSeed => ({
    ...seed(),
    tags: [...TAGS, { name: 'Ops', color: '#30a46c' }],
    layouts: [{ name: 'Brief', columns: [{ id: 'c1', rows: [
      { cells: [{ id: 'kp', tabs: [{ id: 'pulse', kind: 'pulse', tagNames }] }] },
    ] }] }],
  })
  const pulse = (page: Page) => page.locator('[data-glance="pulse"]')
  const snackbar = (page: Page) => page.locator('[data-snackbar-live]')

  test('a card’s × shows on hover and focus only, takes no press while hidden, moves nothing; a click removes the tag, Undo brings it back', async ({ page }) => {
    await seedWorkspace(page, ADD_SEED(['Project: Atlas', 'Project: Beta']))
    const atlas = pulse(page).locator('[data-pulse-card]').first()
    const remove = pulse(page).getByRole('button', { name: 'Remove “Project: Atlas” from project pulse' })
    // Away from the cards: hidden, and a press there reaches the card under it.
    await page.mouse.move(5, 5)
    await expect(remove).toHaveCSS('opacity', '0')
    await expect(remove).toHaveCSS('pointer-events', 'none')
    const before = await atlas.boundingBox()
    const name = atlas.getByText('Project: Atlas', { exact: true })
    const nameBefore = await name.boundingBox()
    await atlas.hover()
    await expect(remove).toHaveCSS('opacity', '1')
    await expect(remove).toHaveCSS('pointer-events', 'auto')
    expect(await atlas.boundingBox()).toEqual(before)
    expect(await name.boundingBox()).toEqual(nameBefore)
    // The hover's × sits over the card's corner and takes the press there.
    const box = (await remove.boundingBox())!
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-pulse-remove]') != null, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
    expect(hit).toBe(true)
    // Keyboard focus on the card shows it too.
    await page.mouse.move(5, 5)
    await atlas.focus()
    await expect(remove).toHaveCSS('opacity', '1')
    await page.keyboard.press('Tab')
    await expect(remove).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(pulse(page).locator('[data-pulse-card]')).toHaveCount(1)
    await expect(snackbar(page)).toContainText('Removed “Project: Atlas” from project pulse')
    await snackbar(page).getByRole('button', { name: 'Undo', exact: true }).click()
    await expect(pulse(page).locator('[data-pulse-card]')).toHaveCount(2)
  })

  test('the dashed + card after the last card opens the tag picker beside it; a pick adds its card, kept over a reload', async ({ page }) => {
    await seedWorkspace(page, ADD_SEED(['Project: Atlas']))
    const add = pulse(page).getByRole('button', { name: 'Add a tag to project pulse' })
    // After the last card, in the same grid.
    const cards = pulse(page).locator('[data-pulse-card]')
    const cardBox = (await cards.last().boundingBox())!
    const addBox = (await add.boundingBox())!
    expect(addBox.x).toBeGreaterThan(cardBox.x)
    await expect(add).toHaveCSS('border-top-style', 'dashed')
    await add.click()
    const picker = page.locator('[data-anchored-picker]')
    await expect(picker).toBeVisible()
    // Placed against the + card, inside the viewport.
    const pickerBox = (await picker.boundingBox())!
    expect(pickerBox.y).toBeGreaterThanOrEqual(0)
    expect(pickerBox.y + pickerBox.height).toBeLessThanOrEqual(900)
    expect(Math.abs(pickerBox.y - (addBox.y + addBox.height)) < 40 || Math.abs(pickerBox.y + pickerBox.height - addBox.y) < 40).toBe(true)
    await expect(picker.getByRole('option', { name: /Project: Atlas/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.type('Ops')
    await page.keyboard.press('Enter')
    await expect(cards).toHaveCount(2)
    await expect(cards.last()).toContainText('Ops')
    await expect(snackbar(page)).toContainText('Added “Ops” to project pulse')
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await page.reload()
    await expect(pulse(page).locator('[data-pulse-card]')).toHaveCount(2)
  })

  test('with no tag picked, the empty state’s Add tag opens the same picker', async ({ page }) => {
    await seedWorkspace(page, ADD_SEED([]))
    await expect(pulse(page)).toContainText('No tags picked')
    await pulse(page).getByRole('button', { name: '+ Add tag' }).click()
    await page.locator('[data-anchored-picker]').getByRole('option', { name: /Project: Beta/ }).click()
    await expect(pulse(page).locator('[data-pulse-card]')).toHaveCount(1)
    await expect(pulse(page).locator('[data-pulse-card]')).toContainText('Project: Beta')
  })
})
