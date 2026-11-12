import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { readStore, writeStores } from './fixtures/db'
import { openFieldPicker, openFilterPicker } from './fixtures/filters'
import { emptyPredicate, pickInReview, seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * The ways into a check-in, in a real browser (widget feedback 2B, decision
 * 7; check-ins by copy): they live only on the Review widget's field — while
 * its filter names only people, Check-in opens the check-in dialog for those
 * people (the first selected; nothing copied, sent or recorded until the
 * user copies) and Paste reply opens the reply import. Every older place is
 * gone: the People group header's envelope, a Breakdown person row's
 * envelope, the person menu's items, the person task dialog's buttons, the
 * People filter's footer and every palette command.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const PEOPLE: WorkspaceSeed['people'] = ['Ada Lovelace', 'Bob Stone', 'Cy Young']

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Overdue report', people: ['Ada Lovelace'], dueInDays: -2 },
  { title: 'Review plan', people: ['Ada Lovelace', 'Bob Stone'], dueInDays: 4 },
  { title: 'Bob only', people: ['Bob Stone'] },
  { title: 'Cy only', people: ['Cy Young'] },
  { title: 'Nobody’s', people: [] },
]

/** A People Breakdown (`dash`) over a Review widget (`rv`), beside a People-grouped list (`t1`). */
const SEED: WorkspaceSeed = {
  people: PEOPLE,
  listDefinitions: [{ name: 'Team', grouping: 'people' }],
  tasks: TASKS,
  layouts: [{
    name: 'Main',
    columns: [
      {
        id: 'c1',
        rows: [
          wsRow({ id: 'k1', tabs: [{ id: 'dash', kind: 'breakdown', glance: { name: 'People', splitBy: 'people' } }] }),
          wsRow({ id: 'k3', tabs: [{ id: 'rv', kind: 'review' }] }),
        ],
      },
      { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
    ],
  }],
}

const checkinDialog = (page: Page) => page.getByRole('dialog', { name: 'Task check-ins' })
const peopleList = (page: Page) => checkinDialog(page).getByRole('listbox', { name: 'People' })

/** The check-in dialog is open, listing `first` first, the first of them selected. */
async function expectOpenedFor(page: Page, first: string[]) {
  await expect(checkinDialog(page)).toBeVisible()
  const options = peopleList(page).getByRole('option')
  for (const [i, name] of first.entries()) await expect(options.nth(i)).toContainText(name)
  await expect(peopleList(page).getByRole('option', { selected: true })).toContainText(first[0]!)
}

/** Records every anchor click's href (a `mailto:` would be one). */
async function recordAnchorClicks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __anchors: string[] }
    w.__anchors = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      w.__anchors.push(this.href)
      return click.call(this)
    }
  })
}

const mailtoLinks = async (page: Page) =>
  (await page.evaluate(() => (window as unknown as { __anchors: string[] }).__anchors)).filter((h) => h.startsWith('mailto:'))

/** Titles of the tasks with a follow-up recorded, from IndexedDB. */
const followedUp = async (page: Page) =>
  (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos')).filter((t) => t.lastFollowupAt).map((t) => t.title).sort()

async function setup(page: Page, context: BrowserContext) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await recordAnchorClicks(page)
  await seedWorkspace(page, SEED)
}

