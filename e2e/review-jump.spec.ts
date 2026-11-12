import { expect, test, type Page } from '@playwright/test'
import { taskRowByTitle } from './fixtures/seed'
import { expectLayoutStored, expectOpenLayout, reviewField, seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Review buttons' jump in a real browser: a Review button sets the open
 * layout's Review widget's temporary filter and moves the focus into it;
 * without one there it opens the popup review (the widget popup) with that
 * filter — no layout switch, no layout written, no undo step. The buttons
 * are always there. An open editor with changes asks first, and Keep editing
 * cancels the jump.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Ana report', people: ['Ana Lima'], status: 'Waiting' },
  { title: 'Ana call', people: ['Ana Lima'] },
  { title: 'Bo plan', people: ['Bo Chen'], status: 'Waiting' },
]

const LIST_ROW = wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })

/** The list and a Review widget side by side. */
const SAME: WorkspaceSeed = {
  people: ['Ana Lima', 'Bo Chen'],
  statuses: ['Waiting'],
  tasks: TASKS,
  listDefinitions: [{ name: 'Ana', people: ['Ana Lima'] }],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', rows: [LIST_ROW] },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'rv', kind: 'review' }] })] },
    ],
  }],
}

/** The list on Main; the Review widget on Review. */
const OTHER: WorkspaceSeed = {
  ...SAME,
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [LIST_ROW] }] },
    { name: 'Review', columns: [{ id: 'r1', rows: [wsRow({ id: 'rk', tabs: [{ id: 'rv', kind: 'review' }] })] }] },
  ],
}

/** No Review widget anywhere. */
const NONE: WorkspaceSeed = { ...SAME, layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [LIST_ROW] }] }] }

const widget = (page: Page) => page.locator('[data-review-widget="rv"]')
const undoCount = (page: Page) => page.evaluate(async () => {
  const mod = (await import(/* @vite-ignore */ '/src/stores/undo-store.ts' as string)) as { useUndoStore: { getState: () => { undoStack: unknown[] } } }
  return mod.useUndoStore.getState().undoStack.length
})

test('on the same layout: the list’s Review these N tasks sets the widget’s filter to the list’s; the focus moves in; nothing saved', async ({ page }) => {
  await seedWorkspace(page, SAME)
  await expect(wsListWidget(page, 't1').locator('[data-todo-id]')).toHaveCount(2)
  const steps = await undoCount(page)
  await wsTab(page, 't1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review these 2 tasks' }).click()
  await expect(reviewField(page, 'rv')).toHaveValue('@"Ana Lima"')
  // Beside the list the widget shows its medium face: the card, no queue column.
  await expect(widget(page).getByTestId('review-card-title')).toHaveText(/^Ana (report|call)$/)
  await expect(widget(page).getByLabel('Status update · today')).toBeFocused()
  // A jump saves nothing: no undo step, the layout as stored.
  expect(await undoCount(page)).toBe(steps)
  await expectLayoutStored(page)
  // A second jump replaces what it was reviewing, without asking.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with bo')
  await page.keyboard.press('Enter')
  await expect(reviewField(page, 'rv')).toHaveValue('@"Bo Chen"')
  await expect(widget(page).getByTestId('review-card-title')).toHaveText('Bo plan')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

const popup = (page: Page) => page.getByTestId('widget-popup')
const popupReview = (page: Page) => page.locator('[data-review-widget="review-popup"]')

test('on another layout: the person menu’s Review opens the popup review with @Name, no layout switch; closing keeps it, a reload clears it', async ({ page }) => {
  await seedWorkspace(page, OTHER)
  await taskRowByTitle(page, 'Ana report').locator('[data-person-avatar="Ana Lima"]').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review with Ana Lima' }).click()
  await expect(popup(page)).toBeVisible()
  await expect(popup(page)).toHaveAttribute('aria-label', 'Review')
  await expectOpenLayout(page, 'Main')
  await expect(reviewField(page, 'review-popup')).toHaveValue('@"Ana Lima"')
  await expect(popupReview(page).locator('[data-review-row]')).toHaveCount(2)
  await expect(popupReview(page).getByLabel('Status update · today')).toBeFocused()
  // The Review widget on the other layout was left alone.
  expect(await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/list-widget-store.ts' as string)) as { useListWidgetStore: { getState: () => { reviewFilters: Record<string, unknown> } } }
    return mod.useListWidgetStore.getState().reviewFilters.rv ?? null
  })).toBeNull()
  // Closed and opened again from another Review: it continues with the new filter; closing keeps it.
  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with bo')
  await page.keyboard.press('Enter')
  await expect(reviewField(page, 'review-popup')).toHaveValue('@"Bo Chen"')
  await expect(popupReview(page).getByTestId('review-card-title')).toHaveText('Bo plan')
  await page.reload()
  await expect(popup(page)).toHaveCount(0)
})

test('no Review widget anywhere: the Review buttons are all there; Review these N tasks opens the popup review; the task editor opens over it', async ({ page }) => {
  await seedWorkspace(page, NONE)
  await taskRowByTitle(page, 'Ana report').locator('[data-person-avatar="Ana Lima"]').click({ button: 'right' })
  await expect(page.getByRole('menu', { name: '@Ana Lima' }).getByRole('menuitem')).toHaveText(['Review with Ana Lima', 'Show tasks', 'Edit…', 'Delete…'])
  await page.keyboard.press('Escape')
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review')
  await expect(page.getByRole('listbox').getByRole('option').filter({ hasText: /Review (With|List)/ })).not.toHaveCount(0)
  await page.keyboard.press('Escape')

  const steps = await undoCount(page)
  await wsTab(page, 't1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Review these 2 tasks' }).click()
  await expect(popup(page)).toBeVisible()
  await expect(reviewField(page, 'review-popup')).toHaveValue('@"Ana Lima"')
  // Large in the popup: the queue beside the card.
  await expect(popupReview(page).locator('[data-review-row]')).toHaveCount(2)
  expect(await undoCount(page)).toBe(steps)
  await expectLayoutStored(page)

  // A double-click on a queue row opens the task editor, over the popup.
  await popupReview(page).locator('[data-review-row]').first().dblclick()
  const editor = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Done' }) })
  await expect(editor).toBeVisible()
  const onTop = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
    const pop = document.querySelector('[data-testid="widget-popup"]')
    const last = dialogs.at(-1)
    if (!pop || !last || last === pop) return false
    const r = last.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20)
    return hit != null && last.contains(hit)
  })
  expect(onTop).toBe(true)
  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(popup(page)).toBeVisible()
})

test('an open editor with changes asks before the popup review opens; Keep editing cancels it, Discard goes on', async ({ page }) => {
  await seedWorkspace(page, OTHER)
  await wsTab(page, 't1').click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Edit list…' }).click()
  const editor = page.getByTestId('edit-list')
  await expect(editor).toBeVisible()
  await editor.getByRole('textbox', { name: 'Name' }).fill('Waiting on others')

  // The palette opens over the editor without closing it; Review With › Ana asks first.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with ana')
  await page.keyboard.press('Enter')
  const ask = page.getByRole('dialog', { name: /^Save changes to list/ })
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: 'Keep editing', exact: true }).click()
  await expect(ask).toHaveCount(0)
  await expect(editor).toBeVisible()
  await expect(popup(page)).toHaveCount(0)

  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).pressSequentially('review with ana')
  await page.keyboard.press('Enter')
  await ask.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(popup(page)).toBeVisible()
  await expectOpenLayout(page, 'Main')
  await expect(reviewField(page, 'review-popup')).toHaveValue('@"Ana Lima"')
})
