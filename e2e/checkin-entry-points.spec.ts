import { readFile } from 'node:fs/promises'
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { readStore, writeStores } from './fixtures/db'
import { emptyPredicate, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The ways into an email check-in, in a real browser. Every entry that names
 * one person sends that person's check-in from the click — the person task
 * dialog's footer, the palette's per-person commands, the envelope and the
 * right-click / Shift+F10 menu on a People group header (placement near the
 * window's edges included), and the top-bar People filter's footer when it
 * is narrowed to one person: the body on the clipboard, the `mailto:` link
 * opened (or the `.eml` downloaded), a follow-up recorded that Undo takes
 * back. With no open tasks in the saved scope, or a refused clipboard, the
 * check-in dialog opens for the person instead, saying why. Several people
 * open the dialog with them ticked.
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

/** A People-grouped list (`t1`) beside a dashboard (`dash`), the list in the right-hand column. */
const SEED: WorkspaceSeed = {
  people: PEOPLE,
  listDefinitions: [{ name: 'Team', grouping: 'people' }],
  tasks: TASKS,
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard' }] }] },
      { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
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
const envelope = (page: Page, name: string) => groupHeader(page, name).getByRole('button', { name: `Email check-in to ${name}` })
const opacity = (el: Locator) => el.evaluate((e) => Number(getComputedStyle(e).opacity))

test('A: the person task dialog’s Email check-in sends at once — with or without an address', async ({ page, context }) => {
  await setup(page, context)
  const taskDialog = page.locator('[data-task-dialog]')

  // A task row's person chip.
  const row = wsListWidget(page, 't1').locator('[data-list-group="person-1"] [data-todo-id]').filter({ hasText: 'Review plan' })
  await row.locator('[data-person-avatar]').first().click({ button: 'right' })
  await page.getByRole('menuitem', { name: 'Show tasks' }).click()
  await expect(taskDialog.getByRole('heading')).toHaveText('Bob Stone')
  const footer = taskDialog.locator('[class*="footer"]')
  await expect(footer.getByRole('button').nth(1)).toHaveText('Email check-in')
  await footer.getByRole('button', { name: 'Email check-in' }).click()
  await expectSent(page, {
    mailto: 'mailto:bob@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Bob Stone',
    titles: ['Bob only', 'Review plan'],
  })
  // The task dialog is still there.
  await expect(taskDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // The dashboard's People row: a person without an email — an empty To, the name nowhere in it.
  await page.evaluate(() => { (window as unknown as { __anchors: unknown[] }).__anchors = [] })
  await page.locator('[data-dashboard="dash"] [data-person-row]').filter({ hasText: 'Cy Young' }).click()
  await expect(taskDialog.getByRole('heading')).toHaveText('Cy Young')
  await taskDialog.getByRole('button', { name: 'Email check-in' }).click()
  await expectSent(page, { mailto: 'mailto:?subject=Task%20check-in%3A%201%20open%20task', person: 'Cy Young', titles: ['Cy only'] })
})

test('B: the palette lists Email check-in per person with open tasks; Enter sends it once the palette closes', async ({ page, context }) => {
  await setup(page, context)
  await page.keyboard.press('Control+k')
  const input = page.getByPlaceholder(/Search tasks, commands/)
  await input.fill('>check-in:')
  const email = page.getByRole('group', { name: 'Email' })
  await expect(email.getByRole('option', { name: /Email check-in: Ada Lovelace/ })).toContainText('2 open tasks')
  await expect(email.getByRole('option', { name: /Email check-in: Bob Stone/ })).toContainText('2 open tasks')
  // No email address is no reason to leave Cy out.
  await expect(email.getByRole('option', { name: /Email check-in: Cy Young/ })).toContainText('1 open task')
  await page.keyboard.press('Escape')

  // Several words each match on their own: "email bob" puts Bob's command on top; Enter runs it.
  await page.keyboard.press('Control+k')
  await input.pressSequentially('email bob')
  const options = page.getByRole('listbox').getByRole('option')
  await expect(options.first()).toContainText('Email check-in: Bob Stone')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Enter')
  // The palette closes; the copy and the link still ride the Enter key's user activation.
  await expect(input).toHaveCount(0)
  await expectSent(page, {
    mailto: 'mailto:bob@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Bob Stone',
    titles: ['Bob only', 'Review plan'],
  })
})

test('C: a People group header shows its envelope on hover and on keyboard focus; it sends at once', async ({ page, context }) => {
  await setup(page, context)
  const widget = wsListWidget(page, 't1')
  await expect(widget.getByTestId('list-group-name')).toHaveText(['Ada Lovelace', 'Bob Stone', 'Cy Young', 'Unassigned'])
  await expect(widget.locator('[data-list-group="unassigned"]').getByRole('button', { name: /Email check-in/ })).toHaveCount(0)

  // Hidden until the header is hovered.
  await page.mouse.move(5, 5)
  await expect.poll(() => opacity(envelope(page, 'Bob Stone'))).toBe(0)
  await groupHeader(page, 'Bob Stone').hover()
  await expect.poll(() => opacity(envelope(page, 'Bob Stone'))).toBe(1)
  await page.mouse.move(5, 5)
  await expect.poll(() => opacity(envelope(page, 'Bob Stone'))).toBe(0)

  // Keyboard: Tab from the header's collapse button reaches it, and it shows.
  await groupHeader(page, 'Ada Lovelace').getByRole('button', { expanded: true }).focus()
  await page.keyboard.press('Tab')
  await expect(envelope(page, 'Ada Lovelace')).toBeFocused()
  await expect.poll(() => opacity(envelope(page, 'Ada Lovelace'))).toBe(1)
  await page.keyboard.press('Enter')
  await expectSent(page, {
    mailto: 'mailto:ada@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Ada Lovelace',
    titles: ['Overdue report', 'Review plan'],
  })
})

test('C: the header menu opens at the pointer or under the header, inside the window, and its items work', async ({ page, context }) => {
  await setup(page, context)
  const vw = page.viewportSize()!.width
  const menu = page.getByRole('menu', { name: 'Bob Stone group' })

  // Right-click near the window's right edge: the menu flips left of the pointer.
  const header = groupHeader(page, 'Bob Stone')
  const box = (await header.boundingBox())!
  const at = { x: box.x + box.width - 6, y: box.y + box.height / 2 }
  expect(vw - at.x).toBeLessThan(120)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem')).toHaveText(['Email check-in: Bob Stone', 'Show all of Bob Stone’s tasks'])
  await expect(menu.getByRole('menuitem').first()).toBeFocused()
  const m = (await menu.boundingBox())!
  expect(m.x + m.width).toBeLessThanOrEqual(vw)
  expect(m.x + m.width).toBeLessThanOrEqual(at.x + 1)
  expect(Math.abs(m.y - at.y)).toBeLessThan(8)

  // Show all → the person's task dialog.
  await menu.getByRole('menuitem', { name: 'Show all of Bob Stone’s tasks' }).click()
  const taskDialog = page.locator('[data-task-dialog]')
  await expect(taskDialog.getByRole('heading')).toHaveText('Bob Stone')
  await expect(taskDialog.locator('[data-todo-id]')).toHaveCount(2)
  await page.keyboard.press('Escape')
  await expect(taskDialog).toHaveCount(0)

  // Shift+F10 on the focused header: the menu opens under it; Email check-in sends at once.
  const collapse = header.getByRole('button', { expanded: true })
  await collapse.focus()
  await page.keyboard.press('Shift+F10')
  await expect(menu).toBeVisible()
  const hb = (await header.boundingBox())!
  const kb = (await menu.boundingBox())!
  expect(kb.y).toBeGreaterThanOrEqual(hb.y + hb.height)
  expect(kb.y - (hb.y + hb.height)).toBeLessThan(12)
  await page.keyboard.press('Enter')
  await expectSent(page, {
    mailto: 'mailto:bob@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Bob Stone',
    titles: ['Bob only', 'Review plan'],
  })
  // Collapse still works from the header.
  await collapse.click()
  await expect(header.getByRole('button', { expanded: false })).toBeVisible()
})

test('C: near the bottom of the window the header menu opens upward', async ({ page }) => {
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

test('D: the top-bar People filter emails the one person it is narrowed to, or opens the dialog for several', async ({ page, context }) => {
  await setup(page, context)
  const peopleButton = page.getByRole('button', { name: /^People filter/ })
  await peopleButton.click()
  // Not narrowed: a hint.
  await expect(page.getByText('Narrow to some people to email them.')).toBeVisible()
  // One person (the first pick replaces "everyone"): sends at once and closes the picker.
  await page.locator('label').filter({ hasText: '@Ada Lovelace' }).click()
  // (The group header's envelope has the same name, but no text.)
  await page.getByRole('button', { name: 'Email check-in to Ada Lovelace', exact: true }).filter({ hasText: 'Email check-in' }).click()
  await expect(page.getByPlaceholder('Search...')).toHaveCount(0)
  await expectSent(page, {
    mailto: 'mailto:ada@example.com?subject=Task%20check-in%3A%202%20open%20tasks',
    person: 'Ada Lovelace',
    titles: ['Overdue report', 'Review plan'],
  })

  // Two people: the dialog with both ticked.
  await peopleButton.click()
  await page.locator('label').filter({ hasText: '@Bob Stone' }).click()
  const action = page.getByRole('button', { name: 'Email check-in to 2 people…' })
  await expect(action).toBeVisible()
  await action.click()
  await expectTicked(page, ['Ada Lovelace', 'Bob Stone'])
  await expect(page.getByPlaceholder('Search...')).toHaveCount(0)
})

test('fallback: no open tasks match the saved check-in filter: opens the dialog for the person, saying why', async ({ page, context }) => {
  await setup(page, context)
  await withCheckinSettings(page, { checkinTaskFilter: JSON.stringify({ ...emptyPredicate(), markers: 'hot' }) })
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Search tasks, commands/).pressSequentially('email ada')
  await page.keyboard.press('Enter')
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
  await groupHeader(page, 'Bob Stone').hover()
  await envelope(page, 'Bob Stone').click()
  await expectTicked(page, ['Bob Stone'])
  await expect(checkinDialog(page).getByRole('status'))
    .toHaveText('Couldn’t copy the email to the clipboard, so nothing was opened. Try again.')
  expect(await mailtoLinks(page)).toEqual([])
  expect(await followedUp(page)).toEqual([])
})

test('.eml method: the one-click send downloads the draft (no To header without an address)', async ({ page, context }) => {
  await setup(page, context)
  await withCheckinSettings(page, { checkinOpenMethod: 'eml' })
  await page.locator('[data-dashboard="dash"] [data-person-row]').filter({ hasText: 'Cy Young' }).click()
  const taskDialog = page.locator('[data-task-dialog]')
  await expect(taskDialog.getByRole('heading')).toHaveText('Cy Young')
  const downloadPromise = page.waitForEvent('download')
  await taskDialog.getByRole('button', { name: 'Email check-in' }).click()
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
