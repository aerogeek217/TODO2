import { expect, test, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Compact faces (D25 R) in a real browser: a List cell's row shrunk with the
 * row divider shows its small face, headless (its strip slides in on hover),
 * and a click opens the whole list in the widget popup (Esc closes it); a
 * plain Number's click opens its tasks instead; the calendar's medium face
 * takes a task drop that sets the due date; on the phone a fit row's Number
 * cell is a compact glance cell.
 */

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Renew the domain', dueInDays: -2 },
  { title: 'Book the venue', dueInDays: 1 },
  { title: 'Draft the agenda' },
  { title: 'Call legal' },
]

const popup = (page: Page) => page.getByTestId('widget-popup')

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a short List row shows the small face, no strip; a click opens the list in the widget popup, Esc closes it', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: TASKS,
      listDefinitions: [{ name: 'Everything' }],
      layouts: [{
        name: 'Faces',
        // The List in a fixed row 88px tall: a body under 90px (one widget has no strip over it, D26 AA1).
        top: { id: 'band', height: 88, cells: [{ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] },
        columns: [{ id: 'c1', rows: [wsRow({ id: 'k2', tabs: [{ id: 'notes', kind: 'notes' }] })] }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'small')
    expect((await box(cell)).height).toBeLessThanOrEqual(90)
    // The face fills the cell; its top line names it and the cell's ⋯ floats over its corner on hover.
    await expect(cell.getByRole('tablist')).toHaveCount(0)
    const face = cell.locator('[data-list-face="small"]')
    await expect(face).toContainText('Everything')
    await expect(face.getByTestId('list-face-count')).toHaveText('4')
    await expect(face.getByTestId('list-face-oldest')).toBeVisible()
    await cell.hover()
    await expect(cell.getByRole('button', { name: 'Cell options' })).toBeInViewport()

    // A click opens the whole list in the widget popup: centered, nearly the whole window.
    await face.click()
    await expect(popup(page)).toBeVisible()
    await expect(popup(page)).toHaveAttribute('aria-label', 'Everything')
    await expect(popup(page).locator('[data-todo-id]')).toHaveCount(4)
    const p = await box(popup(page))
    expect(Math.round(p.width)).toBe(1440 - 48)
    expect(Math.round(p.height)).toBe(900 - 48)
    expect(Math.round(p.x)).toBe(24)
    await page.keyboard.press('Escape')
    await expect(popup(page)).toHaveCount(0)

    // Its keyboard opener: Enter opens it too, and the focus comes back to it.
    const opener = cell.getByRole('button', { name: 'Open Everything' })
    await opener.focus()
    await page.keyboard.press('Enter')
    await expect(popup(page)).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="widget-popup"]') != null)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(popup(page)).toHaveCount(0)
    await expect(opener).toBeFocused()
  })

  test('the popup stays open as the cell’s face grows; × closes it and the focus goes back to the cell', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await seedWorkspace(page, {
      tasks: TASKS,
      listDefinitions: [{ name: 'Everything' }],
      layouts: [{
        name: 'Faces',
        // The List small by its width (≤ 180px) beside the notes; wider windows make it grow.
        columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
          { id: 'k1', weight: 1, tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] },
          { id: 'k2', weight: 6, tabs: [{ id: 'notes', kind: 'notes' }] },
        ] }] }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'small')
    await cell.getByRole('button', { name: 'Open Everything' }).focus()
    await page.keyboard.press('Enter')
    await expect(popup(page)).toBeVisible()
    await page.setViewportSize({ width: 1800, height: 900 })
    await expect(cell).not.toHaveAttribute('data-face', 'small')
    await expect(popup(page)).toBeVisible()
    await popup(page).getByRole('button', { name: 'Close' }).click()
    await expect(popup(page)).toHaveCount(0)
    // The opener went with the small face: the focus lands in the cell, not on the page.
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest<HTMLElement>('[data-ws-cell]')?.dataset.wsCell ?? document.activeElement?.tagName)).toBe('k1')
  })

  test('a plain Number’s small face has no opener: its click opens its tasks, not the popup', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 900 })
    await seedWorkspace(page, {
      tasks: TASKS,
      layouts: [{
        name: 'Faces',
        columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
          { id: 'k1', weight: 1, tabs: [{ id: 'num', kind: 'number', glance: { metric: 'open' } }] },
          { id: 'k2', weight: 6, tabs: [{ id: 'notes', kind: 'notes' }] },
        ] }] }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'small')
    await expect(cell.locator('[data-face-opener]')).toHaveCount(0)
    await cell.hover()
    await expect(cell.getByRole('button', { name: 'Open larger' })).toHaveCount(0)
    await cell.locator('[data-number="num"]').click()
    await expect(page.locator('[data-task-dialog]')).toBeVisible()
    await expect(popup(page)).toHaveCount(0)
  })

  test('a row editor inside the popup opens over it and leaves it open', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: TASKS,
      listDefinitions: [{ name: 'Everything' }],
      layouts: [{
        name: 'Faces',
        // A narrow cell beside the notes in one row: the List is small by its width (≤ 180px).
        columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
          { id: 'k1', weight: 1, tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] },
          { id: 'k2', weight: 12, tabs: [{ id: 'notes', kind: 'notes' }] },
        ] }] }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'small')
    await cell.locator('[data-list-face]').click()
    await popup(page).locator('span[data-task-title="Call legal"]').dblclick()
    const editor = page.getByRole('dialog', { name: 'Edit task' })
    await expect(editor).toBeVisible()
    await expect(popup(page)).toBeVisible()
    // The editor is the layer on top: its middle is its own.
    const r = await box(editor)
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[role="dialog"]')?.getAttribute('aria-label') ?? null, { x: r.x + r.width / 2, y: r.y + 30 })).toBe('Edit task')
  })

  test('the calendar’s medium face: a list row dropped on a day of the week sets its due date', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: TASKS,
      listDefinitions: [{ name: 'Everything' }],
      layouts: [{
        name: 'Faces',
        columns: [
          { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] })] },
          {
            id: 'colB',
            rows: [
              wsRow({ id: 'b1', tabs: [{ id: 'cal', kind: 'calendar', dateTypes: { due: true, followup: false } }] }, { weight: 1 }),
              wsRow({ id: 'b2', tabs: [{ id: 'notes', kind: 'notes' }] }, { weight: 5 }),
            ],
          },
        ],
      }],
    })
    const cal = wsCell(page, 'b1')
    await expect(cal).toHaveAttribute('data-face', 'medium')
    const today = await page.evaluate(() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })
    const target = cal.locator(`[data-calendar-face="medium"] [data-day="${today}"]`)
    await expect(target.getByTestId('calendar-face-count')).toHaveText('–')
    const row = wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: 'Call legal' })
    const a = await box(row)
    await drag(page, { x: a.x + 40, y: a.y + a.height / 2 }, await pointIn(target), {
      during: async () => { await expect(target).toContainText('Set due') },
    })
    await expect(target.getByTestId('calendar-face-count')).toHaveText('1')
    const stored = (await readStore<{ title: string; dueDate?: Date }>(page, 'todos')).find((t) => t.title === 'Call legal')
    const due = stored?.dueDate ? new Date(stored.dueDate) : null
    expect(due && `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`).toBe(today)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a fit row’s Number cells have no tab row (one widget each), the small face', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: TASKS,
      listDefinitions: [{ name: 'Everything' }],
      layouts: [{
        name: 'Faces',
        columns: [{
          id: 'c1',
          rows: [
            wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }),
            { id: 'fit', cells: [
              { id: 'n1', tabs: [{ id: 'num1', kind: 'number', glance: { metric: 'overdue' } }] },
              { id: 'n2', tabs: [{ id: 'num2', kind: 'number', glance: { metric: 'open' } }] },
            ] },
          ],
        }],
      }],
    })
    const n1 = wsCell(page, 'n1')
    await n1.scrollIntoViewIfNeeded()
    await expect(n1).toHaveAttribute('data-face', 'small')
    await expect(n1.locator('[data-glance="number"]')).toHaveAttribute('data-face', 'small')
    await expect(n1.getByTestId('number-count')).toHaveText('1')
    // No header: its label is its top line (D26 AA1).
    await expect(n1.locator('[data-ws-cell-header]')).toHaveCount(0)
    await expect(n1.locator('[data-ws-tab="num1"]')).toBeVisible()
    expect((await box(n1)).height).toBeLessThan(110)
    // A list cell keeps its full header and its rows.
    const list = wsCell(page, 'k1')
    await expect(list).not.toHaveAttribute('data-compact', 'true')
    await expect(list).toHaveAttribute('data-face', 'large')
  })
})
