import { expect, test, type Page } from '@playwright/test'
import { drag, expectLayoutStep, expectLayoutStored, seedWorkspace, wsCell, wsRow, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { pointIn } from './fixtures/geometry'

/**
 * The List board (widget kind `shortcuts`): a tile per list. Lists I pick:
 * two lists of two layouts are added from the widget; a tile shows its list
 * tab's icon, its badge capsule, its squares and its first titles; a click
 * opens the list in the widget popup over this layout; a drag reorders the
 * tiles, saved with the layout; and as the cell shrinks the titles go
 * first, then the tiles go to one line, then to rows. This layout's lists:
 * a tile per list tab in reading order; a click opens the tab larger, Show
 * in its cell brings it to the front of its cell, a square opens its task;
 * Which lists › switches the source as one undo step.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const TASKS: WorkspaceSeed['tasks'] = [
  { title: 'Call Acme', dueInDays: -1 },
  { title: 'Send the invoice' },
  { title: 'Renew the lease' },
  { title: 'Book the venue' },
]

const SEED: WorkspaceSeed = {
  listDefinitions: [
    { name: 'Errands', layoutIdx: 0 },
    { name: 'Clients', layoutIdx: 1 },
  ],
  tasks: TASKS,
  layouts: [
    {
      name: 'Home',
      columns: [
        { id: 'c1', weight: 2, rows: [wsRow({ id: 'k-errands', tabs: [{ id: 't-errands', kind: 'lens', listDefIdx: 0, icon: { kind: 'line', key: 'flag' } }] })] },
        { id: 'c2', weight: 1, rows: [wsRow({ id: 'k-sc', tabs: [{ id: 't-sc', kind: 'shortcuts' }] })] },
      ],
    },
    {
      name: 'Work',
      columns: [{ id: 'w1', rows: [wsRow({ id: 'k-clients', tabs: [{ id: 't-clients', kind: 'lens', listDefIdx: 1, icon: { kind: 'emoji', emoji: '💼' } }] })] }],
    },
  ],
}

/** One layout: Errands and Clients in one cell, Someday under it, the board beside them showing this layout's lists. */
const LAYOUT_SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Errands' }, { name: 'Clients' }, { name: 'Someday' }],
  tasks: TASKS,
  layouts: [{
    name: 'Home',
    columns: [
      {
        id: 'c1',
        weight: 2,
        rows: [
          wsRow({ id: 'k-lists', tabs: [{ id: 't-errands', kind: 'lens', listDefIdx: 0 }, { id: 't-clients', kind: 'lens', listDefIdx: 1 }] }),
          wsRow({ id: 'k-someday', tabs: [{ id: 't-someday', kind: 'lens', listDefIdx: 2 }] }),
        ],
      },
      { id: 'c2', weight: 1, rows: [wsRow({ id: 'k-sc', tabs: [{ id: 't-sc', kind: 'shortcuts', board: { source: 'layout' } }] })] },
    ],
  }],
}

const widget = (page: Page) => wsCell(page, 'k-sc').locator('[data-shortcuts]')
const tiles = (page: Page) => widget(page).locator('[data-shortcut-tile]')
const tile = (page: Page, name: string) => tiles(page).filter({ has: page.getByRole('button', { name: new RegExp(`^${name}: .*Open$`) }) })
const tileNames = (page: Page) => tiles(page).locator('[data-shortcut-name]').allTextContents()
const openButton = (page: Page, name: string) => tile(page, name).getByRole('button', { name: new RegExp(`^${name}: .*Open$`) })

async function addList(page: Page, name: string): Promise<void> {
  const add = widget(page).getByRole('button', { name: 'Add a list' })
  await add.click()
  await page.getByRole('menu', { name: 'Add a list' }).getByRole('menuitem', { name, exact: true }).click()
  await expectLayoutStep(page, `Added “${name}” to List board`)
}

