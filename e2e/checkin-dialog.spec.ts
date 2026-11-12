import { expect, test, type Page } from '@playwright/test'
import { ADD_FILTER, pickInReview, seedWorkspace, type WorkspaceSeed, wsRow, wsTab } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The check-in dialog in a real browser, reached from the Review widget's
 * Check-in: the people on the left (one selected; ↑ / ↓ move it), the
 * selected person's message on the right in a sandboxed frame, and Copy,
 * which puts rich HTML + plain text on the clipboard and records nothing —
 * no follow-up, no undo step. Nothing opens a mail app or a new page. Which
 * tasks is a filter line (no People) that narrows the counts and the
 * message at once and is remembered for the next dialog. Under 760px wide
 * the dialog is one column.
 */

const seed: WorkspaceSeed = {
  people: ['Ada Lovelace', 'Bob Stone', 'Cy Young'],
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
      columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }, { id: 'rv', kind: 'review' }] })] }],
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
const checkinDialog = (page: Page) => page.getByRole('dialog', { name: 'Task check-ins' })
const checkinButton = (page: Page) => page.locator('[data-review-widget="rv"]').getByRole('button', { name: 'Check-in' })

/** Opens the Review tab and narrows its field to `names`; then its Check-in. */
async function openFromReview(page: Page, ...names: string[]) {
  await wsTab(page, 'rv').click()
  await pickInReview(page, 'rv', ...names)
  await checkinButton(page).click()
  const dialog = checkinDialog(page)
  await expect(dialog).toBeVisible()
  return dialog
}

test('from the Review widget: the person’s message in the dialog; Copy puts it on the clipboard and records nothing', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seedWorkspace(page, seed)
  const popups: string[] = []
  context.on('page', (p) => { popups.push(p.url()); void p.close().catch(() => {}) })

  const dialog = await openFromReview(page, 'Ada')
  const people = dialog.getByRole('listbox', { name: 'People' })
  await expect(people.getByRole('option', { selected: true })).toContainText('Ada Lovelace')
  await expect(people.getByRole('option', { selected: true })).toContainText('2 tasks')
  await expect(dialog.getByTestId('checkin-subject')).toHaveText('Task check-in: 2 open tasks')

  // The message, in the sandboxed frame.
  const tasks = await readTasks(page)
  const ref = (title: string) => refOf(tasks.find((t) => t.title === title)!.uid)
  const frame = dialog.locator('iframe[title="Check-in for Ada Lovelace"]')
  await expect(frame).toHaveAttribute('sandbox', '')
  const body = page.frameLocator('iframe[title="Check-in for Ada Lovelace"]').locator('body')
  await expect(body).toContainText(`Ref ${ref('Overdue report')}`)
  await expect(body).toContainText(`Ref ${ref('Review plan')}`)
  await expect(body).not.toContainText(`Ref ${ref('Bob only')}`)

  // On open the focus is on Copy (Ada has tasks); Copy keeps it.
  const copy = dialog.getByRole('button', { name: 'Copy message' })
  await expect(copy).toBeFocused()
  await copy.click()
  await expect(copy).toBeFocused()
  await expect(people.getByRole('option', { selected: true })).toContainText('Copied ✓')
  await expect(dialog.getByRole('status')).toHaveText('Copied the check-in for Ada Lovelace. Paste it into your message.')

  const clip = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return { html: await (await item!.getType('text/html')).text(), plain: await (await item!.getType('text/plain')).text() }
  })
  expect(clip.html).toContain(`Ref ${ref('Overdue report')}`)
  expect(clip.html).toContain('Your update')
  expect(clip.plain).toContain(`1. Overdue report  Ref ${ref('Overdue report')}`)
  expect(clip.plain).toMatch(/Check-in for Ada Lovelace · sent \d{4}-\d{2}-\d{2}/)

  // Nothing recorded, nothing to undo, nothing opened.
  expect((await readTasks(page)).filter((t) => t.lastFollowupAt)).toEqual([])
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0)
  expect(popups).toEqual([])
  await expect(page).toHaveURL(/#\/$/)

  // Copy subject: the subject as plain text.
  await dialog.getByRole('button', { name: 'Copy subject' }).click()
  await expect(dialog.getByRole('status')).toHaveText('Copied the subject for Ada Lovelace.')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Task check-in: 2 open tasks')

  // Esc closes it; the focus goes back to the Check-in button.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(checkinButton(page)).toBeFocused()
})