/** Saves the check-in filter straight to the database and reloads, so the app starts with it. */
async function withCheckinFilter(page: Page, value: string) {
  await writeStores(page, { put: { settings: [{ key: 'checkinTaskFilter', value }] } })
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

const groupHeader = (page: Page, name: string): Locator =>
  wsListWidget(page, 't1').locator('[data-person-group]').filter({ hasText: name })
const reviewWidget = (page: Page) => page.locator('[data-review-widget="rv"]')
/** The Review widget's Check-in, once its filter names only people (`pickInReview`). */
const widgetCheckin = (page: Page) => reviewWidget(page).getByRole('button', { name: 'Check-in' })
const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Import task update' })

test('the Review widget’s Check-in opens the dialog for the one person: nothing copied, sent or recorded', async ({ page, context }) => {
  await setup(page, context)
  await pickInReview(page, 'rv', 'Bob')
  await widgetCheckin(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('Check-in for Bob Stone…')
  await widgetCheckin(page).click()
  await expectOpenedFor(page, ['Bob Stone'])
  await expect(checkinDialog(page).getByTestId('checkin-subject')).toHaveText('Task check-in: 2 open tasks')
  expect(await mailtoLinks(page)).toEqual([])
  expect(await followedUp(page)).toEqual([])
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
})

test('the old places are gone: the task dialog, the group header, its menu, the Breakdown row, the People filter, the palette', async ({ page, context }) => {
  await setup(page, context)
  const taskDialog = page.locator('[data-task-dialog]')

  // The person task dialog: Review only (a Review widget is on the layout), no check-in buttons.
  const row = wsListWidget(page, 't1').locator('[data-list-group="person-1"] [data-todo-id]').filter({ hasText: 'Review plan' })
  await row.locator('[data-person-avatar="Bob Stone"]').click({ button: 'right' })
  await expect(page.getByRole('menu', { name: '@Bob Stone' }).getByRole('menuitem')).toHaveText(['Review with Bob Stone', 'Show tasks', 'Edit…', 'Delete…'])
  await page.getByRole('menuitem', { name: 'Show tasks' }).click()
  await expect(taskDialog.getByRole('heading')).toHaveText('Bob Stone')
  await expect(taskDialog.getByRole('group', { name: 'Actions for Bob Stone' }).getByRole('button')).toHaveText(['Review'])
  await expect(taskDialog.getByRole('button', { name: /Check-in|Paste reply/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // A People group header: no envelope, on hover or otherwise.
  await groupHeader(page, 'Bob Stone').hover()
  await expect(wsListWidget(page, 't1').getByRole('button', { name: /Check-in/ })).toHaveCount(0)

  // The Breakdown's person rows: Review, no envelope.
  const bobRow = page.locator('[data-glance-tab="dash"] [data-breakdown-row]').filter({ hasText: 'Bob Stone' })
  await bobRow.hover()
  await expect(bobRow.getByTestId('breakdown-review')).toBeVisible()
  await expect(bobRow.getByRole('button', { name: /Check-in/ })).toHaveCount(0)

  // The top-bar People filter: Review alone in its footer.
  await openFilterPicker(page, 'People')
  await page.getByRole('option', { name: 'Ada Lovelace' }).click()
  await expect(page.getByRole('button', { name: 'Review with Ada Lovelace' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Check-in|Paste reply)/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // The palette: no check-in command at all — at rest, or searched for.
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder(/Find tasks, commands/)
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.filter({ hasText: 'Open Settings' })).toHaveCount(1)
  await expect(options.filter({ hasText: /check-in/i })).toHaveCount(0)
  await input.pressSequentially('>check-in')
  await expect(options.filter({ hasText: 'Open Settings' })).toHaveCount(0)
  await expect(options.filter({ hasText: /check-in/i })).toHaveCount(0)
  expect(await mailtoLinks(page)).toEqual([])
})

test('the header menu opens at the pointer or under the header, inside the window, and its items work', async ({ page, context }) => {
  await setup(page, context)
  const vw = page.viewportSize()!.width
  const menu = page.getByRole('menu', { name: 'Bob Stone group' })

  // Right-click near the right edge of the header (the list is in the middle column): the menu stays inside the window.
  const header = groupHeader(page, 'Bob Stone')
  const box = (await header.boundingBox())!
  const at = { x: box.x + box.width - 6, y: box.y + box.height / 2 }
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Review with Bob Stone', 'Show tasks', 'Edit…', 'Delete…', 'Copy 2 tasks'])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  const m = (await menu.boundingBox())!
  expect(m.x + m.width).toBeLessThanOrEqual(vw)
  expect(Math.abs(m.y - at.y)).toBeLessThan(8)

  // Show tasks → the person's task dialog.
  await menu.getByRole('menuitem', { name: 'Show tasks' }).click()
  const taskDialog = page.locator('[data-task-dialog]')
  await expect(taskDialog.getByRole('heading')).toHaveText('Bob Stone')
  await expect(taskDialog.locator('[data-todo-id]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // Shift+F10 on the focused header: the menu opens under it; Review (Enter) jumps to the Review widget.
  const collapse = header.getByRole('button', { expanded: true })
  await collapse.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  const hb = (await header.boundingBox())!
  const kb = (await menu.boundingBox())!
  expect(kb.y).toBeGreaterThanOrEqual(hb.y + hb.height)
  expect(kb.y - (hb.y + hb.height)).toBeLessThan(12)
  await expect(menu.getByRole('menuitem', { name: 'Review with Bob Stone' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('[data-review-widget="rv"]').getByRole('textbox', { name: 'Review filter' })).toHaveValue('@"Bob Stone"')
  // Collapse still works from the header.
  await collapse.click()
  await expect(header.getByRole('button', { name: /^Bob Stone/, expanded: false })).toBeVisible()
})

test('near the bottom of the window the header menu opens upward', async ({ page }) => {
  await seedWorkspace(page, SEED)
  // Shrink the window so the last group's header sits near its bottom.
  const header = groupHeader(page, 'Cy Young')
  const before = (await header.boundingBox())!
  await page.setViewportSize({ width: 1440, height: Math.round(before.y + before.height + 30) })
  const box = (await header.boundingBox())!
  const vh = page.viewportSize()!.height
  expect(vh - (box.y + box.height)).toBeLessThan(80)
  await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' })
  const menu = page.getByRole('menu', { name: 'Cy Young group' })
  await expect(menu).toBeVisible()
  const m = (await menu.boundingBox())!
  expect(m.y + m.height).toBeLessThanOrEqual(vh)
  expect(m.y + m.height).toBeLessThanOrEqual(box.y + box.height / 2 + 1)
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('several people: the widget’s Check-in opens the dialog for all of them, no menu', async ({ page, context }) => {
  await setup(page, context)
  await pickInReview(page, 'rv', 'Ada', 'Bob')
  await widgetCheckin(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('Check-ins…')
  await widgetCheckin(page).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expectOpenedFor(page, ['Ada Lovelace', 'Bob Stone'])
  expect(await followedUp(page)).toEqual([])
})

test('a person with no open tasks matching the saved check-in filter: the dialog opens for them and says so', async ({ page, context }) => {
  await setup(page, context)
  await withCheckinFilter(page, JSON.stringify({ ...emptyPredicate(), markers: [{ values: ['focus'] }] }))
  await pickInReview(page, 'rv', 'Ada')
  await widgetCheckin(page).click()
  await expectOpenedFor(page, ['Ada Lovelace'])
  await expect(checkinDialog(page).getByTestId('checkin-no-tasks')).toHaveText('No open tasks match Which tasks.')
  await expect(checkinDialog(page).getByRole('button', { name: 'Copy message' })).toBeDisabled()
  expect(await mailtoLinks(page)).toEqual([])
  expect(await followedUp(page)).toEqual([])
})

test('paste a reply: the Review widget’s Paste reply opens the reply import, sending nothing', async ({ page, context }) => {
  await setup(page, context)
  await pickInReview(page, 'rv', 'Bob')
  const paste = reviewWidget(page).getByRole('button', { name: 'Paste reply' })
  await paste.click()
  await expect(importDialog(page)).toBeVisible()
  await expect(importDialog(page).getByRole('textbox', { name: 'Paste the reply here' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(importDialog(page)).toHaveCount(0)
  // Nowhere else: the top-bar People filter narrowed to one person offers only Review.
  await openFieldPicker(page, 'People')
  await page.getByRole('option', { name: 'Bob Stone' }).click()
  // (The widget's own Paste reply stays; the footer has none.)
  await expect(page.getByRole('button', { name: /^Paste reply from/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Review with Bob Stone' })).toBeVisible()
  expect(await mailtoLinks(page)).toEqual([])
  expect(await followedUp(page)).toEqual([])
})