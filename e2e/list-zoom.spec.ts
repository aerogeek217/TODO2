import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { box } from './fixtures/geometry'
import { dragRow, seedWorkspace, wsListWidget, wsTab, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * D25 C + I1 · a list tab's zoom, in the real browser: the four levels'
 * row heights and group headers, Stacked's details line under the title,
 * Ctrl + wheel stepping the level without zooming the page, the tab menu's
 * − / +, the palette's Zoom List In / Out, a Strips click landing on its
 * row at Rows (focused), a drag reorder and keyboard navigation at Lines,
 * the level surviving a reload, and the Settings default for a tab that
 * hasn't picked one.
 */

type Zoom = 'stacked' | 'rows' | 'lines' | 'strips'

const TAB = 'z1'
const widget = (page: Page) => wsListWidget(page, TAB)
const grid = (page: Page) => widget(page).locator('[data-task-row-grid]')
const rowOf = (page: Page, title: string) => widget(page).locator('[data-row-key]').filter({ hasText: title })
const stripOf = (page: Page, title: string) => widget(page).locator(`[data-row-key]:has([data-task-strip][aria-label="${title}"])`)
const titles = (page: Page) => widget(page).locator('[data-row-key]').evaluateAll((rows) =>
  rows.map((r) => r.querySelector('[data-task-title]')?.getAttribute('data-task-title') ?? r.querySelector('[aria-label]')?.getAttribute('aria-label') ?? ''))

function seed(opts: {
  zoom?: Zoom
  tasks?: WorkspaceSeed['tasks']
  grouping?: string
  sort?: string
  settings?: Record<string, string>
} = {}): WorkspaceSeed {
  return {
    people: ['Ann', 'Bob'],
    tags: ['docs'],
    settings: opts.settings,
    tasks: opts.tasks ?? [
      { title: 'Alpha', people: ['Ann'], tags: ['docs'], dueInDays: 2, followupInDays: 4, subtasks: [{ title: 'a', done: true }, { title: 'b' }] },
      { title: 'Bravo', people: ['Bob'], dueInDays: -1 },
      { title: 'Charlie', people: ['Ann'] },
      { title: 'Delta', people: ['Bob'], followupInDays: -2 },
    ],
    listDefinitions: [{ name: 'Zoomed', grouping: opts.grouping ?? 'none', sort: opts.sort ?? 'manual' }],
    layouts: [{
      name: 'Main',
      columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: TAB, kind: 'lens', listDefIdx: 0, ...(opts.zoom ? { zoom: opts.zoom } : {}) }] })] }],
    }],
  }
}

async function open(page: Page, opts: Parameters<typeof seed>[0] = {}): Promise<void> {
  await seedWorkspace(page, seed(opts))
  await widget(page).waitFor({ state: 'visible' })
}

/** The list tab's stored zoom (the saved layout's view state). */
async function storedZoom(page: Page): Promise<unknown> {
  const layouts = await readStore<{ columns: Array<{ rows: Array<{ cells: Array<{ tabs: Array<{ id: string; viewState?: { zoom?: unknown } }> }> }> }> }>(page, 'layouts')
  const tab = layouts.flatMap((l) => l.columns.flatMap((c) => c.rows.flatMap((r) => r.cells.flatMap((k) => k.tabs)))).find((t) => t.id === TAB)
  return tab?.viewState?.zoom
}

/** Ctrl + one wheel notch over the list's body (`dy` < 0: up). */
async function ctrlWheel(page: Page, dy: number): Promise<void> {
  const b = await box(grid(page))
  await page.mouse.move(b.x + b.width / 2, b.y + 20)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, dy)
  await page.keyboard.up('Control')
}

const heightOf = async (row: Locator) => (await box(row)).height

test.use({ viewport: { width: 1000, height: 700 } })

const LEVELS: Record<Zoom, { row: number; header: number }> = {
  stacked: { row: 44, header: 28 },
  rows: { row: 30, header: 28 },
  lines: { row: 15, header: 20 },
  strips: { row: 4, header: 14 },
}

for (const zoom of ['stacked', 'rows', 'lines', 'strips'] as const) {
  test(`${zoom}: rows ${LEVELS[zoom].row}px, group headers ${LEVELS[zoom].header}px, the top fade under the sticky header`, async ({ page }) => {
    await open(page, { zoom, grouping: 'people' })
    await expect(grid(page)).toHaveAttribute('data-zoom', zoom)
    await expect(widget(page)).toHaveAttribute('data-zoom', zoom)
    const rows = widget(page).locator('[data-row-key]')
    await expect(rows).toHaveCount(4)
    for (const h of await rows.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(h).toBeCloseTo(LEVELS[zoom].row, 0)
    }
    const header = widget(page).locator('[data-list-group] button[aria-expanded]').first()
    expect(await heightOf(header)).toBeCloseTo(LEVELS[zoom].header, 0)
    // The top fade starts under the sticky header, at its height.
    const inset = await grid(page).locator('..').evaluate((el) => {
      const probe = document.createElement('div')
      probe.style.height = 'var(--scroll-fade-inset)'
      el.append(probe)
      const h = probe.getBoundingClientRect().height
      probe.remove()
      return h
    })
    expect(inset).toBeCloseTo(LEVELS[zoom].header, 0)
  })
}

