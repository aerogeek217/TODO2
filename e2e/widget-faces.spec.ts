import { expect, test, type Page } from '@playwright/test'
import { drag, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * Compact faces (D25 R) in a real browser: a List cell's row shrunk with the
 * row divider shows its small face, headless (its strip slides in on hover),
 * and a click opens the full list in a popover anchored to the cell (Esc
 * closes it); the calendar's medium face takes a task drop that sets the
 * due date; on the phone a fit row's Number cell is a compact glance cell.
 */

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Renew the domain', dueInDays: -2 },
  { title: 'Book the venue', dueInDays: 1 },
  { title: 'Draft the agenda' },
  { title: 'Call legal' },
]

const popover = (page: Page) => page.getByTestId('widget-face-popover')

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('a List row shrunk by its divider shows the small face, headless; a click opens the full list over it, Esc closes it', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: TASKS,
      listDefinitions: [{ name: 'Everything' }],
      layouts: [{
        name: 'Faces',
        columns: [{
          id: 'c1',
          rows: [
            wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }),
            wsRow({ id: 'k2', tabs: [{ id: 'notes', kind: 'notes' }] }),
          ],
        }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'large')
    await expect(cell).not.toHaveAttribute('data-headless', 'true')

    // Drag the row divider up to the row's minimum (112px: a body of 80px), short of collapsing it.
    const divider = page.getByRole('separator', { name: 'Resize rows' })
    const d = await box(divider)
    const top = (await box(cell)).y
    await drag(page, { x: d.x + d.width / 2, y: d.y + d.height / 2 }, { x: d.x + d.width / 2, y: top + 116 })
    await expect(cell).toHaveAttribute('data-face', 'small')
    expect((await box(cell)).height).toBeLessThanOrEqual(115)
    // Headless at its small face: the face fills the cell, the strip slides in on hover.
    await expect(cell).toHaveAttribute('data-headless', 'true')
    const face = cell.locator('[data-list-face="small"]')
    await expect(face).toContainText('Everything')
    await expect(face.getByTestId('list-face-count')).toHaveText('4')
    await expect(face.getByTestId('list-face-oldest')).toBeVisible()
    await cell.hover()
    await expect(cell.locator('[data-ws-cell-header]')).toBeInViewport()

    // A click opens the full list in a popover under the cell, kept in the viewport.
    await face.click()
    await expect(popover(page)).toBeVisible()
    await expect(popover(page).locator('[data-todo-id]')).toHaveCount(4)
    const p = await box(popover(page))
    const c = await box(cell)
    expect(Math.abs(p.y - (c.y + c.height)) <= 12 || p.y + p.height <= c.y + 12).toBe(true)
    expect(p.width).toBeLessThanOrEqual(720)
    expect(p.height).toBeLessThanOrEqual(520)
    expect(p.y + p.height).toBeLessThanOrEqual(900)
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)

    // Its keyboard opener: Enter opens it too.
    await cell.getByRole('button', { name: 'Open Everything' }).focus()
    await page.keyboard.press('Enter')
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toHaveCount(0)
  })

  test('a row editor inside the popover opens over it and leaves it open', async ({ page }) => {
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
    await popover(page).locator('span[data-task-title="Call legal"]').dblclick()
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
    await expect(popover(page)).toBeVisible()
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
              wsRow({ id: 'b2', tabs: [{ id: 'notes', kind: 'notes' }] }, { weight: 2 }),
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

  test('a fit row’s Number cells are compact glance cells: a slim header, the small face', async ({ page }) => {
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
    await expect(n1).toHaveAttribute('data-compact', 'true')
    await expect(n1).toHaveAttribute('data-face', 'small')
    await expect(n1.locator('[data-glance="number"]')).toHaveAttribute('data-face', 'small')
    await expect(n1.getByTestId('number-count')).toHaveText('1')
    // Its header is slim, its tab still there (the tab sheet's way in).
    expect((await box(n1.locator('[data-ws-cell-header]'))).height).toBeLessThanOrEqual(31)
    await expect(n1.locator('[data-ws-tab="num1"]')).toBeVisible()
    expect((await box(n1)).height).toBeLessThan(110)
    // A list cell keeps its full header and its rows.
    const list = wsCell(page, 'k1')
    await expect(list).not.toHaveAttribute('data-compact', 'true')
    await expect(list).toHaveAttribute('data-face', 'large')
  })
})
