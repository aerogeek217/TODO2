import { readFile } from 'node:fs/promises'
import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The email check-in dialog in a real browser: Copy & open puts the email
 * (rich HTML with each task's Ref) on the clipboard and opens a mailto: link
 * without the page unloading or the unsaved-layout prompt appearing; the
 * .eml method downloads an unsent draft; both record a follow-up that Undo
 * takes back.
 */

const seed: WorkspaceSeed = {
  people: [
    { name: 'Ada Lovelace', email: 'ada@example.com' },
    { name: 'Bob Stone', email: 'bob@example.com' },
    'Cy Young',
  ],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Overdue report', people: ['Ada Lovelace'], dueInDays: -2, notes: 'First line\n- a bullet' },
    { title: 'Review plan', people: ['Ada Lovelace', 'Bob Stone'], dueInDays: 4 },
    { title: 'Bob only', people: ['Bob Stone'] },
    { title: 'Cy only', people: ['Cy Young'] },
  ],
  layouts: [
    {
      name: 'Main',
      columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }, { id: 'n1', kind: 'notes' }] }] }],
    },
  ],
}

interface TaskRow { title: string; uid: string; lastFollowupAt?: string }

/** Every task row, straight from IndexedDB. */
async function readTasks(page: Page): Promise<TaskRow[]> {
  const rows = await readStore<{ title: string; uid: string; lastFollowupAt?: Date }>(page, 'todos')
  return rows.map((t) => ({ title: t.title, uid: t.uid, ...(t.lastFollowupAt ? { lastFollowupAt: t.lastFollowupAt.toISOString() } : {}) }))
}

const refOf = (uid: string) => uid.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)

/** Records every anchor click (href / target / download) and still performs it. */
async function recordAnchorClicks(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __anchors: Array<{ href: string; target: string; download: string }> }
    w.__anchors = []
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      w.__anchors.push({ href: this.href, target: this.target, download: this.download })
      return click.call(this)
    }
  })
}

const anchors = (page: Page) => page.evaluate(() => (window as unknown as { __anchors: Array<{ href: string; target: string; download: string }> }).__anchors)

async function makeLayoutDirty(page: Page) {
  await wsTab(page, 'n1').click()
  await wsTab(page, 'n1').getByRole('button', { name: 'Close Notes' }).click()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
}

async function openFromPalette(page: Page) {
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Search tasks, commands/).fill('>check-in')
  await page.getByRole('option', { name: /Email task check-ins/ }).click()
  const dialog = page.getByRole('dialog', { name: 'Email task check-ins' })
  await expect(dialog).toBeVisible()
  return dialog
}

test('Copy & open: rich body on the clipboard, mailto: opened, no unsaved-layout prompt, follow-up + Undo', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await recordAnchorClicks(page)
  await seedWorkspace(page, seed)
  await makeLayoutDirty(page)

  const dialogs: string[] = []
  page.on('dialog', (d) => { dialogs.push(d.type()); void d.dismiss() })
  const popups: string[] = []
  context.on('page', (p) => { popups.push(p.url()); void p.close().catch(() => {}) })
  await page.evaluate(() => { (window as unknown as { __alive: boolean }).__alive = true })

  const dialog = await openFromPalette(page)
  const ada = dialog.locator('[data-checkin-row]').filter({ hasText: 'Ada Lovelace' })
  await expect(ada).toContainText('2 tasks')
  await ada.getByRole('checkbox').check()
  await ada.getByRole('button', { name: 'Copy & open for Ada Lovelace' }).click()
  await expect(ada).toContainText('Opened ✓')
  await expect(dialog.getByRole('status')).toHaveText('Opened a message to Ada Lovelace. The body is on your clipboard: paste it with Ctrl+V.')

  // The mailto: link went to a new browsing context: the page stayed, no prompt.
  expect(await anchors(page)).toEqual([
    { href: 'mailto:ada@example.com?subject=Task%20check-in%3A%202%20open%20tasks', target: '_blank', download: '' },
  ])
  // The page is the same one (a reload would have dropped `__alive`); this
  // round trip also delivers any dialog the click opened before it.
  expect(await page.evaluate(() => (window as unknown as { __alive?: boolean }).__alive)).toBe(true)
  expect(dialogs).toEqual([])
  await expect(page).toHaveURL(/#\/$/)
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')

  // The clipboard holds the email: HTML with each task's ref, and plain text.
  const tasks = await readTasks(page)
  const ref = (title: string) => refOf(tasks.find((t) => t.title === title)!.uid)
  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { html: await (await item!.getType('text/html')).text(), plain: await (await item!.getType('text/plain')).text() }
  })
  expect(clip.html).toContain(`Ref ${ref('Overdue report')}`)
  expect(clip.html).toContain(`Ref ${ref('Review plan')}`)
  expect(clip.html).not.toContain(`Ref ${ref('Bob only')}`)
  expect(clip.html).toContain('Your update')
  expect(clip.plain).toContain(`1. Overdue report  Ref ${ref('Overdue report')}`)
  expect(clip.plain).toMatch(/Check-in for Ada Lovelace · sent \d{4}-\d{2}-\d{2}/)

  // Sending recorded a follow-up on Ada's two tasks only; Undo takes it back.
  await expect.poll(async () => (await readTasks(page)).filter((t) => t.lastFollowupAt).map((t) => t.title).sort())
    .toEqual(['Overdue report', 'Review plan'])
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await readTasks(page)).filter((t) => t.lastFollowupAt).length).toBe(0)

  // Control: navigating the page itself to a mailto: link does trip the
  // unsaved-layout prompt — what the new-context link avoids.
  await page.evaluate(() => {
    const a = document.createElement('a')
    a.href = 'mailto:x@example.com'
    document.body.appendChild(a)
    a.click()
    a.remove()
  })
  await expect.poll(() => dialogs).toEqual(['beforeunload'])
})

