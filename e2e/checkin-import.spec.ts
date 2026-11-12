import { readFile } from 'node:fs/promises'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { openCheckinDialog, openCheckinImport, seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { readStore } from './fixtures/db'

/**
 * The check-in reply import in a real browser: a reply pasted as a real
 * `paste` event (both clipboard flavours) is read, one proposed change is
 * unticked, Apply writes the rest (completion, replaced notes, follow-up),
 * and Undo puts every task back — old notes included. A reply to an email
 * from before status updates (its `Progress:` label) adds a status update,
 * dated today, that Undo takes back. The dialog opens from the Review
 * widget's Paste reply (`checkin-entry-points.spec.ts`) and from the
 * check-in dialog's `Paste a reply…` link.
 */

const FIXTURE = 'src/test/fixtures/checkin-replies/synthetic-new-outlook-inline'

const RUNBOOK_NOTES = [
  'Cover the cutover sequence, rollback steps and who is on call.',
  '- Link the existing **DB checklist**',
  '- Ask Nina about the [rollback window](https://example.com/runbook)',
  '- [ ] Dry run on staging',
].join('\n')

// The four tasks the fixture replies to (`src/test/fixtures/checkin-replies/sample-tasks.ts`),
// last modified before the email's send date (2026-10-12).
const modifiedAt = '2026-10-10T15:30'
const seed: WorkspaceSeed = {
  people: [{ name: 'Marcus Chen', email: 'marcus.chen@example.com' }],
  listDefinitions: [{ name: 'All' }],
  tasks: [
    {
      title: 'Answer Northwind’s security questionnaire', people: ['Marcus Chen'], uid: '0c4d8e17-5b2a-4f1e-9c3d-7a6b5c4d3e2f',
      statusUpdates: [{ text: 'half done', inDays: -3 }], notes: 'Sections 4 and 7 still open.\nSam has the SOC 2 letter.', modifiedAt,
    },
    // A planned follow-up after today: recording one keeps it.
    { title: 'Review the staging load-test results', people: ['Marcus Chen'], uid: 'b71e05d9-1111-4222-8333-444455556666', statusUpdates: [{ text: '40%', inDays: -3 }], followupInDays: 5, modifiedAt },
    { title: 'Draft the migration runbook', people: ['Marcus Chen'], uid: '3f9a1c42-aaaa-4bbb-8ccc-ddddeeeeffff', notes: RUNBOOK_NOTES, modifiedAt },
    {
      title: 'Renew the Contoso support contract — confirm pricing tier & seats (<50 users?)', people: ['Marcus Chen'],
      uid: '9e8d7c6b-5a49-4382-8716-a5b4c3d2e1f0', modifiedAt,
    },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
}

interface TaskRow { title: string; isCompleted: boolean; updates: string[]; notes?: string; lastFollowupAt?: string }

/** Every task row, straight from IndexedDB, by title, with its status update texts (oldest written first). */
async function readTasks(page: Page): Promise<Record<string, TaskRow>> {
  const updates = await readStore<{ todoId: number; text: string }>(page, 'statusUpdates')
  const tasks = await readStore<Omit<TaskRow, 'lastFollowupAt' | 'updates'> & { id: number; lastFollowupAt?: Date }>(page, 'todos')
  const rows = tasks.map((t) => ({
    title: t.title,
    isCompleted: t.isCompleted,
    updates: updates.filter((u) => u.todoId === t.id).map((u) => u.text),
    ...(t.notes !== undefined ? { notes: t.notes } : {}),
    ...(t.lastFollowupAt ? { lastFollowupAt: t.lastFollowupAt.toISOString() } : {}),
  }))
  return Object.fromEntries(rows.map((r) => [r.title, r]))
}

/** Pastes `html` + `plain` into the focused paste target as a real `paste` event. */
async function pasteReply(target: Locator, html: string, plain: string) {
  await expect(target).toBeFocused()
  await target.evaluate((el, { html, plain }) => {
    const data = new DataTransfer()
    data.setData('text/html', html)
    data.setData('text/plain', plain)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, { html, plain })
}

test('paste a reply, untick one change, apply; Undo restores the old notes', async ({ page }) => {
  const html = await readFile(`${FIXTURE}.html`, 'utf8')
  const plain = await readFile(`${FIXTURE}.txt`, 'utf8')
  await seedWorkspace(page, seed)

  const dialog = await openCheckinImport(page)
  await expect(dialog).toBeVisible()
  await pasteReply(dialog.getByRole('textbox', { name: 'Paste the reply here' }), html, plain)

  await expect(dialog.getByText('Reply from Marcus Chen')).toBeVisible()
  await expect(dialog.getByText('4 of 4 tasks matched by Ref · 3 changes found')).toBeVisible()
  const apply = dialog.getByRole('button', { name: /^Apply \d+ changes?$/ })
  await expect(apply).toHaveText('Apply 3 changes')

  // The checkboxes all render the same size.
  const boxes = await dialog.locator('input[type="checkbox"]').evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect()
    return `${Math.round(r.width)}x${Math.round(r.height)}`
  }))
  expect(new Set(boxes)).toEqual(new Set(['18x18']))

  // The status update: the new text dated today over the task's newest now — no redline.
  const status = dialog.getByRole('region', { name: 'Answer Northwind’s security questionnaire' }).locator('[data-checkin-status-update]')
  const newestDay = await page.evaluate(() => {
    const d = new Date()
    d.setDate(d.getDate() - 3)
    return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
  })
  await expect(status.locator(':scope > *')).toHaveText(['New status update · today', 'section 4 done', `Newest now: ${newestDay} · half done`])
  await expect(status.locator('del, ins')).toHaveCount(0)
  await expect(dialog.locator('[data-checkin-notes-diff] [data-op="~"]')).toHaveCount(1)

  // Keep the questionnaire's status updates as they are.
  await dialog.getByRole('region', { name: 'Answer Northwind’s security questionnaire' }).getByRole('checkbox', { name: 'Status' }).uncheck()
  await expect(apply).toHaveText('Apply 2 changes')
  await apply.click()
  await expect(dialog).toBeHidden()

  await expect.poll(async () => (await readTasks(page))['Review the staging load-test results']?.isCompleted).toBe(true)
  const after = await readTasks(page)
  expect(after['Answer Northwind’s security questionnaire']?.updates).toEqual(['half done'])
  expect(after['Answer Northwind’s security questionnaire']?.lastFollowupAt).toBeUndefined()
  const runbook = after['Draft the migration runbook']
  expect(runbook?.notes).toBe([
    'Cover the cutover sequence, rollback steps and who is on call.',
    'Nina confirmed Saturday 06:00–08:00 for the cutover.',
    '- Link the existing **DB checklist**',
    '- Agreed the [rollback window](https://example.com/runbook) with Nina',
    '- [ ] Dry run on staging',
  ].join('\n'))
  expect(runbook?.lastFollowupAt).toBeDefined()
  expect(after['Review the staging load-test results']?.lastFollowupAt).toBeDefined()
  // Recorded today: last = now; the planned next follow-up (in 5 days) is
  // kept, a task with none gets today + 1 month.
  const stored = await readStore<{ title: string; lastFollowupAt?: Date; nextFollowupAt?: Date }>(page, 'todos')
  const recorded = stored.find((t) => t.title === 'Review the staging load-test results')
  const runbookRow = stored.find((t) => t.title === 'Draft the migration runbook')
  const expected = await page.evaluate(async (url) => {
    const { addFollowupInterval } = (await import(/* @vite-ignore */ url)) as {
      addFollowupInterval: (from: Date, interval: { count: number; unit: 'd' | 'm' }) => Date
    }
    const t = new Date()
    return {
      today: new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime(),
      planned: addFollowupInterval(t, { count: 5, unit: 'd' }).getTime(),
      next: addFollowupInterval(t, { count: 1, unit: 'm' }).getTime(),
    }
  }, '/src/utils/followup.ts')
  const lastDay = recorded?.lastFollowupAt ? new Date(recorded.lastFollowupAt) : null
  expect(lastDay && new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate()).getTime()).toBe(expected.today)
  expect(recorded?.nextFollowupAt?.getTime()).toBe(expected.planned)
  expect(runbookRow?.nextFollowupAt?.getTime()).toBe(expected.next)
  expect(after['Renew the Contoso support contract — confirm pricing tier & seats (<50 users?)']?.lastFollowupAt).toBeUndefined()

  await expect(page.getByText('Applied 2 changes from Marcus Chen')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await readTasks(page))['Draft the migration runbook']?.notes).toBe(RUNBOOK_NOTES)
  const undone = await readTasks(page)
  expect(undone['Review the staging load-test results']?.isCompleted).toBe(false)
  expect(Object.values(undone).filter((t) => t.lastFollowupAt)).toEqual([])
})