test.describe('Lists I pick', () => {
  test('two lists of two layouts: icon, capsule, squares and titles; a click opens the list; a drag reorders, kept on reload', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(widget(page).getByText('No lists added.')).toBeVisible()
    // The menu: each layout's lists under its name, this layout first.
    await widget(page).getByRole('button', { name: 'Add a list' }).click()
    const menu = page.getByRole('menu', { name: 'Add a list' })
    await expect(menu.locator('[role="presentation"], [role="menuitem"]')).toHaveText(['Home', 'Errands', 'Work', 'Clients'])
    await page.keyboard.press('Escape')
    await addList(page, 'Errands')
    await addList(page, 'Clients')
    await expect.poll(() => tileNames(page)).toEqual(['Errands', 'Clients'])

    // The tile: its tab's icon, its capsule (one overdue), its count, a square per open task (the overdue one first), its first titles.
    const clients = tile(page, 'Clients')
    await expect(clients.locator('[data-app-icon]')).toHaveCount(1)
    await expect(tile(page, 'Errands').locator('[data-app-icon="line"]')).toHaveCount(1)
    await expect(clients.locator('[data-shortcut-badge] [data-badge-part="due"]')).toHaveText('1')
    // Its count is in its tooltip: beside a capsule the head leaves it out.
    await expect(clients.locator('[data-shortcut-count]')).toHaveCount(0)
    await expect(clients.locator('button[data-tone]')).toHaveCount(4)
    await expect(clients.locator('button[data-tone]').first()).toHaveAttribute('data-tone', 'late')
    await expect(clients.locator('[data-peek-line]')).toHaveText(['Call Acme', 'Send the invoice', 'Renew the lease'])
    // Its tooltip: its name and layout, its tasks by state, the legend.
    await openButton(page, 'Clients').hover()
    await expect(page.getByRole('tooltip')).toContainText('Clients · Work')
    await expect(page.getByRole('tooltip')).toContainText('1 overdue · 3 on track')
    await expect(page.getByRole('tooltip')).toContainText('Follow-up late')

    // A click opens the list of the other layout in the popup, over this one.
    await openButton(page, 'Clients').click()
    const popup = page.getByTestId('widget-popup')
    await expect(popup).toHaveAttribute('aria-label', 'Clients')
    await expect(popup.getByText('Book the venue')).toBeVisible()
    await expect(page.locator('[data-layout-tab][aria-selected="true"]')).toHaveText('Home')
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    // A drag puts Clients first: one undo step, and no popup opens.
    await drag(page, await pointIn(clients, 0.5, 0.1), await pointIn(tile(page, 'Errands'), 0.5, 0.1))
    await expect.poll(() => tileNames(page)).toEqual(['Clients', 'Errands'])
    await expectLayoutStep(page, 'Moved “Clients”')
    await expect(popup).toHaveCount(0)
    await page.reload()
    await expect.poll(() => tileNames(page)).toEqual(['Clients', 'Errands'])
  })

  test('as the cell shrinks the titles go first, then one line of tiles, then rows', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await addList(page, 'Errands')
    await addList(page, 'Clients')
    await expectLayoutStored(page)
    const face = () => widget(page).getAttribute('data-shortcuts-face')
    const peekLines = () => widget(page).locator('[data-peek-line]').count()
    const squares = () => widget(page).locator('button[data-tone]').count()
    await expect.poll(face).toBe('large')
    await expect.poll(peekLines).toBe(6)
    await expect.poll(squares).toBe(8)
    // A body about 370px wide (tiles of 120px, as wide as their heads ask): two tiles across, so the Add a list tile
    // starts a second row.
    const wide = (await widget(page).boundingBox())?.width ?? 1
    const width = Math.round(1440 * 370 / wide)
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(async () => Math.abs(((await widget(page).boundingBox())?.width ?? 0) - 370)).toBeLessThan(8)
    // Shorter and shorter, from a body about 320px tall (two rows of tiles): a large face with fewer titles, its squares kept, comes before the compact one.
    const chrome = Math.round(900 - ((await widget(page).boundingBox())?.height ?? 0))
    let fewer = false
    let height = chrome + 320
    while ((await face()) === 'large' && height > chrome + 100) {
      height -= 4
      await page.setViewportSize({ width, height })
      await expect.poll(async () => Math.abs(((await widget(page).boundingBox())?.height ?? 0) - (height - chrome))).toBeLessThan(2)
      const lines = await peekLines()
      if ((await face()) === 'large' && lines < 6) {
        fewer = true
        expect(await squares()).toBe(8)
      }
    }
    expect(fewer).toBe(true)
    await expect.poll(face).toBe('compact')
    await expect(widget(page).locator('[data-peek-line]')).toHaveCount(0)
    await expect(tiles(page)).toHaveCount(2)
    // Narrow: a row per list, its bar in place of squares.
    await page.setViewportSize({ width: 700, height: 900 })
    await expect.poll(face).toBe('rows')
    await expect.poll(() => tileNames(page)).toEqual(['Errands', 'Clients'])
    await expect(widget(page).locator('button[data-tone]')).toHaveCount(0)
    await expect(tile(page, 'Clients').locator('[data-board-bar] [data-tone]')).toHaveCount(2)
  })
})

/** A short board across the top (a weight of 1 against 20) showing this layout's six lists, each a tab in the cell under it. */
const WRAP_NAMES = ['Errands', 'Clients', 'Someday', 'Overdue and due soon', 'Reading', 'Calls']
const WRAP_SEED: WorkspaceSeed = {
  listDefinitions: WRAP_NAMES.map((name) => ({ name })),
  tasks: TASKS,
  layouts: [{
    name: 'Home',
    table: {
      areas: ['b', 'l'],
      rows: [1, 20],
      cells: [
        { id: 'b', tabs: [{ id: 't-board', kind: 'shortcuts', board: { source: 'layout' } }] },
        { id: 'l', tabs: WRAP_NAMES.map((_, i) => ({ id: `t-${i}`, kind: 'lens' as const, listDefIdx: i })) },
      ],
    },
  }],
}

