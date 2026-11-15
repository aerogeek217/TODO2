import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { pickInReview, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The task layout's Status menu in a real browser (cr34 U1, T13): the task
 * editor's and the review card's status pill opens the app's menu — portaled
 * out of the editor's dialog, whose Tab stays inside its panel, so the menu
 * takes the focus itself. By keyboard: Enter / Space / ↓ on the pill open it
 * with the focus on the current status, the arrows move, Enter picks, Esc
 * closes the menu only, Tab closes it and moves on inside the dialog — each
 * with the focus back on the pill. By mouse: a click on an item picks.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha'],
  statuses: ['Waiting', 'In progress'],
  tasks: [
    { title: 'Vendor contract renewal', people: ['Aisha'], status: 'Waiting' },
    { title: 'Plain task', people: ['Aisha'] },
  ],
  listDefinitions: [{ name: 'All', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }] })] }],
  }, {
    name: 'Review',
    columns: [{ id: 'r1', rows: [wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] })] }],
  }],
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })
const menu = (page: Page) => page.getByRole('menu', { name: 'Status' })
const option = (page: Page, name: string) => menu(page).getByRole('menuitemradio', { name, exact: true })

async function openEditor(page: Page, title: string): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(editor(page)).toBeVisible()
  return editor(page)
}

/** The stored status name of the task titled `title` (`null`: none). */
async function storedStatus(page: Page, title: string): Promise<string | null> {
  const [todos, statuses] = [
    await readStore<{ title: string; statusId?: number }>(page, 'todos'),
    await readStore<{ id: number; name: string }>(page, 'statuses'),
  ]
  const id = todos.find((t) => t.title === title)?.statusId
  return id == null ? null : statuses.find((s) => s.id === id)?.name ?? `#${id}`
}

test.describe('the task editor’s Status menu', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('by keyboard: Enter opens it on the current status, ↓ moves, Enter picks; the focus returns to the pill', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Vendor contract renewal')
    const pill = dialog.getByRole('button', { name: 'Status: Waiting' })
    await pill.focus()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toBeVisible()
    await expect(pill).toHaveAttribute('aria-expanded', 'true')
    // Portaled out of the dialog, yet the focus is in it: on the current status.
    await expect(dialog.getByRole('menu')).toHaveCount(0)
    await expect(option(page, 'Waiting')).toBeFocused()
    await expect(option(page, 'Waiting')).toHaveAttribute('aria-checked', 'true')

    await page.keyboard.press('ArrowDown')
    await expect(option(page, 'In progress')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(menu(page)).toHaveCount(0)
    const picked = dialog.getByRole('button', { name: 'Status: In progress' })
    await expect(picked).toBeFocused()
    await expect(dialog).toBeVisible()
    await expect.poll(() => storedStatus(page, 'Vendor contract renewal')).toBe('In progress')

    // Space and ↓ open it too; Home goes to No Status, which Enter picks.
    await page.keyboard.press('Space')
    await expect(option(page, 'In progress')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await page.keyboard.press('ArrowDown')
    await expect(option(page, 'In progress')).toBeFocused()
    await page.keyboard.press('Home')
    await expect(option(page, 'No Status')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(dialog.getByRole('button', { name: 'Status: No status' })).toBeFocused()
    await expect.poll(() => storedStatus(page, 'Vendor contract renewal')).toBeNull()
  })

  test('Esc closes the menu only; Tab closes it and moves on inside the editor', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Vendor contract renewal')
    const pill = dialog.getByRole('button', { name: 'Status: Waiting' })
    await pill.focus()
    await page.keyboard.press('Enter')
    await expect(option(page, 'Waiting')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(menu(page)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    await expect(pill).toBeFocused()

    await page.keyboard.press('Enter')
    await expect(option(page, 'Waiting')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(menu(page)).toHaveCount(0)
    await expect(dialog).toBeVisible()
    // The focus went on to the control after the pill, in the dialog: nowhere else.
    const where = await page.evaluate(() => {
      const active = document.activeElement
      const panel = document.querySelector('[role="dialog"][aria-label="Edit task"]')
      return { inDialog: !!active && !!panel?.contains(active), isBody: active === document.body, label: active?.getAttribute('aria-label') ?? '' }
    })
    expect(where.isBody).toBe(false)
    expect(where.inDialog).toBe(true)
    expect(where.label).not.toBe('Status: Waiting')
    expect(await storedStatus(page, 'Vendor contract renewal')).toBe('Waiting')
  })

  test('by mouse: a click on the pill opens it under the pill, a click on an item picks, a second click on the pill closes it', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page, 'Plain task')
    const pill = dialog.getByRole('button', { name: 'Status: No status' })
    await pill.click()
    await expect(menu(page)).toBeVisible()
    const [p, m] = [await pill.boundingBox(), await menu(page).boundingBox()]
    expect(m!.y).toBeGreaterThanOrEqual(p!.y + p!.height - 1)
    await option(page, 'Waiting').click()
    await expect(menu(page)).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Status: Waiting' })).toBeVisible()
    await expect(dialog).toBeVisible()
    await expect.poll(() => storedStatus(page, 'Plain task')).toBe('Waiting')

    const set = dialog.getByRole('button', { name: 'Status: Waiting' })
    await set.click()
    await expect(option(page, 'Waiting')).toHaveAttribute('aria-checked', 'true')
    await set.click()
    await expect(menu(page)).toHaveCount(0)
    await expect(dialog).toBeVisible()
  })
})

test.describe('the review card’s Status menu', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('by keyboard: opens on the current status, ↓ and Enter pick, the focus back on the pill', async ({ page }) => {
    await seedWorkspace(page, { ...SEED, layouts: [...SEED.layouts].reverse() })
    await pickInReview(page, 'rv', 'Aisha')
    const card = page.locator('[data-review-widget="rv"] [data-review-card]')
    await expect(page.locator('[data-review-widget="rv"]').getByTestId('review-card-title')).toHaveText('Vendor contract renewal')
    const pill = card.getByRole('button', { name: 'Status: Waiting' })
    await pill.focus()
    await page.keyboard.press('Enter')
    await expect(option(page, 'Waiting')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(menu(page)).toHaveCount(0)
    await expect(card.getByRole('button', { name: 'Status: In progress' })).toBeFocused()
    await expect.poll(() => storedStatus(page, 'Vendor contract renewal')).toBe('In progress')
  })
})
