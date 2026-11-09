import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D26 BB / BG · the one task layout in a real browser: the task editor at
 * 760px with Subtasks and Notes side by side (each scrolling inside past
 * ~240px), Status updates oldest first opening scrolled to the bottom, the
 * Follow-up group last; under 640px of window Subtasks and Notes stack.
 * The review card in the same layout (Subtasks, People, the marker
 * toggles; no Open in editor; the update line last, focused). The person
 * task dialog's Review · Email check-in · Paste reply… buttons, Review
 * closing the dialog before the deck opens.
 */

const TAB = 'l1'
const MANY_SUBTASKS = Array.from({ length: 14 }, (_, i) => ({ title: `Step ${i + 1}`, done: i < 3 }))
const MANY_UPDATES = Array.from({ length: 9 }, (_, i) => ({ text: `Update ${i + 1}`, inDays: -(9 - i) }))

const SEED: WorkspaceSeed = {
  people: ['Aisha'],
  tags: ['Project: Atlas'],
  tasks: [
    {
      title: 'Vendor contract renewal',
      people: ['Aisha'],
      tags: ['Project: Atlas'],
      dueInDays: 2,
      followupInDays: -1,
      notes: 'Legal wants the indemnity clause reworded before we sign.\n- Ask Ben for the 2025 terms\n- Check auto-renew notice',
      subtasks: MANY_SUBTASKS,
      statusUpdates: MANY_UPDATES,
    },
    { title: 'Map integration points', people: ['Aisha'], followupInDays: 0 },
  ],
  listDefinitions: [{ name: 'Aisha 1:1', grouping: 'none', sort: 'manual' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0 }] })] }],
  }],
}

const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit task' })

async function openEditor(page: Page, title = 'Vendor contract renewal'): Promise<Locator> {
  await taskRowByTitle(page, title).locator(`span[data-task-title="${title}"]`).dblclick()
  await expect(editor(page)).toBeVisible()
  return editor(page)
}

/** The scroll state of `el`: whether it overflows, and whether it sits at its bottom. */
async function scrollState(el: Locator) {
  return el.evaluate((node) => ({
    overflows: node.scrollHeight > node.clientHeight + 1,
    atBottom: Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop) <= 2,
  }))
}

test.describe('the task editor', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('760px wide; Subtasks | Notes side by side, each scrolling inside; Status updates oldest first, at the bottom; Follow-up last', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page)
    // Its laid-out width (the open animation scales it for a moment).
    expect(await dialog.evaluate((el) => (el as HTMLElement).offsetWidth)).toBe(760)

    const subtasks = dialog.locator('[data-task-pair] [data-subtasks]')
    const notes = dialog.locator('[data-task-pair] [data-task-notes]')
    const [s, n] = [await box(subtasks), await box(notes)]
    // Side by side: one row, Subtasks on the left.
    expect(Math.abs(s.y - n.y)).toBeLessThan(2)
    expect(s.x + s.width).toBeLessThan(n.x)
    // The row stops at ~240px; the checklist scrolls inside, + Add subtask its last line.
    const pairCell = dialog.locator('[data-task-pair] > div').first()
    expect((await box(pairCell)).height).toBeLessThanOrEqual(241)
    const checklistScroll = subtasks.locator('> div').last()
    expect((await scrollState(checklistScroll)).overflows).toBe(true)
    await checklistScroll.evaluate((node) => { node.scrollTop = node.scrollHeight })
    await expect(subtasks.getByPlaceholder('Add subtask')).toBeInViewport()

    // Status updates: oldest first, the list scrolled to its bottom (the newest), the add line under it.
    const list = dialog.getByRole('list', { name: 'Status updates' })
    await expect(list.locator('[data-status-update]').first()).toContainText('Update 1')
    await expect(list.locator('[data-status-update]').last()).toContainText('Update 9')
    const state = await scrollState(list)
    expect(state.overflows).toBe(true)
    expect(state.atBottom).toBe(true)
    const addLine = dialog.getByRole('textbox', { name: 'New status update' })
    expect((await box(addLine)).y).toBeGreaterThan((await box(list)).y + (await box(list)).height - 1)

    // The Follow-up group is last, with Mark followed up on its Last row.
    const followup = dialog.locator('[data-task-followup]')
    expect((await box(followup)).y).toBeGreaterThan((await box(addLine)).y)
    await expect(followup.getByRole('button', { name: 'Mark followed up' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('editor-760.png') })
  })

  test('⏎ in the add line adds the update dated today, last in the list, and the line stays ready', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const dialog = await openEditor(page)
    const addLine = dialog.getByRole('textbox', { name: 'New status update' })
    await addLine.fill('Sent the redlines')
    await addLine.press('Enter')
    const list = dialog.getByRole('list', { name: 'Status updates' })
    await expect(list.locator('[data-status-update]').last()).toContainText('Sent the redlines')
    await expect(addLine).toHaveValue('')
    await expect(addLine).toBeFocused()
    expect((await scrollState(list)).atBottom).toBe(true)
  })

  test('under 640px of window, Subtasks then Notes, stacked', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await openEditor(page)
    await page.setViewportSize({ width: 620, height: 900 })
    // The narrow sheet slides in again: measure once it has settled.
    await editor(page).evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
    const subtasks = editor(page).locator('[data-task-pair] [data-subtasks]')
    const notes = editor(page).locator('[data-task-pair] [data-task-notes]')
    const [s, n] = [await box(subtasks), await box(notes)]
    expect(n.y).toBeGreaterThanOrEqual(s.y + s.height - 1)
    expect(Math.abs(s.x - n.x)).toBeLessThan(2)
  })
})

