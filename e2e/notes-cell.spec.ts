import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, type WsTabSeed, wsRow } from './fixtures/workspace'

/**
 * The task row's notes cell holds the task's status updates and Notes: a
 * click (or Enter / Space on the focused cell) opens one popover — the
 * newest update with a line adding one, the notes below —, hovering or
 * keyboard focus previews the newest update and the notes, and the popover
 * hands the focus back to the cell when it closes. Focus, hover timing and
 * placement are real-browser behaviour.
 */

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Plan the offsite', statusUpdates: [{ text: '50% done', inDays: -1 }, { text: 'Venue shortlist', inDays: -5 }], notes: '## Venue\n- call **Sam** about dates\n- [x] budget approved' },
  { title: 'Bare task' },
  { title: 'Status only', statusUpdates: [{ text: 'Waiting on legal' }] },
]

function seed(tab: Omit<WsTabSeed, 'id'>, tasks = TASKS): WorkspaceSeed {
  return {
    listDefinitions: [{ name: 'Everything' }],
    tasks,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'w', weight: 760, rows: [wsRow({ id: 'cell', tabs: [{ id: 'tab', ...tab }] })] },
        { id: 'rest', weight: 520, rows: [wsRow({ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] })] },
      ],
    }],
  }
}

const notesCell = (row: Locator) => row.locator('[data-row-cell="notes"]')
const popover = (page: Page) => page.getByRole('dialog', { name: 'Status and notes' })
const statusLine = (page: Page) => popover(page).getByRole('textbox', { name: 'Status' })

/** `MM/DD` of the day `n` days from today. */
function mmdd(n = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

async function storedTask(page: Page, title: string): Promise<{ id: number; notes?: string } | undefined> {
  const rows = await readStore<{ id: number; title: string; notes?: string }>(page, 'todos')
  return rows.find((r) => r.title === title)
}

/** The task's stored status update texts, newest written last. */
async function storedUpdates(page: Page, title: string): Promise<string[]> {
  const task = await storedTask(page, title)
  const rows = await readStore<{ todoId: number; text: string }>(page, 'statusUpdates')
  return rows.filter((r) => r.todoId === task?.id).map((r) => r.text)
}

test('a click opens Status (its line focused) and Notes; Enter adds an update dated today and stays open', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const row = taskRowByTitle(page, 'Bare task')
  const cell = notesCell(row)
  await expect(cell).toHaveAccessibleName('Add status or notes')
  await cell.click()
  await expect(popover(page)).toBeVisible()
  await expect(statusLine(page)).toBeFocused()
  await expect(popover(page).locator('.cm-content')).toBeVisible()

  await page.keyboard.type('Drafted, needs review')
  await page.keyboard.press('Enter')
  await expect.poll(() => storedUpdates(page, 'Bare task')).toEqual(['Drafted, needs review'])
  await expect(popover(page)).toBeVisible()
  await expect(statusLine(page)).toHaveValue('')
  await expect(popover(page).locator('[data-newest-update]')).toHaveText(`${mmdd()} Drafted, needs review`)
  await expect(popover(page).getByRole('button', { name: 'History (1) →' })).toBeVisible()

  // The notes edit in the same popover; Esc hands the focus back to the cell.
  await popover(page).locator('.cm-content').click()
  await page.keyboard.type('Ask Dana')
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect(cell).toBeFocused()
  await expect.poll(async () => (await storedTask(page, 'Bare task'))?.notes).toBe('Ask Dana')
  // The cell now shows the glyph (not the placeholder) and the new name.
  await expect(cell).toHaveAccessibleName('Edit status and notes')
})

test('keyboard: Enter / Space on the focused cell opens it; Esc closes adding the typed update, focus back on the cell', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const row = taskRowByTitle(page, 'Plan the offsite')
  const cell = notesCell(row)
  await cell.focus()
  await page.keyboard.press('Enter')
  await expect(popover(page)).toBeVisible()
  await expect(statusLine(page)).toBeFocused()
  await expect(popover(page).locator('[data-newest-update]')).toHaveText(`${mmdd(-1)} 50% done`)
  await statusLine(page).fill('75% done')
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect(cell).toBeFocused()
  await expect.poll(() => storedUpdates(page, 'Plan the offsite')).toContain('75% done')
  // The notes were left alone.
  expect((await storedTask(page, 'Plan the offsite'))?.notes).toContain('call **Sam**')

  await page.keyboard.press(' ')
  await expect(popover(page)).toBeVisible()
  await expect(popover(page).locator('[data-newest-update]')).toHaveText(`${mmdd()} 75% done`)
  await page.keyboard.press('Escape')
  await expect(cell).toBeFocused()
  // No editor opened along the way.
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0)
})

