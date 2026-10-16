import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace } from './fixtures/workspace'

/**
 * Creating a task in a real browser, the three ways: Quick Add, a note's
 * line (Convert), and the task editor (Quick Add's Details ⇥ handoff). The
 * same text makes the same task each way — they share one rule set. Also the
 * editor's Progress on create, and the notes' rich copy (the shared
 * clipboard write). Real-browser because the popups, dialog stacking and
 * the clipboard are.
 */

const LAYOUT = {
  layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'notes', kind: 'notes' as const }] }] }] }],
  people: [{ name: 'Ben Ortiz', initials: 'BO' }],
  tags: ['planning'],
}

/** People, an existing and a new tag, markers and every date command; a trailing space closes the popup. */
const TOKENS = '@Ben #planning #fresh /urgent /due tomorrow /repeat monthly /followup 2w '

interface StoredTask {
  urgent?: boolean
  important?: boolean
  focus?: boolean
  statusId?: number
  dueDate?: string
  nextFollowupAt?: string
  recurrence?: string
  progress?: string
  people: string[]
  tags: string[]
}

/** The stored task with this title (dates as local `Y-M-D`), with its people and tag names. */
async function readTask(page: Page, title: string): Promise<StoredTask | null> {
  return await page.evaluate(async (target) => await new Promise<StoredTask | null>((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const tx = idb.transaction(['todos', 'todoPeople', 'people', 'todoTags', 'tags'], 'readonly')
      const get = (name: string) => tx.objectStore(name).getAll()
      const [todos, todoPeople, people, todoTags, tags] = ['todos', 'todoPeople', 'people', 'todoTags', 'tags'].map(get)
      tx.oncomplete = () => {
        idb.close()
        const t = (todos!.result as Array<Record<string, unknown>>).find((r) => r.title === target)
        if (!t) { resolve(null); return }
        const day = (d: unknown) => (d instanceof Date ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : undefined)
        const names = (joins: IDBRequest, key: string, rows: IDBRequest) => {
          const byId = new Map((rows.result as Array<{ id: number; name: string }>).map((r) => [r.id, r.name]))
          return (joins.result as Array<Record<string, number>>)
            .filter((j) => j.todoId === t.id)
            .map((j) => byId.get(j[key]!) ?? '?')
            .sort()
        }
        resolve({
          urgent: t.urgent as boolean | undefined,
          important: t.important as boolean | undefined,
          focus: t.focus as boolean | undefined,
          statusId: t.statusId as number | undefined,
          dueDate: day(t.dueDate),
          nextFollowupAt: day(t.nextFollowupAt),
          recurrence: (t.recurrenceRule as { type?: string } | undefined)?.type,
          progress: t.progress as string | undefined,
          people: names(todoPeople!, 'personId', people!),
          tags: names(todoTags!, 'tagId', tags!),
        })
      }
      tx.onerror = () => { idb.close(); reject(tx.error) }
    }
    req.onerror = () => reject(req.error)
  }), title)
}

async function tagCount(page: Page, name: string): Promise<number> {
  return await page.evaluate(async (target) => await new Promise<number>((resolve, reject) => {
    const req = indexedDB.open('todo2')
    req.onsuccess = () => {
      const idb = req.result
      const all = idb.transaction(['tags'], 'readonly').objectStore('tags').getAll()
      all.onsuccess = () => { idb.close(); resolve((all.result as Array<{ name: string }>).filter((t) => t.name === target).length) }
      all.onerror = () => { idb.close(); reject(all.error) }
    }
    req.onerror = () => reject(req.error)
  }), name)
}

/** `Y-M-D` of today + `days`, in the page's clock. */
async function dayFromToday(page: Page, days: number): Promise<string> {
  return await page.evaluate((n) => {
    const t = new Date()
    const d = new Date(t.getFullYear(), t.getMonth(), t.getDate() + n)
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
  }, days)
}

async function openQuickAdd(page: Page): Promise<{ dialog: Locator; input: Locator }> {
  await page.keyboard.press('Control+Space')
  const dialog = page.getByRole('dialog', { name: 'Quick add task' })
  await expect(dialog).toBeVisible()
  const input = dialog.getByPlaceholder('New task…')
  await expect(input).toBeFocused()
  return { dialog, input }
}

const notesEditor = (page: Page) => page.getByRole('region', { name: 'Notes cell' }).locator('.cm-content')

test.beforeEach(async ({ page }) => {
  await seedWorkspace(page, LAYOUT)
})

test('the same text makes the same task from Quick Add, a note’s line and the task editor', async ({ page }) => {
  // Quick Add.
  const quick = await openQuickAdd(page)
  await quick.input.pressSequentially(`From quick add ${TOKENS}`)
  await expect(page.getByRole('listbox')).toBeHidden()
  await page.keyboard.press('Enter')
  await expect(quick.dialog).toBeHidden()
  await expect.poll(() => readTask(page, 'From quick add')).not.toBeNull()

  // A note's lines, through Convert's preview (one line would open the editor).
  const editor = notesEditor(page)
  await editor.click()
  await page.keyboard.insertText(`- From a note ${TOKENS.trim()}
- Another line`)
  await page.getByRole('button', { name: 'Convert 2 bullet lines to tasks' }).click()
  const preview = page.getByRole('dialog', { name: 'Convert to tasks' })
  await preview.getByRole('button', { name: 'Create 2 tasks' }).click()
  await page.getByRole('dialog', { name: /Remove 2 converted lines/ }).getByRole('button', { name: 'Remove 2 lines' }).click()
  await expect.poll(() => readTask(page, 'From a note')).not.toBeNull()

  // The task editor, handed the text by Quick Add's Details ⇥.
  const handoff = await openQuickAdd(page)
  await handoff.input.pressSequentially(`From the editor ${TOKENS}`)
  await expect(page.getByRole('listbox')).toBeHidden()
  await page.keyboard.press('Tab')
  await expect(handoff.dialog).toBeHidden()
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect.poll(() => readTask(page, 'From the editor')).not.toBeNull()

  const expected: StoredTask = {
    urgent: true,
    dueDate: await dayFromToday(page, 1),
    nextFollowupAt: await dayFromToday(page, 14),
    recurrence: 'monthly',
    people: ['Ben Ortiz'],
    tags: ['fresh', 'planning'],
  }
  for (const title of ['From quick add', 'From a note', 'From the editor']) {
    expect(await readTask(page, title), title).toEqual(expected)
  }
  expect(await tagCount(page, 'fresh')).toBe(1)
})

test('the new-task editor keeps the Progress typed into it', async ({ page }) => {
  const { dialog, input } = await openQuickAdd(page)
  await input.pressSequentially('Write the report')
  await page.keyboard.press('Tab')
  await expect(dialog).toBeHidden()
  await page.getByPlaceholder('e.g. 50% done, Waiting on review...').fill('Outline done')
  await page.getByRole('button', { name: 'Create task' }).click()
  await expect.poll(async () => (await readTask(page, 'Write the report'))?.progress).toBe('Outline done')
})

test('Copy as rich text puts the note on the clipboard as HTML and as its Markdown', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const editor = notesEditor(page)
  await editor.click()
  await page.keyboard.insertText('- one\n- **two**')
  await page.getByRole('button', { name: 'Copy as rich text' }).click()
  // (The OS clipboard may store the line break as CRLF.)
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
    .toBe('- one\n- **two**')
  const html = await page.evaluate(async () => {
    const [item] = await navigator.clipboard.read()
    return await (await item!.getType('text/html')).text()
  })
  expect(html).toContain('font-family: Calibri')
  expect(html).toContain('<strong>two</strong>')
})