test.describe('the review card', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('the editor’s layout: Subtasks, People, the marker toggles; the update line last and focused; no Open in editor', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsListWidget(page, TAB).waitFor({ state: 'visible' })
    await wsTab(page, TAB).click({ button: 'right' })
    await page.getByRole('menu').getByRole('menuitem', { name: /Review these 2 tasks/ }).click()
    const deck = page.getByRole('dialog', { name: 'Aisha 1:1' })
    await expect(deck).toBeVisible()
    const card = deck.locator('[data-review-card]')
    await expect(card.getByRole('region', { name: 'Subtasks' })).toBeVisible()
    await expect(card.getByText('Checklist')).toHaveCount(0)
    await expect(card.getByText('People', { exact: true })).toBeVisible()
    await expect(card.getByRole('button', { name: 'Urgent' })).toBeVisible()
    await expect(deck.getByRole('button', { name: 'Open in editor' })).toHaveCount(0)
    const updateLine = deck.getByLabel('Status update · today')
    await expect(updateLine).toBeFocused()
    // In view, though a long checklist and log push it down the card.
    await expect(updateLine).toBeInViewport({ ratio: 1 })
    const list = card.getByRole('list', { name: 'Status updates' })
    await expect(list.locator('[data-status-update]').last()).toContainText('Update 9')
    expect((await scrollState(list)).atBottom).toBe(true)
    // Subtasks and Notes side by side in the card too.
    const [s, n] = [await box(card.locator('[data-task-pair] [data-subtasks]')), await box(card.locator('[data-task-pair] [data-task-notes]'))]
    expect(Math.abs(s.y - n.y)).toBeLessThan(2)
    // The Last row shows the date only; the one Mark followed up is the footer's.
    await expect(deck.getByRole('button', { name: 'Mark followed up' })).toHaveCount(1)
    await page.screenshot({ path: test.info().outputPath('review-card.png') })

    // ⏎ keeps its meaning: the update and the follow-up, then the next card, its line focused.
    await updateLine.fill('Legal is on it')
    await updateLine.press('Enter')
    await expect(deck.getByTestId('review-card-title')).toHaveText('Map integration points')
    await expect(deck.getByLabel('Status update · today')).toBeFocused()
  })
})

test.describe('the person task dialog', () => {
  test.use({ viewport: { width: 1280, height: 900 } })

  test('Review · Email check-in · Paste reply… under the title; Review closes the dialog, then the deck opens', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await wsListWidget(page, TAB).waitFor({ state: 'visible' })
    const avatar = taskRowByTitle(page, 'Vendor contract renewal').locator('[data-person-avatar="Aisha"]')
    await avatar.click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Show tasks' }).click()
    const dialog = page.locator('[data-task-dialog]')
    await expect(dialog).toBeVisible()
    const actions = dialog.getByRole('group', { name: 'Actions for Aisha' })
    await expect(actions.getByRole('button')).toHaveText(['Review', 'Email check-in', 'Paste reply…'])
    await expect(dialog.getByRole('button', { name: /Email check-in options/ })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Close Esc' })).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('person-dialog.png') })

    await actions.getByRole('button', { name: 'Review with Aisha…' }).click()
    await expect(dialog).toHaveCount(0)
    const deck = page.getByRole('dialog', { name: 'Aisha' })
    await expect(deck).toBeVisible()
    await expect(deck.getByLabel('Status update · today')).toBeFocused()
  })
})