test('tiles share one width wide enough for every name, wrap instead of folding into +N, and the row grows to fit them', async ({ page }) => {
  await seedWorkspace(page, WRAP_SEED)
  const board = wsCell(page, 'b').locator('[data-shortcuts]')
  const boardTiles = board.locator('[data-shortcut-tile]')
  await expect(boardTiles).toHaveCount(6)
  await expect(board.locator('[data-shortcuts-more]')).toHaveCount(0)
  const widths = () => boardTiles.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)))
  const cut = () => board.locator('[data-shortcut-name]').evaluateAll((els) => els.filter((e) => e.scrollWidth > e.clientWidth).length)
  const lines = () => boardTiles.evaluateAll((els) => new Set(els.map((e) => Math.round(e.getBoundingClientRect().top))).size)
  const unseen = () => boardTiles.evaluateAll((els) => {
    const cell = els[0]?.closest('[data-ws-cell]')?.getBoundingClientRect()
    return cell ? els.filter((e) => e.getBoundingClientRect().bottom > cell.bottom + 0.5).length : els.length
  })
  // Wide: one line, every tile as wide as the next, no name cut short, the row at its least (one line of heads).
  await expect.poll(lines).toBe(1)
  const w = await widths()
  expect(Math.max(...w) - Math.min(...w)).toBeLessThanOrEqual(1)
  expect(await cut()).toBe(0)
  await expect.poll(async () => Math.round((await wsCell(page, 'b').boundingBox())?.height ?? 0)).toBe(63)
  // Narrower: the tiles wrap onto more lines, still one width, and the row grows so none is cut off.
  await page.setViewportSize({ width: 700, height: 900 })
  await expect.poll(lines).toBeGreaterThan(1)
  await expect.poll(unseen).toBe(0)
  const v = await widths()
  expect(Math.max(...v) - Math.min(...v)).toBeLessThanOrEqual(1)
  expect(await cut()).toBe(0)
})

test.describe('This layout’s lists', () => {
  test('a tile per list tab; a click opens the tab larger; Show in its cell; a square opens its task', async ({ page }) => {
    await seedWorkspace(page, LAYOUT_SEED)
    await expect.poll(() => tileNames(page)).toEqual(['Errands', 'Clients', 'Someday'])
    await expect(widget(page).getByRole('button', { name: 'Add a list' })).toHaveCount(0)
    await expect(tile(page, 'Clients').locator('button[data-tone]')).toHaveCount(4)

    // A click opens that tab in the popup.
    await openButton(page, 'Clients').click()
    const popup = page.getByTestId('widget-popup')
    await expect(popup).toHaveAttribute('aria-label', 'Clients')
    await page.keyboard.press('Escape')
    await expect(popup).toHaveCount(0)

    // Its menu: Open, Show in its cell — which brings Clients to the front of its cell.
    await expect(wsTab(page, 't-clients')).toHaveAttribute('aria-selected', 'false')
    await openButton(page, 'Clients').click({ button: 'right' })
    const menu = page.getByRole('menu', { name: 'List board options' })
    await expect(menu.getByRole('menuitem')).toHaveText(['Open', 'Show in its cell'])
    await menu.getByRole('menuitem', { name: 'Show in its cell' }).click()
    await expect(wsTab(page, 't-clients')).toHaveAttribute('aria-selected', 'true')
    await expect(popup).toHaveCount(0)

    // A square opens its task.
    await tile(page, 'Someday').getByRole('button', { name: /^Call Acme: Overdue/ }).click()
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
    await expect(popup).toHaveCount(0)
  })

  test('Which lists › switches the source, one undo step; the picks are kept', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await addList(page, 'Clients')
    await expect.poll(() => tileNames(page)).toEqual(['Clients'])
    // Its cell's ⋯ (floating: the pointer over the cell first).
    const pick = async (choice: string) => {
      await wsCell(page, 'k-sc').hover({ position: { x: 40, y: 40 } })
      await wsCell(page, 'k-sc').getByRole('button', { name: 'Cell options' }).click()
      await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: /^Which lists/ }).click()
      await page.getByRole('menuitemradio', { name: choice }).click()
    }
    await pick('This layout’s lists')
    await expect.poll(() => tileNames(page)).toEqual(['Errands'])
    await expect(widget(page)).toHaveAttribute('data-shortcuts-source', 'layout')
    await expectLayoutStep(page, 'Changed “List board”')
    await pick('Lists I pick')
    await expect.poll(() => tileNames(page)).toEqual(['Clients'])
  })
})
