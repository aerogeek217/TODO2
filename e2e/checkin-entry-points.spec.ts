import { readFile } from 'node:fs/promises'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { readStore, writeStores } from './fixtures/db'
import { openFieldPicker, openFilterPicker } from './fixtures/filters'
import { emptyPredicate, pickInReview, seedWorkspace, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * The ways into an email check-in, in a real browser (widget feedback 2B,
 * decision 7): they live only on the Review widget's field — while its filter
 * names only people, Email check-in sends the one person's check-in from the
 * click (the body on the clipboard, the `mailto:` link opened or the `.eml`
 * downloaded, a follow-up recorded that Undo takes back) and Paste reply opens
 * the reply import. With no open tasks in the saved scope, or a refused
 * clipboard, the check-in dialog opens for the person instead, saying why.
 * Every older place is gone: the People group header's envelope, a Breakdown
 * person row's envelope, the person menu's items, the person task dialog's
 * buttons, the People filter's footer and every palette command (Email
 * Check-in ›, Email task check-ins…, Import check-in reply…).
 */

test.use({ viewport: { width: 1440, height: 900 } })

const PEOPLE: WorkspaceSeed['people'] = [
  { name: 'Ada Lovelace', email: 'ada@example.com' },
  { name: 'Bob Stone', email: 'bob@example.com' },
  'Cy Young',
]

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

const checkinDialog = (page: Page) => page.getByRole('dialog', { name: 'Email task check-ins' })

/** The check-in dialog is open with exactly `names` ticked. */
async function expectTicked(page: Page, names: string[]) {
  await expect(checkinDialog(page)).toBeVisible()
  const rows = checkinDialog(page).locator('[data-checkin-row]')
  const ticked: string[] = []
  for (const row of await rows.all()) {
    if (await row.getByRole('checkbox').isChecked()) ticked.push((await row.locator('label').textContent()) ?? '')
  }
  expect(ticked.map((t) => names.find((n) => t.startsWith(n)) ?? t)).toEqual(names)
}

interface AnchorClick { href: string; target: string; download: string; activation: boolean }

/**
 * Records every anchor click (href / target / download, and whether the page
 * still had the user activation a new browsing context needs). A `mailto:`
 * one is not performed (no mail app to hand it to); a download is.
 */
async function recordAnchorClicks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __anchors: AnchorClick[] }
    w.__anchors = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      w.__anchors.push({ href: this.href, target: this.target, download: this.download, activation: navigator.userActivation.isActive })
      if (this.href.startsWith('mailto:')) return
      return click.call(this)
    }
  })
}

const anchorClicks = (page: Page) => page.evaluate(() => (window as unknown as { __anchors: AnchorClick[] }).__anchors)
const mailtoLinks = async (page: Page) => (await anchorClicks(page)).map((a) => a.href).filter((h) => h.startsWith('mailto:'))

/** The clipboard's plain text (the email body). */
const clipboardPlain = (page: Page) => page.evaluate(async () => {
  const [item] = await navigator.clipboard.read()
  return (await item!.getType('text/plain')).text()
})

/** Titles of the tasks with a follow-up recorded, from IndexedDB. */
const followedUp = async (page: Page) =>
  (await readStore<{ title: string; lastFollowupAt?: Date }>(page, 'todos')).filter((t) => t.lastFollowupAt).map((t) => t.title).sort()

/**
 * A send went out: the link (opened in a new context while the gesture's
 * user activation still held), the body, the follow-up and its notice; Undo
 * takes the follow-up back.
 */
async function expectSent(page: Page, { mailto, person, titles }: { mailto: string; person: string; titles: string[] }) {
  await expect.poll(() => mailtoLinks(page)).toEqual([mailto])
  const link = (await anchorClicks(page)).find((a) => a.href === mailto)
  expect(link).toMatchObject({ target: '_blank', activation: true })
  expect(await clipboardPlain(page)).toMatch(new RegExp(`Check-in for ${person} · sent \\d{4}-\\d{2}-\\d{2}`))
  await expect(checkinDialog(page)).toHaveCount(0)
  const n = titles.length
  await expect(page.getByText(`Check-in for ${person} opened · ${n} ${n === 1 ? 'task' : 'tasks'} followed up`)).toBeVisible()
  // The snackbar's second line: the address it went to (or none) and how to finish.
  const to = decodeURIComponent(mailto.slice('mailto:'.length).split('?')[0] ?? '')
  await expect(page.locator('[data-snackbar-detail]')).toHaveText(to === ''
    ? `Opened a message to ${person}. The body is on your clipboard: paste it with Ctrl+V. Add the recipient in your mail app.`
    : `Opened a message to ${person} <${to}>. The body is on your clipboard: paste it with Ctrl+V.`)
  await expect.poll(() => followedUp(page)).toEqual([...titles].sort())
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(() => followedUp(page)).toEqual([])
}

async function setup(page: Page, context: BrowserContext) {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await recordAnchorClicks(page)
  await seedWorkspace(page, SEED)
}

