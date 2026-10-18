import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { seedWorkspace, wsListWidget, type WorkspaceSeed, type WsTabSeed } from './fixtures/workspace'

/**
 * The task row's notes cell holds the task's Progress and Notes: a click (or
 * Enter / Space on the focused cell) opens one popover editing both, hovering
 * or keyboard focus previews both, and the popover hands the focus back to
 * the cell when it closes. Focus, hover timing and placement are
 * real-browser behaviour.
 */

const TASKS: NonNullable<WorkspaceSeed['tasks']> = [
  { title: 'Plan the offsite', progress: '50% done', notes: '## Venue\n- call **Sam** about dates\n- [x] budget approved' },
  { title: 'Bare task' },
  { title: 'Progress only', progress: 'Waiting on legal' },
]

function seed(tab: Omit<WsTabSeed, 'id'>, tasks = TASKS): WorkspaceSeed {
  return {
    listDefinitions: [{ name: 'Everything' }],
    tasks,
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'w', weight: 760, cells: [{ id: 'cell', tabs: [{ id: 'tab', ...tab }] }] },
        { id: 'rest', weight: 520, cells: [{ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] }] },
      ],
    }],
  }
}

const notesCell = (row: Locator) => row.locator('[data-row-cell="notes"]')
const popover = (page: Page) => page.getByRole('dialog', { name: 'Progress and notes' })
const progressField = (page: Page) => popover(page).getByRole('textbox', { name: 'Progress' })

async function storedTask(page: Page, title: string): Promise<{ progress?: string; notes?: string } | undefined> {
  const rows = await readStore<{ title: string; progress?: string; notes?: string }>(page, 'todos')
  return rows.find((r) => r.title === title)
}

test('a click opens Progress (focused) and Notes; Enter saves Progress and hands the focus back to the cell', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const row = taskRowByTitle(page, 'Bare task')
  const cell = notesCell(row)
  await expect(cell).toHaveAccessibleName('Add progress or notes')
  await cell.click()
  await expect(popover(page)).toBeVisible()
  await expect(progressField(page)).toBeFocused()
  await expect(popover(page).locator('.cm-content')).toBeVisible()

  await page.keyboard.type('Drafted, needs review')
  await page.keyboard.press('Enter')
  await expect(popover(page)).toHaveCount(0)
  await expect(cell).toBeFocused()
  await expect.poll(async () => (await storedTask(page, 'Bare task'))?.progress).toBe('Drafted, needs review')
  // The cell now shows the glyph (not the placeholder) and the new name.
  await expect(cell).toHaveAccessibleName('Edit progress and notes')

  // Reopened, the field shows the saved text; the notes edit in the same popover.
  await cell.click()
  await expect(progressField(page)).toHaveValue('Drafted, needs review')
  await popover(page).locator('.cm-content').click()
  await page.keyboard.type('Ask Dana')
  await expect.poll(async () => (await storedTask(page, 'Bare task'))?.notes).toBe('Ask Dana')
  // Only the fields edited were written.
  expect((await storedTask(page, 'Bare task'))?.progress).toBe('Drafted, needs review')
})

test('keyboard: Enter / Space on the focused cell opens it; Esc closes keeping the typed text, focus back on the cell', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const row = taskRowByTitle(page, 'Plan the offsite')
  const cell = notesCell(row)
  await cell.focus()
  await page.keyboard.press('Enter')
  await expect(popover(page)).toBeVisible()
  await expect(progressField(page)).toBeFocused()
  await expect(progressField(page)).toHaveValue('50% done')
  await progressField(page).fill('75% done')
  await page.keyboard.press('Escape')
  await expect(popover(page)).toHaveCount(0)
  await expect(cell).toBeFocused()
  await expect.poll(async () => (await storedTask(page, 'Plan the offsite'))?.progress).toBe('75% done')
  // The notes were left alone.
  expect((await storedTask(page, 'Plan the offsite'))?.notes).toContain('call **Sam**')

  await page.keyboard.press(' ')
  await expect(popover(page)).toBeVisible()
  await expect(progressField(page)).toHaveValue('75% done')
  await page.keyboard.press('Escape')
  await expect(cell).toBeFocused()
  // No editor opened along the way.
  await expect(page.getByRole('dialog', { name: 'Edit task' })).toHaveCount(0)
})

test('hover and keyboard focus preview the progress and the notes; filled cells show their glyph at rest', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'lens', listDefIdx: 0 }))
  const widget = wsListWidget(page, 'tab')
  const offsite = notesCell(taskRowByTitle(page, 'Plan the offsite'))
  await offsite.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('Progress: 50% done')
  await expect(tip).toContainText('Notes')
  await expect(tip).toContainText('• call Sam about dates')
  await expect(tip).toContainText('✓ budget approved')
  await expect(tip).not.toContainText('**')

  // Pointer away (over the list's empty space): the preview goes; a click opens the editor without it.
  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)

  // Keyboard focus (Tab from the checkbox) previews too.
  const progressRow = taskRowByTitle(page, 'Progress only')
  await progressRow.getByRole('checkbox').focus()
  await page.keyboard.press('Tab')
  await expect(notesCell(progressRow)).toBeFocused()
  await expect(tip).toHaveText('Progress: Waiting on legal')

  // At rest (no hover), a filled cell's glyph shows; an empty cell's placeholder doesn't.
  await page.mouse.move(0, 0)
  await page.locator('body').focus()
  const opacity = (cell: Locator) => cell.locator('svg').evaluate((el) => {
    let o = 1
    for (let n: Element | null = el; n && !n.matches('[data-row-cell]'); n = n.parentElement) o *= Number(getComputedStyle(n).opacity)
    return o
  })
  await expect.poll(() => opacity(notesCell(progressRow))).toBe(1)
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
        { id: 'a', weight: 900, cells: [{ id: 'n', tabs: [{ id: 'notes', kind: 'notes' }] }] },
        { id: 'b', weight: 380, cells: [{ id: 'cell', tabs: [{ id: 'tab', kind: 'lens', listDefIdx: 0 }] }] },
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

test('Eisenhower rows edit Progress the same way', async ({ page }) => {
  await seedWorkspace(page, seed({ kind: 'eisenhower' }))
  const eis = page.locator('[data-eisenhower="tab"]')
  const row = eis.locator('[data-todo-id]').filter({ has: page.locator('[data-task-title="Progress only"]') })
  const cell = notesCell(row)
  await cell.click()
  await expect(progressField(page)).toHaveValue('Waiting on legal')
  await progressField(page).fill('')
  await page.keyboard.press('Enter')
  await expect(popover(page)).toHaveCount(0)
  await expect(cell).toBeFocused()
  await expect.poll(async () => (await storedTask(page, 'Progress only'))?.progress).toBeUndefined()
  await expect(cell).toHaveAccessibleName('Add progress or notes')
})
