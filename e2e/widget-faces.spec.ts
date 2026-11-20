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
 * cell is a compact glance cell. The Planner's faces: its strip over two
 * panes when large, over one column when narrow, its name and today's count
 * when small, one column of phone rows on the phone.
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

/** The Planner's tasks: two late or due today, one planned for today, two ahead, a Focus task with no day, one it doesn't hold. */
const PLAN_TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Renew the domain', dueInDays: -2 },
  { title: 'Chase the invoice', followupInDays: 0 },
  { title: 'Write the brief', doInDays: 0, dueInDays: 5 },
  { title: 'Book the venue', dueInDays: 2 },
  { title: 'Call the caterer', followupInDays: 2 },
  { title: 'Someday focus', focus: true },
  { title: 'Not planned' },
  { title: 'Sent the invites', completedInDays: 0 },
]

const planner = (page: Page) => page.locator('[data-planner="plan"]')
const plannerGroups = (page: Page) => planner(page).locator('[data-planner-group]')
const todayGroup = (page: Page) => planner(page).locator('[data-planner-group-kind="today"]')
const dayKeyIn = (page: Page, days: number) => page.evaluate((n) => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}, days)

test.describe('the Planner', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('large: the strip over two panes; a tile picks its day, the arrows move the week, a dragged row settles back', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: PLAN_TASKS,
      layouts: [{
        name: 'Week',
        columns: [
          { id: 'c1', weight: 5, rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] },
          { id: 'c2', weight: 1, rows: [wsRow({ id: 'k2', tabs: [{ id: 'notes', kind: 'notes' }] })] },
        ],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'large')
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'large')
    // Alone in its cell: its top line names it, with the week's range.
    await expect(cell.getByTestId('top-line-name')).toHaveText('Planner')
    await expect(cell.getByTestId('planner-range')).toBeVisible()

    // The strip: the arrows at its ends, seven tiles of one width between them.
    const tiles = planner(page).locator('[data-planner-tile]')
    await expect(tiles).toHaveCount(7)
    const widths = await tiles.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)))
    expect(new Set(widths).size).toBe(1)
    const strip = await box(planner(page).locator('[data-planner-strip]'))
    const prev = await box(planner(page).getByRole('button', { name: 'Previous week' }))
    const next = await box(planner(page).getByRole('button', { name: 'Next week' }))
    const first = await box(tiles.first())
    const last = await box(tiles.last())
    expect(prev.x).toBeLessThan(first.x)
    expect(next.x).toBeGreaterThan(last.x + last.width - 1)
    expect(next.x + next.width).toBeLessThanOrEqual(strip.x + strip.width)
    const today = await dayKeyIn(page, 0)
    const inTwo = await dayKeyIn(page, 2)
    await expect(planner(page).locator(`[data-planner-tile="${today}"]`)).toHaveAttribute('data-today', 'true')
    await expect(planner(page).locator(`[data-planner-tile="${today}"]`).getByTestId('planner-tile-count')).toHaveText('3')
    await expect(planner(page).locator(`[data-planner-tile="${inTwo}"] [data-reason]`)).toHaveCount(2)

    // Two panes side by side: Today on the left, the six days ahead and Focus, no day on the right.
    await expect(plannerGroups(page)).toHaveCount(8)
    const left = await box(planner(page).locator('[data-planner-pane="today"]'))
    const right = await box(planner(page).locator('[data-planner-pane="ahead"]'))
    const pinned = await box(planner(page).locator('[data-planner-pane="noday"]'))
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1)
    expect(Math.abs(left.y - right.y)).toBeLessThan(2)
    expect(pinned.y).toBeGreaterThanOrEqual(right.y + right.height - 1)
    await expect(todayGroup(page).locator('[data-task-title]')).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
    await expect(planner(page).locator(`[data-planner-group="${inTwo}"] [data-task-title]`)).toHaveText(['Book the venue', 'Call the caterer'])
    await expect(planner(page).locator('[data-planner-group="none"] [data-task-title]')).toHaveText(['Someday focus'])
    await expect(planner(page)).not.toContainText('Not planned')
    await expect(todayGroup(page).getByTestId('planner-done')).toContainText('1 done')
    await expect(todayGroup(page).getByTestId('planner-done')).toContainText('Sent the invites')
    // Wide panes show the list's Rows; nothing here is a list widget.
    await expect(planner(page).locator('[data-planner-pane="today"] > [data-zoom]')).toHaveAttribute('data-zoom', 'rows')
    await expect(page.locator('[data-list-widget]')).toHaveCount(0)

    // A tile picks the day the days ahead start at; the same tile again takes it back.
    const tile = planner(page).locator(`[data-planner-tile="${inTwo}"]`)
    await tile.click()
    await expect(tile).toHaveAttribute('aria-pressed', 'true')
    await expect(plannerGroups(page)).toHaveCount(7)
    await expect(plannerGroups(page).nth(1)).toHaveAttribute('data-planner-group', inTwo)
    await tile.click()
    await expect(plannerGroups(page)).toHaveCount(8)

    // A row is the list's draggable row: dragged onto a tile it lifts, and with nothing to take it yet it settles back.
    const row = todayGroup(page).locator('[data-row-key]').filter({ hasText: 'Chase the invoice' })
    const r = await box(row)
    await drag(page, { x: r.x + 60, y: r.y + r.height / 2 }, await pointIn(tile), {
      lifted: async () => { await expect(page.locator('[data-drag-overlay]')).toBeVisible() },
    })
    await expect(page.locator('[data-drag-overlay]')).toHaveCount(0)
    await expect(todayGroup(page).locator('[data-task-title]')).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
    const chased = (await readStore<{ title: string; doDate?: Date; nextFollowupAt?: Date }>(page, 'todos')).find((t) => t.title === 'Chase the invoice')
    expect(chased?.doDate).toBeUndefined()
    expect(chased?.nextFollowupAt && new Date(chased.nextFollowupAt).getDate()).toBe(new Date().getDate())

    // The arrows move the window a week: Today stays, the tiles are next week's, and the range is the way back.
    await expect(planner(page).getByRole('button', { name: 'Previous week' })).toBeDisabled()
    await planner(page).getByRole('button', { name: 'Next week' }).click()
    await expect(planner(page).locator('[data-today]')).toHaveCount(0)
    await expect(tiles.first()).toHaveAttribute('data-planner-tile', await dayKeyIn(page, 7))
    await expect(todayGroup(page).locator('[data-task-title]')).toHaveCount(3)
    await expect(plannerGroups(page)).toHaveCount(9)
    await cell.getByRole('button', { name: /Back to this week$/ }).click()
    await expect(tiles.first()).toHaveAttribute('data-planner-tile', today)
  })

  test('Add task opens Quick Add; the new task lands in Today with today as its Do day', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: PLAN_TASKS,
      layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] }] }],
    })
    await todayGroup(page).getByRole('button', { name: 'Add task' }).click()
    const input = page.getByPlaceholder('New task…')
    await expect(input).toBeFocused()
    // No Do-day control in Quick Add.
    await expect(page.getByText(/do day/i)).toHaveCount(0)
    await input.fill('Ring the printer')
    await page.keyboard.press('Enter')
    await expect(todayGroup(page).locator('[data-task-title="Ring the printer"]')).toBeVisible()
    await expect(todayGroup(page).getByTestId('planner-group-count')).toHaveText('4')
    await expect.poll(async () => {
      const stored = (await readStore<{ title: string; doDate?: Date }>(page, 'todos')).find((t) => t.title === 'Ring the printer')
      const d = stored?.doDate ? new Date(stored.doDate) : null
      return d ? [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()] : null
    }).toEqual(await page.evaluate(() => { const d = new Date(); return [d.getFullYear(), d.getMonth(), d.getDate(), 0] }))
  })

  test('medium: a narrow cell is one column under the strip; narrower still, the arrows sit around the range', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: PLAN_TASKS,
      // Default list zoom at Auto (the app's default), which the Planner's rows follow.
      settings: { rowDensity: null },
      layouts: [{
        name: 'Week',
        columns: [{ id: 'c1', rows: [{ id: 'r1', cells: [
          { id: 'k1', weight: 2, tabs: [{ id: 'plan', kind: 'planner' }] },
          { id: 'k2', weight: 5, tabs: [{ id: 'notes', kind: 'notes' }] },
        ] }] }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'medium')
    await expect(planner(page).locator('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'column')
    await expect(planner(page).locator('[data-planner-pane]')).toHaveCount(0)
    await expect(plannerGroups(page)).toHaveCount(8)
    // The strip's seven tiles still fit, each showing its count; a narrow pane's rows are Stacked.
    const tiles = planner(page).locator('[data-planner-tile]')
    await expect(tiles).toHaveCount(7)
    const host = await box(planner(page))
    for (const t of [tiles.first(), tiles.last()]) {
      const b = await box(t)
      expect(b.x).toBeGreaterThanOrEqual(host.x)
      expect(b.x + b.width).toBeLessThanOrEqual(host.x + host.width)
    }
    await expect(planner(page).locator('[data-planner-layout] > [data-zoom]')).toHaveAttribute('data-zoom', 'stacked')
    // Today, the days ahead and Focus, no day stack in one scroll.
    const groups = await plannerGroups(page).evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().x)))
    expect(new Set(groups).size).toBe(1)

    // A window too narrow for seven tiles: the arrows stay, around the range.
    await page.setViewportSize({ width: 900, height: 900 })
    await expect(planner(page).locator('[data-planner-strip]')).toHaveAttribute('data-planner-strip', 'range')
    await expect(planner(page).locator('[data-planner-tile]')).toHaveCount(0)
    await expect(planner(page).getByRole('button', { name: 'Next week' })).toBeVisible()
    await expect(cell).toHaveAttribute('data-face', 'medium')
  })

  test('small: its name and today’s count; a click opens it larger, two panes, the week kept', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: PLAN_TASKS,
      layouts: [{
        name: 'Week',
        top: { id: 'band', height: 88, cells: [{ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] }] },
        columns: [{ id: 'c1', rows: [wsRow({ id: 'k2', tabs: [{ id: 'notes', kind: 'notes' }] })] }],
      }],
    })
    const cell = wsCell(page, 'k1')
    await expect(cell).toHaveAttribute('data-face', 'small')
    await expect(planner(page)).toHaveAttribute('data-planner-face', 'small')
    await expect(planner(page)).toContainText('Planner')
    await expect(planner(page).getByTestId('planner-face-count')).toHaveText('3')
    await expect(planner(page).locator('[data-planner-strip]')).toHaveCount(0)
    await planner(page).click()
    await expect(popup(page)).toBeVisible()
    await expect(popup(page)).toHaveAttribute('aria-label', 'Planner')
    const open = popup(page).locator('[data-planner="plan"]')
    await expect(open.locator('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'panes')
    // The tab has one live widget: the cell shows a placeholder meanwhile.
    await expect(page.locator('[data-planner="plan"]')).toHaveCount(1)
    // Its week and picked day are the tab's: they outlast the popup.
    await open.getByRole('button', { name: 'Next week' }).click()
    const picked = open.locator('[data-planner-tile]').nth(2)
    await picked.click()
    const key = await picked.getAttribute('data-planner-tile')
    await page.keyboard.press('Escape')
    await expect(popup(page)).toHaveCount(0)
    await cell.getByRole('button', { name: 'Open Planner' }).focus()
    await page.keyboard.press('Enter')
    await expect(popup(page).locator(`[data-planner-tile="${key}"]`)).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Planner is one column of phone rows under a strip of seven tiles that fit the screen', async ({ page }) => {
    await seedWorkspace(page, {
      tasks: PLAN_TASKS,
      layouts: [{ name: 'Week', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'plan', kind: 'planner' }] })] }] }],
    })
    await expect(planner(page).locator('[data-planner-layout]')).toHaveAttribute('data-planner-layout', 'column')
    const tiles = planner(page).locator('[data-planner-tile]')
    await expect(tiles).toHaveCount(7)
    const width = page.viewportSize()?.width ?? 0
    for (const t of await tiles.all()) {
      const b = await box(t)
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x + b.width).toBeLessThanOrEqual(width)
      // Wide enough to read its weekday, date and count, and to tap.
      expect(b.width).toBeGreaterThanOrEqual(36)
    }
    await expect(tiles.first().getByTestId('planner-tile-count')).toHaveText('3')
    // No ticks at this width; the count says it.
    await expect(tiles.first().locator('[data-reason]').first()).toBeHidden()
    // Today, then only the days with tasks, then Focus, no day — the phone's rows, nothing draggable.
    await expect(plannerGroups(page)).toHaveCount(3)
    await expect(todayGroup(page).locator('[data-task-title]')).toHaveText(['Renew the domain', 'Chase the invoice', 'Write the brief'])
    await expect(planner(page).locator('[data-row-key]')).toHaveCount(0)
    await expect(todayGroup(page).getByRole('button', { name: 'Add task' })).toBeVisible()
  })

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