/** Saves check-in settings straight to the database and reloads, so the app starts with them. */
async function withCheckinSettings(page: Page, settings: { checkinOpenMethod?: string; checkinTaskFilter?: string }) {
  await writeStores(page, { put: { settings: Object.entries(settings).map(([key, value]) => ({ key, value })) } })
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

const groupHeader = (page: Page, name: string): Locator =>
  wsListWidget(page, 't1').locator('[data-person-group]').filter({ hasText: name })
const reviewWidget = (page: Page) => page.locator('[data-review-widget="rv"]')
/** The Review widget's Email check-in, once its filter names one person (`pickInReview`). */
const widgetSend = (page: Page) => reviewWidget(page).getByRole('button', { name: 'Email check-in' })
const importDialog = (page: Page) => page.getByRole('dialog', { name: 'Import task update' })

test('the Review widget’s Email check-in sends the one person’s check-in at once — with or without an address', async ({ page, context }) => {
  await setup(page, context)
  expect(await mailtoLinks(page)).toEqual([])
  await pickInReview(page, 'rv', 'Bob')
  await widgetSend(page).click()
  await expectSent(page, {
    mailto: 'mailto:bob@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Bob Stone',
    titles: ['Bob only', 'Review plan'],
  })

  // A person without an email: an empty To, the name nowhere in it.
  await page.evaluate(() => { (window as unknown as { __anchors: unknown[] }).__anchors = [] })
  await reviewWidget(page).getByRole('button', { name: 'Clear the filter' }).click()
  await pickInReview(page, 'rv', 'Cy')
  await widgetSend(page).click()
  await expectSent(page, { mailto: 'mailto:?subject=Task%20check-in%3A%201%20open%20task', person: 'Cy Young', titles: ['Cy only'] })
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
  await expect(taskDialog.getByRole('button', { name: /Email check-in|Paste reply/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // A People group header: no envelope, on hover or otherwise.
  await groupHeader(page, 'Bob Stone').hover()
  await expect(wsListWidget(page, 't1').getByRole('button', { name: /Email check-in/ })).toHaveCount(0)

  // The Breakdown's person rows: Review, no envelope.
  const bobRow = page.locator('[data-glance-tab="dash"] [data-breakdown-row]').filter({ hasText: 'Bob Stone' })
  await bobRow.hover()
  await expect(bobRow.getByTestId('breakdown-review')).toBeVisible()
  await expect(bobRow.getByRole('button', { name: /Email check-in/ })).toHaveCount(0)

  // The top-bar People filter: Review alone in its footer.
  await openFilterPicker(page, 'People')
  await page.getByRole('option', { name: 'Ada Lovelace' }).click()
  await expect(page.getByRole('button', { name: 'Review with Ada Lovelace' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^(Email check-in|Paste reply)/ })).toHaveCount(0)
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

test('several people: the widget’s Email check-in is a menu of them', async ({ page, context }) => {
  await setup(page, context)
  await pickInReview(page, 'rv', 'Ada', 'Bob')
  await widgetSend(page).click()
  const menu = page.getByRole('menu')
  await expect(menu.getByRole('menuitem')).toHaveText(['Email check-in to Ada Lovelace', 'Email check-in to Bob Stone'])
  await menu.getByRole('menuitem', { name: 'Email check-in to Ada Lovelace' }).click()
  await expectSent(page, {
    mailto: 'mailto:ada@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Ada Lovelace',
    titles: ['Overdue report', 'Review plan'],
  })
})

test('fallback: no open tasks match the saved check-in filter: opens the dialog for the person, saying why', async ({ page, context }) => {
  await setup(page, context)
  await withCheckinSettings(page, { checkinTaskFilter: JSON.stringify({ ...emptyPredicate(), markers: [{ values: ['focus'] }] }) })
  await pickInReview(page, 'rv', 'Ada')
  await widgetSend(page).click()
  await expectTicked(page, ['Ada Lovelace'])
  await expect(checkinDialog(page).getByRole('status'))
    .toHaveText('Ada Lovelace has no open tasks that match the check-in filter, so nothing was sent. Change the filter under Which tasks.')
  expect(await mailtoLinks(page)).toEqual([])
  expect(await followedUp(page)).toEqual([])
})

test('fallback: a refused clipboard opens nothing and opens the dialog for the person, saying why', async ({ page, context }) => {
  await setup(page, context)
  await page.evaluate(() => {
    const refuse = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
    Object.defineProperty(navigator.clipboard, 'write', { configurable: true, value: refuse })
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: refuse })
  })
  await pickInReview(page, 'rv', 'Bob')
  await widgetSend(page).click()
  await expectTicked(page, ['Bob Stone'])
  await expect(checkinDialog(page).getByRole('status'))
    .toHaveText('Couldn’t copy the email to the clipboard, so nothing was opened. Try again.')
  expect(await mailtoLinks(page)).toEqual([])
  expect(await followedUp(page)).toEqual([])
})

test('.eml method: the one-click send downloads the draft (no To header without an address)', async ({ page, context }) => {
  await setup(page, context)
  await withCheckinSettings(page, { checkinOpenMethod: 'eml' })
  await pickInReview(page, 'rv', 'Cy')
  const downloadPromise = page.waitForEvent('download')
  await widgetSend(page).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^Check-in - Cy Young - \d{4}-\d{2}-\d{2}\.eml$/)
  const eml = await readFile((await download.path())!, 'utf8')
  expect(eml).toMatch(/^X-Unsent: 1\r\nSubject: Task check-in: 1 open task\r\n/)
  expect(eml).not.toMatch(/^To:/im)
  await expect(checkinDialog(page)).toHaveCount(0)
  await expect(page.getByText('Check-in for Cy Young downloaded · 1 task followed up')).toBeVisible()
  await expect(page.locator('[data-snackbar-detail]'))
    .toHaveText(/^Downloaded the draft for Cy Young \(Check-in - Cy Young - \d{4}-\d{2}-\d{2}\.eml\) — open it from your Downloads folder to review and send\. Add the recipient in your mail app\.$/)
  await expect.poll(() => followedUp(page)).toEqual(['Cy only'])
  expect(await mailtoLinks(page)).toEqual([])
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