test('several people: the dialog lists them first, the first selected; ↑ / ↓ move the selection and the message follows', async ({ page }) => {
  await seedWorkspace(page, seed)
  const dialog = await openFromReview(page, 'Bob', 'Ada')
  const people = dialog.getByRole('listbox', { name: 'People' })
  await expect(people.getByRole('option')).toHaveText([/Bob Stone/, /Ada Lovelace/, /Cy Young/])
  await expect(people.getByRole('option', { selected: true })).toContainText('Bob Stone')
  await expect(dialog.locator('iframe')).toHaveAttribute('title', 'Check-in for Bob Stone')

  await people.focus()
  await page.keyboard.press('ArrowDown')
  await expect(people.getByRole('option', { selected: true })).toContainText('Ada Lovelace')
  await expect(dialog.locator('iframe')).toHaveAttribute('title', 'Check-in for Ada Lovelace')
  await expect(people).toBeFocused()
  await page.keyboard.press('End')
  await expect(people.getByRole('option', { selected: true })).toContainText('Cy Young')
  await people.getByRole('option', { name: /Bob Stone/ }).click()
  await expect(dialog.locator('iframe')).toHaveAttribute('title', 'Check-in for Bob Stone')
})

test('Which tasks is a filter line: it narrows the counts and the message at once and is remembered', async ({ page }) => {
  await seedWorkspace(page, seed)
  const dialog = await openFromReview(page, 'Ada')
  const row = (name: string) => dialog.locator('[data-checkin-row]').filter({ hasText: name })
  const count = (name: string) => row(name).locator('[data-checkin-count]')

  const line = dialog.getByTestId('checkin-filter')
  await expect(line).toContainText('All open tasks')
  await expect(count('Ada Lovelace')).toHaveText('2 tasks')
  await line.getByRole('button', { name: ADD_FILTER }).click()
  const add = page.getByRole('menu', { name: 'Add a filter' })
  await expect(add.getByRole('menuitem', { name: 'Priority' })).toBeVisible()
  // The check-in is per person: no People filter.
  await expect(add.getByRole('menuitem', { name: 'People' })).toHaveCount(0)
  await add.getByRole('menuitem', { name: /Text contains/ }).click()
  await page.keyboard.type('review')
  await page.keyboard.press('Enter')
  await expect(line.getByTestId('list-filter-chip')).toContainText('review')
  await expect(count('Ada Lovelace')).toHaveText('1 task')
  await expect(count('Bob Stone')).toHaveText('1 task')
  await expect(count('Cy Young')).toHaveText('0 tasks')
  await expect(dialog.getByTestId('checkin-subject')).toHaveText('Task check-in: 1 open task')
  const body = page.frameLocator('iframe[title="Check-in for Ada Lovelace"]').locator('body')
  await expect(body).toContainText('Review plan')
  await expect(body).not.toContainText('Overdue report')
  await expect.poll(async () => (await readStore<{ key: string; value: string }>(page, 'settings'))
    .find((r) => r.key === 'checkinTaskFilter')?.value ?? '').toContain('"searchText":"review"')

  // Cy has none that match: the message's place says so and Copy is off.
  await row('Cy Young').click()
  await expect(dialog.getByTestId('checkin-no-tasks')).toHaveText('No open tasks match Which tasks.')
  await expect(dialog.getByRole('button', { name: 'Copy message' })).toBeDisabled()

  // Remembered: the next dialog, after a reload, has it.
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  const again = await openFromReview(page, 'Ada')
  await expect(again.getByTestId('checkin-filter').getByTestId('list-filter-chip')).toContainText('review')
  await expect(again.locator('[data-checkin-row]').filter({ hasText: 'Ada Lovelace' }).locator('[data-checkin-count]')).toHaveText('1 task')
})

test('two columns when wide; one column (people, options, then the message) under 760px', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 860 })
  await seedWorkspace(page, seed)
  const dialog = await openFromReview(page, 'Ada')
  const people = dialog.getByRole('listbox', { name: 'People' })
  const message = dialog.getByTestId('checkin-message')
  let a = (await people.boundingBox())!
  let b = (await message.boundingBox())!
  expect(b.x).toBeGreaterThan(a.x + a.width - 1)
  const box = (await dialog.boundingBox())!
  expect(box.width).toBeLessThanOrEqual(980)

  await page.setViewportSize({ width: 700, height: 860 })
  a = (await people.boundingBox())!
  b = (await message.boundingBox())!
  expect(b.y).toBeGreaterThan(a.y + a.height - 1)
  const narrow = (await dialog.boundingBox())!
  expect(narrow.x).toBeGreaterThanOrEqual(15)
  expect(narrow.x + narrow.width).toBeLessThanOrEqual(700 - 15)
  // The message still shows, scrolled to inside the dialog.
  await message.getByRole('button', { name: 'Copy message' }).scrollIntoViewIfNeeded()
  await expect(message.getByRole('button', { name: 'Copy message' })).toBeInViewport()
})
