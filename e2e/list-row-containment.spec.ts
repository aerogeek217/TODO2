import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList, seedWorkspace, wsListWidget, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A list widget's rows skip their rendering off screen (cr34 answer 27:
 * `content-visibility: auto` on each row, `ListWidget.module.css`). What it
 * must not change, in a real browser:
 *
 * - the rows off screen really are skipped, and a row's fallback height
 *   (`contain-intrinsic-block-size`) is its drawn height at each zoom, so the
 *   list's scroll height is the same as with every row drawn;
 * - on screen, a row draws exactly as it does without the containment —
 *   the priority glow from the row's left edge, the focus ring (a layered
 *   box-shadow 4px outside the focused part), the Focus glow round the
 *   Lines box — and takes presses at the same places;
 * - a row dragged while the list auto-scrolls lands among rows that were
 *   off screen when the drag began;
 * - the keyboard cursor moving onto an off-screen row scrolls it in and
 *   draws it.
 */

test.use({ viewport: { width: 1400, height: 700 } })

/** Every row drawn: the containment switched off, for a comparison. */
const NO_CONTAINMENT = '[data-row-key] { content-visibility: visible !important; }'

const PEOPLE = ['Alice Chen', 'Ben Ortiz']

/**
 * Enough rows that the last are skipped at every zoom: Chromium draws the
 * rows within about one and a half viewports of the view (scroller clip or
 * not), so 150 Lines rows (15px) reach past it.
 */
const TASKS: NonNullable<WorkspaceSeed['tasks']> = Array.from({ length: 150 }, (_, i) => ({
  title: `Task ${i + 1}`,
  urgent: i % 5 === 0,
  important: i % 5 === 1 || i % 5 === 0,
  focus: i % 7 === 2,
  dueInDays: i % 3 === 0 ? undefined : (i % 9) - 3,
  followupInDays: i % 4 === 0 ? (i % 3) - 1 : undefined,
  people: i % 2 === 0 ? PEOPLE.slice(0, 1 + (i % 4 === 0 ? 1 : 0)) : [],
}))

const ZOOMS = ['rows', 'stacked', 'lines'] as const
const HEIGHT = { rows: 30, stacked: 44, lines: 15 } as const

/**
 * One cell the page's width, a tab of the list at each zoom: the cell's
 * edges fall on whole pixels. (In a cell of fractional width a contained
 * row is snapped to the pixel grid, so its text can be antialiased a
 * fraction of a pixel apart from an uncontained one's — invisible, but not
 * the same pixels.)
 */
const THREE_ZOOMS: WorkspaceSeed = {
  people: PEOPLE,
  tasks: TASKS,
  listDefinitions: [{ name: 'Everything' }],
  layouts: [{
    name: 'Main',
    columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: ZOOMS.map((zoom) => ({ id: zoom, kind: 'lens' as const, listDefIdx: 0, zoom })) })] }],
  }],
}

/** The list at `zoom`: its tab shown. */
async function showZoom(page: Page, zoom: (typeof ZOOMS)[number]): Promise<Locator> {
  await wsTab(page, zoom).click()
  await expect(wsTab(page, zoom)).toHaveAttribute('aria-selected', 'true')
  const list = wsListWidget(page, zoom)
  await expect(rows(list)).toHaveCount(TASKS.length)
  await page.mouse.move(2, 690)
  return list
}

const rows = (list: Locator) => list.locator('[data-row-key]')
const rowOf = (list: Locator, title: string) => list.locator('[data-row-key]', { has: list.page().locator(`[data-task-title="${title}"]`) })

/** Whether the element is drawn (not inside a row whose rendering is skipped). */
const drawn = (el: Locator) => el.evaluate((e) => e.checkVisibility({ contentVisibilityAuto: true }))

/** The list's scroller. */
const scroller = (list: Locator) => list.locator('[data-task-row-grid]').locator('xpath=..')

async function seedZooms(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await seedWorkspace(page, THREE_ZOOMS)
  await expect(rows(wsListWidget(page, 'rows'))).toHaveCount(TASKS.length)
  // People drawn (the assignments load after the tasks).
  await expect(wsListWidget(page, 'rows').locator('[data-person-avatar]').first()).toBeVisible()
}