test('History (N) → opens the task’s editor with every update', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  await notesCell(taskRowByTitle(page, 'Plan the offsite')).click()
  await popover(page).getByRole('button', { name: 'History (2) →' }).click()
  await expect(popover(page)).toHaveCount(0)
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('list', { name: 'Status updates' })).toContainText('Venue shortlist')
})

test('notes typed in one go are one edit: written on close, taken back by one Undo', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const cell = notesCell(taskRowByTitle(page, 'Bare task'))
  await cell.click()
  await popover(page).locator('.cm-content').click()
  await page.keyboard.type('Ask Dana about the venue')
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect.poll(async () => (await storedTask(page, 'Bare task'))?.notes).toBe('Ask Dana about the venue')

  // The focus is back on the cell (not a text field): the app's Undo.
  await expect(cell).toBeFocused()
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await storedTask(page, 'Bare task'))?.notes).toBeUndefined()
})

test('hover and keyboard focus preview the newest update and the notes; filled cells show their glyph at rest', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const widget = wsListWidget(page, 'tab')
  const offsite = notesCell(taskRowByTitle(page, 'Plan the offsite'))
  await offsite.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText(`${mmdd(-1)} 50% done`)
  await expect(tip).not.toContainText('Venue shortlist')
  await expect(tip).toContainText('Notes')
  await expect(tip).toContainText('• call Sam about dates')
  await expect(tip).toContainText('✓ budget approved')
  await expect(tip).not.toContainText('**')

  // Pointer away (over the list's empty space): the preview goes; a click opens the editor without it.
  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)

  // Keyboard focus (Tab from the checkbox, past the add-subtasks mark of a task with no checklist) previews too.
  const statusRow = taskRowByTitle(page, 'Status only')
  await statusRow.getByRole('checkbox').focus()
  await page.keyboard.press('Tab')
  await expect(statusRow.getByRole('button', { name: 'Add subtasks' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(notesCell(statusRow)).toBeFocused()
  await expect(tip).toHaveText(`${mmdd()} Waiting on legal`)

  // At rest (no hover), a filled cell's glyph shows; an empty cell's placeholder doesn't.
  await page.mouse.move(0, 0)
  await page.locator('body').focus()
  const opacity = (cell: Locator) => cell.locator('svg').evaluate((el) => {
    let o = 1
    for (let n: Element | null = el; n && !n.matches('[data-row-cell]'); n = n.parentElement) o *= Number(getComputedStyle(n).opacity)
    return o
  })
  await expect.poll(() => opacity(notesCell(statusRow))).toBe(1)
  await expect.poll(() => opacity(notesCell(taskRowByTitle(page, 'Bare task')))).toBe(0)
  await expect(widget).toBeVisible()
})

test('the popover keeps inside the window near its right edge, ending at the cell', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Everything' }],
    tasks: TASKS,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'a', weight: 900, rows: [wsRow({ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] })] },
        { id: 'b', weight: 380, rows: [wsRow({ id: 'cell', tabs: [{ id: 'tab', kind: 'lens', listDefIdx: 0 }] })] },
      ],
    }],
  })
  const cell = notesCell(taskRowByTitle(page, 'Plan the offsite'))
  await cell.click()
  await expect(popover(page)).toBeVisible()
  const vp = page.viewportSize()
  const c = await cell.boundingBox()
  const p = await popover(page).boundingBox()
  if (!vp || !c || !p) throw new Error('no boxes')
  // Start-aligned at the cell it would cross the right edge; it ends at the cell instead, below it.
  expect(c.x + p.width).toBeGreaterThan(vp.width - 8)
  expect(p.x + p.width).toBeLessThanOrEqual(vp.width)
  expect(p.x).toBeGreaterThanOrEqual(0)
  expect(Math.abs(p.x + p.width - (c.x + c.width))).toBeLessThan(1)
  expect(p.y).toBeGreaterThanOrEqual(c.y + c.height)
  expect(p.y + p.height).toBeLessThanOrEqual(vp.height)
})