test('Stacked: the details line sits under the title, starting where it does; no divider', async ({ page }) => {
  await open(page, { zoom: 'stacked' })
  const row = rowOf(page, 'Alpha')
  const title = row.locator('[data-task-title]')
  const details = row.locator('[data-stacked-details]')
  const t = await box(title)
  const d = await box(details)
  expect(d.y).toBeGreaterThanOrEqual(t.y + t.height - 1)
  expect(Math.abs(d.x - t.x)).toBeLessThanOrEqual(1)
  // Due (its clock) · follow-up (its flag) · the checklist · people · tags, in that order.
  const cells = await details.locator('[data-row-cell]').evaluateAll((els) => els.map((e) => e.getAttribute('data-row-cell')))
  expect(cells).toEqual(['due', 'followup', 'subtasks', 'people', 'tags'])
  await expect(details.locator('[data-row-cell="due"] svg')).toHaveCount(1)
  await expect(details.locator('[data-row-cell="tags"]')).toHaveText('#docs')
  // A part opens its picker, as a Rows cell does.
  await details.locator('[data-row-cell="tags"]').click()
  await expect(page.getByPlaceholder('Search tags...')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('separator', { name: 'Resize task names and details' })).toHaveCount(0)
})

test('Ctrl + wheel over the list steps the zoom without zooming the page, saved at once and kept on reload', async ({ page }) => {
  await open(page)
  await expect(grid(page)).toHaveAttribute('data-zoom', 'rows')
  const scale = () => page.evaluate(() => ({ dpr: window.devicePixelRatio, vv: window.visualViewport?.scale ?? 1, w: window.innerWidth }))
  const before = await scale()

  await ctrlWheel(page, 100)
  await expect(grid(page)).toHaveAttribute('data-zoom', 'lines')
  await ctrlWheel(page, 100)
  await expect(grid(page)).toHaveAttribute('data-zoom', 'strips')
  // Clamped at the end.
  await ctrlWheel(page, 100)
  await expect(grid(page)).toHaveAttribute('data-zoom', 'strips')
  await ctrlWheel(page, -100)
  await expect(grid(page)).toHaveAttribute('data-zoom', 'lines')
  expect(await scale()).toEqual(before)

  // View state: saved at once, the layout not unsaved.
  await expect.poll(() => storedZoom(page)).toBe('lines')
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await page.reload()
  await expect(grid(page)).toHaveAttribute('data-zoom', 'lines')
})

test('the tab menu steps the zoom with − / +, each disabled at its end, the menu staying open', async ({ page }) => {
  await open(page)
  await wsTab(page, TAB).click({ button: 'right' })
  const zoom = page.getByRole('group', { name: 'Zoom' })
  await expect(zoom.locator('[data-menu-stepper-value]')).toHaveText('Rows')
  await zoom.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom.locator('[data-menu-stepper-value]')).toHaveText('Stacked')
  await expect(grid(page)).toHaveAttribute('data-zoom', 'stacked')
  await expect(zoom.getByRole('button', { name: 'Zoom in' })).toBeDisabled()
  await zoom.getByRole('button', { name: 'Zoom out' }).click()
  await zoom.getByRole('button', { name: 'Zoom out' }).click()
  await zoom.getByRole('button', { name: 'Zoom out' }).click()
  await expect(zoom.locator('[data-menu-stepper-value]')).toHaveText('Strips')
  await expect(zoom.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
  await expect(grid(page)).toHaveAttribute('data-zoom', 'strips')
  await expect.poll(() => storedZoom(page)).toBe('strips')
})

test('the palette’s Zoom List Out / In act on the list on screen', async ({ page }) => {
  await open(page)
  await page.keyboard.press('Control+k')
  const search = page.getByPlaceholder(/Search tasks, commands/)
  await search.pressSequentially('zoom list out')
  await expect(page.getByRole('option', { name: /Zoom List Out/ })).toContainText('Rows → Lines')
  await page.keyboard.press('Enter')
  await expect(grid(page)).toHaveAttribute('data-zoom', 'lines')
  await page.keyboard.press('Control+k')
  await search.pressSequentially('zoom list in')
  await page.keyboard.press('Enter')
  await expect(grid(page)).toHaveAttribute('data-zoom', 'rows')
})

test('a Strips click zooms to Rows on that task: scrolled into view, selected and focused', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 420 })
  const tasks = Array.from({ length: 60 }, (_, i) => ({ title: `Task ${String(i + 1).padStart(2, '0')}` }))
  await open(page, { zoom: 'strips', tasks, sort: 'title' })
  const strip = stripOf(page, 'Task 55')
  await strip.hover()
  await expect(page.getByRole('tooltip')).toHaveText('Task 55')
  await strip.click()
  await expect(grid(page)).toHaveAttribute('data-zoom', 'rows')
  const row = rowOf(page, 'Task 55')
  await expect(row).toBeInViewport()
  await expect(row).toBeFocused()
  await expect(row).toHaveAttribute('data-selected', 'true')
})