test('rows off screen skip their rendering, and a row’s fallback height is its drawn height at each zoom', async ({ page }) => {
  await seedZooms(page)
  for (const zoom of ZOOMS) {
    const list = await showZoom(page, zoom)
    const first = rows(list).first()
    const last = rows(list).last()
    expect(await first.evaluate((e) => getComputedStyle(e).getPropertyValue('content-visibility'))).toBe('auto')
    expect(await first.evaluate((e) => getComputedStyle(e).getPropertyValue('contain-intrinsic-block-size'))).toBe(`auto ${HEIGHT[zoom]}px`)
    expect(await drawn(first.locator('[data-todo-id]'))).toBe(true)
    // The last row is far below the list's view: skipped.
    expect(await drawn(last.locator('[data-todo-id]')), `${zoom}: the last row is skipped`).toBe(false)
    // A drawn row is as high as the fallback a skipped one takes.
    for (const i of [0, 1, 2, 3]) {
      expect(Math.round((await box(rows(list).nth(i))).height), `${zoom}: row ${i}'s height`).toBe(HEIGHT[zoom])
    }
    // So the list's scroll height is the one it has with every row drawn.
    const height = () => scroller(list).evaluate((e) => e.scrollHeight)
    const contained = await height()
    const style = await page.addStyleTag({ content: NO_CONTAINMENT })
    expect(await height(), `${zoom}: the scroll height`).toBe(contained)
    await style.evaluate((el) => el.remove())
  }
})

/** The pixels of `list`'s visible part, and what is pressed at a grid of points over its first rows. */
async function picture(page: Page, list: Locator): Promise<{ png: Buffer; hits: string[] }> {
  const b = await box(scroller(list))
  const clip = { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 260) }
  // Across the rows' width, 1px in from their sides: a row's left edge falls between pixels in a
  // cell of fractional width, and a contained row's edge is snapped to them a little differently.
  const r = await box(rows(list).first())
  const hits = await page.evaluate(({ c, left, right }) => {
    const out: string[] = []
    for (let y = c.y + 0.5; y < c.y + c.height; y += 3) {
      for (let x = left + 1; x < right - 1; x += 9) {
        const el = document.elementFromPoint(x, y)
        out.push(el ? `${el.tagName}.${el.className}${el.getAttribute('data-row-key') ?? ''}` : '-')
      }
    }
    return out
  }, { c: clip, left: r.x, right: r.x + r.width })
  return { png: await page.screenshot({ clip, animations: 'disabled', caret: 'hide' }), hits }
}

async function expectSameWithoutContainment(page: Page, list: Locator, what: string) {
  const contained = await picture(page, list)
  const style = await page.addStyleTag({ content: NO_CONTAINMENT })
  const plain = await picture(page, list)
  await style.evaluate((el) => el.remove())
  expect(contained.hits, `${what}: presses land where they do without containment`).toEqual(plain.hits)
  expect(contained.png.equals(plain.png), `${what}: drawn as without containment`).toBe(true)
}

test('on screen a row draws and takes presses as it does without the containment', async ({ page }) => {
  // A screenshot and a hit grid per state, twice: under a full suite's load this outruns the usual limit.
  test.slow()
  await seedZooms(page)

  // At rest: the priority glows from the rows' left edges, the rings, the Focus glows.
  for (const zoom of ZOOMS) await expectSameWithoutContainment(page, await showZoom(page, zoom), `${zoom} at rest`)

  // Rows: the focus ring round a row's checkbox — a row at the list's top, its ring at the row's edges.
  const rowsList = await showZoom(page, 'rows')
  // Keyboard modality, so a focus shows its ring (`:focus-visible`).
  await page.keyboard.press('Shift')
  await rowOf(rowsList, 'Task 3').locator('input[type="checkbox"]').focus()
  await expect(rowOf(rowsList, 'Task 3').locator('input[type="checkbox"]')).toBeFocused()
  await expectSameWithoutContainment(page, rowsList, 'rows: a focused checkbox')
  // …and round its last cell, at the row's right end.
  const lastCell = rowOf(rowsList, 'Task 2').locator('button:visible').last()
  await lastCell.focus()
  await expect(lastCell).toBeFocused()
  await expectSameWithoutContainment(page, rowsList, 'rows: a focused cell at the row’s end')

  // Stacked: a focused checkbox (its 24px target reaches the row's top edge).
  const stackedList = await showZoom(page, 'stacked')
  await page.keyboard.press('Shift')
  await rowOf(stackedList, 'Task 3').locator('input[type="checkbox"]').focus()
  await expectSameWithoutContainment(page, stackedList, 'stacked: a focused checkbox')

  // Lines: a line is a tab stop; its ring lies wholly outside the 15px row.
  const linesList = await showZoom(page, 'lines')
  await page.keyboard.press('Shift')
  await rowOf(linesList, 'Task 3').locator('[data-todo-id]').focus()
  await expect(rowOf(linesList, 'Task 3').locator('[data-todo-id]')).toBeFocused()
  await expectSameWithoutContainment(page, linesList, 'lines: a focused line')
})