test('Download .eml: an unsent draft with both bodies; one click per person', async ({ page }) => {
  await seedWorkspace(page, seed)
  const dialog = await openFromPalette(page)
  await dialog.getByRole('radio', { name: /Download draft \(\.eml\)/ }).check()

  const ada = dialog.locator('[data-checkin-row]').filter({ hasText: 'Ada Lovelace' })
  const bob = dialog.locator('[data-checkin-row]').filter({ hasText: 'Bob Stone' })
  await ada.getByRole('checkbox').check()
  await bob.getByRole('checkbox').check()

  const downloadPromise = page.waitForEvent('download')
  await ada.getByRole('button', { name: 'Download .eml for Ada Lovelace' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^Check-in - Ada Lovelace - \d{4}-\d{2}-\d{2}\.eml$/)
  const eml = await readFile((await download.path())!, 'utf8')
  expect(eml).toMatch(/^X-Unsent: 1\r\n/)
  expect(eml).toContain('To: "Ada Lovelace" <ada@example.com>\r\n')
  expect(eml).toContain('Subject: Task check-in: 2 open tasks\r\n')
  const parts = [...eml.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)]
    .map((m) => Buffer.from(m[1]!.replace(/\r\n/g, ''), 'base64').toString('utf8'))
  expect(parts).toHaveLength(2)
  const tasks = await readTasks(page)
  const overdueRef = refOf(tasks.find((t) => t.title === 'Overdue report')!.uid)
  expect(parts[0]).toContain(`Ref ${overdueRef}`)
  expect(parts[1]).toContain(`Ref ${overdueRef}`)
  expect(parts[1]).toContain('<li')

  await expect(ada).toContainText('Downloaded ✓')
  // Focus moves on to the next person still to send.
  await expect(bob.getByRole('button', { name: 'Download .eml for Bob Stone' })).toBeFocused()
  await expect.poll(async () => (await readTasks(page)).filter((t) => t.lastFollowupAt).map((t) => t.title).sort())
    .toEqual(['Overdue report', 'Review plan'])
})

test('Which tasks menu shows counts and saves the choice; Add email opens the person editor', async ({ page }) => {
  await seedWorkspace(page, seed)
  const dialog = await openFromPalette(page)
  const cy = dialog.locator('[data-checkin-row]').filter({ hasText: 'Cy Young' })
  await expect(cy.getByRole('checkbox')).toBeDisabled()

  await dialog.getByRole('button', { name: /Which tasks/ }).click()
  const menu = page.getByRole('menu', { name: 'Which tasks' })
  // Nobody ticked: the counts cover everyone listed (Ada 2, Bob 2, Cy 1).
  await expect(menu.getByRole('menuitemradio', { name: /All open tasks/ })).toContainText('5 tasks')
  await expect(menu.getByRole('menuitemradio', { name: /Overdue \+ next 2 weeks/ })).toContainText('3 tasks')
  await menu.getByRole('menuitemradio', { name: /Overdue \+ next 2 weeks/ }).click()
  await expect(menu).toBeHidden()
  await expect(cy).toContainText('0 tasks')

  await cy.getByRole('button', { name: 'Add email for Cy Young' }).click()
  const email = page.getByRole('textbox', { name: 'Email' })
  await expect(email).toBeFocused()
  await email.fill('cy@example.com')
  await page.keyboard.press('Enter')
  await expect(cy).toContainText('cy@example.com')
  await expect(cy.getByRole('checkbox')).toBeChecked()

  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  const again = await openFromPalette(page)
  await expect(again.getByRole('button', { name: /Which tasks/ })).toContainText('Overdue + next 2 weeks')
})