for (const theme of ['dark', 'light'] as const) {
  test(`Lines (${theme}): a plain task's tick is a visible neutral, a stale one's plainly dimmer`, async ({ page }) => {
    const ago = new Date(Date.now() - 40 * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    const modifiedAt = `${ago.getFullYear()}-${pad(ago.getMonth() + 1)}-${pad(ago.getDate())}T09:00`
    await open(page, { zoom: 'lines', tasks: [{ title: 'Plain' }, { title: 'Stale', modifiedAt }] })
    await page.evaluate(async (m) => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
        useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
      }
      await mod.useSettingsStore.getState().setThemeMode(m)
    }, theme)
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    await expect(rowOf(page, 'Stale').locator('[data-task-line]')).toHaveAttribute('data-tone', 'stale')
    await expect(rowOf(page, 'Plain').locator('[data-task-line]')).toHaveAttribute('data-tone', 'none')
    // The tick's colour painted over the cell's surface (a canvas does the
    // compositing, whatever syntax the computed colour is in), and that surface: the luminance of each.
    const lum = (title: string) => rowOf(page, title).locator('[data-task-line] > span').first().evaluate((tick) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      const paint = (...colors: string[]) => {
        ctx.clearRect(0, 0, 1, 1)
        for (const c of colors) { ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1) }
        return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)]
      }
      const lin = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
      const L = ([r = 0, g = 0, b = 0]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
      const surface = getComputedStyle(tick.closest('[data-ws-cell]') ?? document.body).backgroundColor
      return { tick: L(paint(surface, getComputedStyle(tick).backgroundColor)), surface: L(paint(surface)) }
    })
    const ratio = (x: number, y: number) => (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
    const plain = await lum('Plain')
    const stale = await lum('Stale')
    expect(ratio(plain.tick, plain.surface)).toBeGreaterThanOrEqual(3)
    expect(ratio(stale.tick, stale.surface)).toBeGreaterThan(1.3)
    expect(ratio(plain.tick, plain.surface) / ratio(stale.tick, stale.surface)).toBeGreaterThanOrEqual(1.8)
  })
}

test('Lines: a drag reorders a manual list', async ({ page }) => {
  await open(page, { zoom: 'lines' })
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  const bravo = await box(rowOf(page, 'Bravo'))
  await dragRow(page, rowOf(page, 'Delta'), bravo.y + 3, async () => {
    await expect(widget(page).locator('[data-drop-slot]')).toHaveCount(1)
  })
  await expect.poll(() => titles(page)).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
})

test('Lines: the keyboard moves the cursor ring, Enter opens the editor; a click opens it too, with the row tooltip on hover', async ({ page }) => {
  await open(page, { zoom: 'lines' })
  const line = rowOf(page, 'Alpha').locator('[data-task-line]')
  await line.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toContainText('Alpha')
  await expect(tip).toContainText('1 of 2 subtasks done')
  await expect(tip).toContainText('Ann')

  await page.mouse.move(5, 650)
  await page.keyboard.press('ArrowDown')
  await expect(rowOf(page, 'Alpha')).toHaveAttribute('data-cursor', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(rowOf(page, 'Bravo')).toHaveAttribute('data-cursor', 'true')
  const ring = await rowOf(page, 'Bravo').evaluate((el) => getComputedStyle(el, '::before').boxShadow)
  expect(ring).not.toBe('none')
  await page.keyboard.press('Enter')
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox').first()).toHaveValue('Bravo')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()

  await rowOf(page, 'Charlie').locator('[data-task-line]').click()
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('textbox').first()).toHaveValue('Charlie')
})

for (const zoom of ['stacked', 'lines'] as const) {
  test(`${zoom}: a task completed from the keyboard lingers, folds and drops out; Shift-select brings up the bulk bar`, async ({ page }) => {
    await open(page, { zoom })
    await page.mouse.move(5, 650)
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(rowOf(page, 'Bravo')).toHaveAttribute('data-cursor', 'true')
    await page.keyboard.press('Space')
    // It lingers (completed), then folds and drops out.
    await expect(widget(page).locator('[data-leaving]')).toHaveCount(1)
    await expect.poll(() => titles(page)).toEqual(['Alpha', 'Charlie', 'Delta'])
    await expect(widget(page).locator('[data-leaving]')).toHaveCount(0)

    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Shift+ArrowDown')
    await expect(widget(page).locator('[data-selected="true"]')).toHaveCount(2)
    await expect(widget(page).getByText('2 selected')).toBeVisible()
  })
}

test('a tab that hasn’t picked a zoom shows the Settings default; the old Comfortable density reads as Stacked', async ({ page }) => {
  await open(page, { settings: { rowDensity: 'lines' } })
  await expect(grid(page)).toHaveAttribute('data-zoom', 'lines')
  await open(page, { settings: { rowDensity: 'comfortable' } })
  await expect(grid(page)).toHaveAttribute('data-zoom', 'stacked')
  // A tab's own pick wins.
  await open(page, { zoom: 'strips', settings: { rowDensity: 'comfortable' } })
  await expect(grid(page)).toHaveAttribute('data-zoom', 'strips')
})