test('a row dragged while the list auto-scrolls lands among rows that were off screen', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const list = await seedTaskList(page, { tasks: Array.from({ length: 100 }, (_, n) => ({ title: `Task ${n + 1}` })) })
  await expect(rows(list)).toHaveCount(100)
  // The rows near the end aren't drawn when the drag begins.
  expect(await drawn(rowOf(list, 'Task 98').locator('[data-todo-id]'))).toBe(false)

  const row = rowOf(list, 'Task 2')
  const r = await box(row)
  const lb = await box(list)
  await page.mouse.move(r.x + 10, r.y + r.height / 2)
  await page.mouse.down()
  await page.mouse.move(r.x + 10, r.y + r.height / 2 + 8, { steps: 2 })
  await page.mouse.move(r.x + 10, lb.y + lb.height - 6, { steps: 12 })
  // Held still until the list has scrolled to its end.
  await expect.poll(() => scroller(list).evaluate((s) => s.scrollHeight - s.clientHeight - s.scrollTop < 2), { timeout: 60000 }).toBe(true)
  // The slot shows under the pointer, among the rows that were off screen.
  const slot = list.locator('[data-drop-slot]')
  await expect(slot).toHaveCount(1)
  await expect.poll(async () => (await box(slot)).y > lb.y + lb.height / 2).toBe(true)
  // Where the slot is: between drawn rows near the end.
  const after = await slot.evaluate((s) => {
    let prev = s.closest('[data-row-key]')?.previousElementSibling ?? s.previousElementSibling
    while (prev && !prev.querySelector('[data-task-title]')) prev = prev.previousElementSibling
    return prev?.querySelector('[data-task-title]')?.getAttribute('data-task-title') ?? null
  })
  expect(after).not.toBeNull()
  await page.mouse.up()

  // Task 2 lands right after the row the slot followed, and that row is drawn.
  const titles = await list.locator('[data-task-title]').evaluateAll((els) => els.map((e) => e.getAttribute('data-task-title')))
  expect(titles.indexOf('Task 2')).toBe(titles.indexOf(after ?? '') + 1)
  expect(titles.indexOf('Task 2')).toBeGreaterThan(80)
  expect(await drawn(rowOf(list, 'Task 2').locator('[data-todo-id]'))).toBe(true)
})

test('the keyboard cursor moving onto an off-screen row scrolls it in and draws it', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const list = await seedTaskList(page, { tasks: Array.from({ length: 100 }, (_, n) => ({ title: `Task ${n + 1}` })) })
  await expect(rows(list)).toHaveCount(100)
  const target = rowOf(list, 'Task 90')
  expect(await drawn(target.locator('[data-todo-id]'))).toBe(false)

  await rowOf(list, 'Task 1').locator('[data-task-title]').click()
  await expect(rowOf(list, 'Task 1')).toHaveAttribute('data-selected', 'true')
  for (let i = 0; i < 89; i++) await page.keyboard.press('ArrowDown')

  await expect(target).toHaveAttribute('data-cursor', 'true')
  await expect.poll(() => drawn(target.locator('[data-todo-id]'))).toBe(true)
  // In the list's view.
  const s = await box(scroller(list))
  const t = await box(target)
  expect(t.y).toBeGreaterThanOrEqual(s.y - 0.5)
  expect(t.y + t.height).toBeLessThanOrEqual(s.y + s.height + 0.5)
})