test('a reply to an email sent before status updates (Progress label): Apply adds a status update, Undo takes it back', async ({ page }) => {
  const plain = await readFile('src/test/fixtures/checkin-replies/synthetic-progress-label-plain-quoted.txt', 'utf8')
  await seedWorkspace(page, seed)

  const dialog = await openCheckinImport(page)
  await pasteReply(dialog.getByRole('textbox', { name: 'Paste the reply here' }), '', plain)
  await expect(dialog.getByText('4 of 4 tasks matched by Ref · 3 changes found')).toBeVisible()
  const questionnaire = dialog.getByRole('region', { name: 'Answer Northwind’s security questionnaire' })
  await expect(questionnaire.getByRole('checkbox', { name: 'Status' })).toBeChecked()
  const text = 'section 4 done, section 7 waiting on the pen-test report from Sam'
  await expect(questionnaire.locator('[data-checkin-status-update] > *').nth(1)).toHaveText(text)
  await dialog.getByRole('button', { name: 'Apply 3 changes' }).click()
  await expect(dialog).toBeHidden()

  // Added dated today, with the follow-up it was recorded with; the older entry stays.
  const entries = async () => {
    const todo = (await readStore<{ id: number; title: string }>(page, 'todos')).find((t) => t.title === 'Answer Northwind’s security questionnaire')
    const rows = await readStore<{ todoId: number; text: string; date: Date; followedUp?: true }>(page, 'statusUpdates')
    return rows.filter((u) => u.todoId === todo?.id).map((u) => ({ text: u.text, day: u.date.getDate(), followedUp: u.followedUp ?? false }))
  }
  await expect.poll(async () => (await entries()).length).toBe(2)
  const today = await page.evaluate(() => new Date().getDate())
  expect(await entries()).toEqual(expect.arrayContaining([
    expect.objectContaining({ text: 'half done', followedUp: false }),
    { text, day: today, followedUp: true },
  ]))

  await expect(page.getByText('Applied 3 changes from Marcus Chen')).toBeVisible()
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect.poll(async () => (await entries()).map((u) => u.text)).toEqual(['half done'])
})

test('opens from the check-in dialog’s Paste a reply… link', async ({ page }) => {
  await seedWorkspace(page, seed)
  const checkin = await openCheckinDialog(page)
  await checkin.getByRole('button', { name: 'Paste a reply…' }).click()
  await expect(checkin).toBeHidden()
  const dialog = page.getByRole('dialog', { name: 'Import task update' })
  await expect(dialog.getByRole('textbox', { name: 'Paste the reply here' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
})
