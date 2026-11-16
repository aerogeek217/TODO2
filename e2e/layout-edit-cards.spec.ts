import { expect, test, type Page } from '@playwright/test'
import {
  drag,
  enterLayoutEdit,
  layoutEditBar,
  newestUndoStep,
  openCellLayoutMenu,
  pickCellMenu,
  releaseDrag,
  seedWorkspace,
  wsCell,
  wsGhost,
  wsCard,
  wsShape,
  type WsLayoutSeed,
} from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The layout edit mode's cards and slots (E3) in a real browser: a card
 * drags from anywhere on it and the drop target decides — a slot takes it
 * (its old place a slot), a card's middle joins it as tabs, a card's edge
 * splits it; a tab and a strip's Number drag out on their own (and a Number
 * back into a strip); a card's corner stretches it over a slot; its menu
 * moves it to a slot or swaps it with a card; a tray chip drags a new widget
 * in; tap a card, then a slot, moves it; Alt+arrow moves it, keeping the
 * focus; and Done stores it all as one step the global Undo takes back.
 */

/**
 * `a b` / `c e`: Notes, a Calendar, Created vs completed, and an empty slot
 * at B2.
 */
const grid: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b', 'c e'],
    cells: [
      { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
      { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
      { id: 'c', tabs: [{ id: 'trendTab', kind: 'trend' }] },
      { id: 'e', tabs: [] },
    ],
  },
}

/** `s s` / `a e`: a strip of three Numbers over Notes and an empty slot. */
const strip: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['s s', 'a e'],
    cells: [
      { id: 's', tabs: [{ id: 'numA', kind: 'number', glance: { metric: 'open' } }, { id: 'numB', kind: 'number', glance: { metric: 'overdue' } }, { id: 'numC', kind: 'number', glance: { metric: 'focus' } }] },
      { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
      { id: 'e', tabs: [] },
    ],
  },
}

/** Where the cell holding tab `tabId` sits: its grid area as drawn (`row / col / span r / span c`, 1-based). */
async function placeOf(page: Page, tabId: string): Promise<string | null> {
  return page.evaluate((id) => {
    const el = document.querySelector(`[data-ws-tab="${id}"], [data-number-slot="${id}"]`)
    return el?.closest<HTMLElement>('[data-ws-cell]')?.style.gridArea.replace(/\s+/g, ' ') ?? null
  }, tabId)
}

const slots = (page: Page) => page.locator('[data-ws-table] [data-ws-cell][data-empty="true"]')
const ghostLabel = (page: Page) => page.getByTestId('ws-drop-label')

test('a card dragged onto a slot moves there, its old place a slot; onto a card’s middle it joins as tabs', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  await expect(slots(page)).toHaveCount(1)
  await expect(page.locator('[data-edit-slot="e"]')).toHaveAccessibleName('Empty slot B2')

  await drag(page, await pointIn(wsCard(page, 'a')), await pointIn(wsCell(page, 'e')), {
    during: async () => {
      await expect(wsGhost(page)).toBeVisible()
      await expect(ghostLabel(page)).toHaveText('Move here')
    },
  })
  await expect.poll(() => placeOf(page, 'notesTab')).toBe('2 / 2 / span 1 / span 1')
  await expect(slots(page)).toHaveCount(1)
  await expect(wsCell(page, 'e')).toHaveAttribute('data-empty', 'true')
  // The moved card is selected.
  await expect(wsCell(page, 'a')).toHaveAttribute('data-edit-selected', '')

  // Onto the Calendar's middle: they join as tabs.
  await drag(page, await pointIn(wsCard(page, 'a')), await pointIn(wsCell(page, 'b')), {
    during: async () => { await expect(ghostLabel(page)).toHaveText('Add as tab') },
  })
  await expect(wsCell(page, 'b').locator('[data-ws-tab="notesTab"]')).toHaveCount(1)
  await expect(wsCell(page, 'b').getByRole('tab')).toHaveCount(2)
  // Nothing stored, no global step: the draft only.
  expect(await newestUndoStep(page)).toBeNull()
})

test('a card dropped near another card’s edge splits it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  await drag(page, await pointIn(wsCard(page, 'a')), await pointIn(wsCell(page, 'b'), 0.5, 0.95), {
    during: async () => { await expect(ghostLabel(page)).toHaveText('Split Calendar · below') },
  })
  await expect.poll(async () => {
    const [cal, notes] = [await placeOf(page, 'calTab'), await placeOf(page, 'notesTab')]
    return cal != null && notes != null && cal.split(' / ')[1] === notes.split(' / ')[1] && Number(notes.split(' / ')[0]) > Number(cal.split(' / ')[0])
  }).toBe(true)
})

test('a tab dragged out of a card onto a slot; the card keeps its other tab', async ({ page }) => {
  const seed: WsLayoutSeed = {
    name: 'Main',
    table: {
      areas: ['a b', 'c e'],
      cells: [
        { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
        { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }, { id: 'notes2', kind: 'notes' }], activeTabId: 'calTab' },
        { id: 'c', tabs: [{ id: 'trendTab', kind: 'trend' }] },
        { id: 'e', tabs: [] },
      ],
    },
  }
  await seedWorkspace(page, { layouts: [seed] })
  await enterLayoutEdit(page)
  await drag(page, await pointIn(wsCell(page, 'b').getByRole('tab', { name: /Notes/ })), await pointIn(wsCell(page, 'e')), {
    during: async () => { await expect(ghostLabel(page)).toHaveText('Add here') },
  })
  await expect.poll(() => placeOf(page, 'notes2')).toBe('2 / 2 / span 1 / span 1')
  await expect(wsCell(page, 'b').locator('[data-ws-tab="calTab"]')).toHaveCount(1)
  await expect(wsCell(page, 'b').getByRole('tab')).toHaveCount(0)
})

test('a Number dragged out of its strip onto a slot, and back into the strip', async ({ page }) => {
  await seedWorkspace(page, { layouts: [strip] })
  await enterLayoutEdit(page)
  const numB = page.locator('[data-number-slot="numB"]')
  await drag(page, await pointIn(numB), await pointIn(wsCell(page, 'e')))
  await expect.poll(() => placeOf(page, 'numB')).toBe('2 / 2 / span 1 / span 1')
  await expect(wsCell(page, 's').locator('[data-number-slot]')).toHaveCount(2)

  // Back between the strip's Numbers.
  const numA = await box(page.locator('[data-number-slot="numA"]'))
  await drag(page, await pointIn(wsCell(page, 'e').locator('[data-edit-surface]')), { x: numA.x + numA.width - 4, y: numA.y + numA.height / 2 }, {
    during: async () => { await expect(ghostLabel(page)).toHaveText('Add to strip') },
  })
  await expect(wsCell(page, 's').locator('[data-number-slot]')).toHaveCount(3)
  await expect(page.locator('[data-number-slot="numB"]')).toHaveCount(1)
})

test('a card’s corner stretches it over the slot beside it, previewed while it runs; Esc puts it back', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  const corner = page.locator('[data-edit-corner="c"]')
  const from = await pointIn(corner)
  const e = await box(wsCell(page, 'e'))
  // Esc mid-drag: nothing changes.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(e.x + e.width * 0.8, from.y, { steps: 8 })
  await expect(page.getByTestId('ws-stretch-ghost')).toContainText('Stretch · A2–B2')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect(page.getByTestId('ws-stretch-ghost')).toHaveCount(0)
  await expect(layoutEditBar(page)).toBeVisible()
  expect(await placeOf(page, 'trendTab')).toBe('2 / 1 / span 1 / span 1')

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(e.x + e.width * 0.8, from.y, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => placeOf(page, 'trendTab')).toBe('2 / 1 / span 1 / span 2')
  await expect(slots(page)).toHaveCount(0)
})

test('the card menu: Move to ▸ a slot by its ruler name, Swap with ▸ a card by name', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  await openCellLayoutMenu(page, 'a')
  await pickCellMenu(page, 'Move to', 'B2')
  await expect.poll(() => placeOf(page, 'notesTab')).toBe('2 / 2 / span 1 / span 1')
  // The focus stays on the card that moved.
  await expect(wsCard(page, 'a')).toBeFocused()

  await openCellLayoutMenu(page, 'b')
  await page.getByRole('menuitem', { name: 'Swap with', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Created vs completed/ }).click()
  await expect.poll(() => placeOf(page, 'calTab')).toBe('2 / 1 / span 1 / span 1')
  expect(await placeOf(page, 'trendTab')).toBe('1 / 2 / span 1 / span 1')
})

test('a tray chip dragged onto the slot adds its widget there; a click adds one to the selected slot', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  const chip = layoutEditBar(page).locator('[data-tray-kind="notes"]')
  await drag(page, await pointIn(chip), await pointIn(wsCell(page, 'e')), {
    during: async () => { await expect(ghostLabel(page)).toHaveText('Add here') },
  })
  await expect(slots(page)).toHaveCount(0)
  await expect(wsCell(page, 'e').locator('[data-ws-tab]')).toHaveCount(1)

  // A slot made by Remove widget; selected (its kinds open on a click — Esc closes them), then a chip's click fills it.
  await openCellLayoutMenu(page, 'e')
  await page.getByRole('menuitem', { name: 'Remove widget' }).click()
  await expect(slots(page)).toHaveCount(1)
  await page.locator('[data-edit-slot="e"]').click()
  await expect(page.getByRole('menu', { name: 'Add widget' })).toBeVisible()
  await page.keyboard.press('Escape')
  await layoutEditBar(page).locator('[data-tray-kind="calendar"]').click()
  await expect(slots(page)).toHaveCount(0)
  await expect(wsCell(page, 'e')).toHaveAttribute('data-ws-cell-title', 'Calendar')
})

test('tap a card, then a slot: it moves there; Esc cancels a pending move', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  const hint = page.getByTestId('layout-edit-move-hint')
  await wsCard(page, 'a').click()
  await expect(hint).toContainText('Click a slot to move “Notes” there')
  await page.keyboard.press('Escape')
  await expect(hint).toHaveCount(0)
  // The mode stays: Esc took the pending move only.
  await expect(layoutEditBar(page)).toBeVisible()

  await wsCard(page, 'a').click()
  await page.locator('[data-edit-slot="e"]').click()
  await expect.poll(() => placeOf(page, 'notesTab')).toBe('2 / 2 / span 1 / span 1')
  await expect(hint).toHaveCount(0)
  await expect(wsCard(page, 'a')).toBeFocused()
})

test('Alt+arrow moves a card onto the slot beside it, or swaps it; Shift+arrow stretches it; the focus stays on it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  await enterLayoutEdit(page)
  const c = wsCard(page, 'c')
  await c.focus()
  await page.keyboard.press('Alt+ArrowRight')
  await expect.poll(() => placeOf(page, 'trendTab')).toBe('2 / 2 / span 1 / span 1')
  await expect(c).toBeFocused()
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => placeOf(page, 'trendTab')).toBe('1 / 2 / span 1 / span 1')
  expect(await placeOf(page, 'calTab')).toBe('2 / 2 / span 1 / span 1')
  await expect(c).toBeFocused()

  // The arrows move the selection; Shift+arrow stretches over the slot.
  await page.keyboard.press('ArrowLeft')
  await expect(wsCard(page, 'a')).toBeFocused()
  await page.keyboard.press('Shift+ArrowDown')
  await expect.poll(() => placeOf(page, 'notesTab')).toBe('1 / 1 / span 2 / span 1')
  await expect(wsCard(page, 'a')).toBeFocused()
  await page.keyboard.press('Shift+ArrowUp')
  await expect.poll(() => placeOf(page, 'notesTab')).toBe('1 / 1 / span 1 / span 1')
})

test('Done stores every change as one step; the global Undo brings it all back', async ({ page }) => {
  await seedWorkspace(page, { layouts: [grid] })
  const before = await wsShape(page)
  await enterLayoutEdit(page)
  await openCellLayoutMenu(page, 'a')
  await pickCellMenu(page, 'Move to', 'B2')
  await expect.poll(() => placeOf(page, 'notesTab')).toBe('2 / 2 / span 1 / span 1')
  await wsCard(page, 'c').focus()
  await page.keyboard.press('Shift+ArrowUp')
  await page.keyboard.press('Alt+ArrowUp')
  await expect.poll(() => placeOf(page, 'trendTab')).toBe('1 / 1 / span 1 / span 1')
  await drag(page, await pointIn(layoutEditBar(page).locator('[data-tray-kind="notes"]')), await pointIn(wsCell(page, 'e')))
  await expect(slots(page)).toHaveCount(0)
  await releaseDrag(page)

  await layoutEditBar(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(layoutEditBar(page)).toHaveCount(0)
  await expect.poll(() => newestUndoStep(page)).toBe('Edited layout “Main”')
  const snackbar = page.locator('[data-snackbar-live]')
  await snackbar.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => wsShape(page)).toEqual(before)
})

test('a card too narrow for its active tab’s title names that tab under its strip (E5)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a n'],
        cols: [1000, 1],
        cells: [
          { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
          { id: 'n', tabs: [{ id: 'calTab', kind: 'calendar' }, { id: 'trendTab', kind: 'trend' }] },
        ],
      },
    }],
  })
  const narrow = wsCell(page, 'n')
  await expect.poll(async () => Math.round((await box(narrow)).width)).toBe(120)
  // Outside the mode no card is drawn.
  await expect(narrow.locator('[data-edit-strip-label]')).toHaveCount(0)
  await enterLayoutEdit(page)
  // The strip squeezed to its active tab beside `+1`, the tab's title cut away: its name under the strip.
  await expect(narrow.locator('[data-strip-squeezed]')).toHaveCount(1)
  const label = narrow.locator('[data-edit-strip-label]')
  await expect(label).toBeVisible()
  await expect(label).toHaveText('Calendar')
  const header = await box(narrow.locator('[data-ws-cell-header]'))
  const labelBox = await box(label)
  const card = await box(narrow)
  expect(labelBox.y, 'under the strip').toBeGreaterThanOrEqual(header.y + header.height)
  expect(labelBox.x + labelBox.width, 'inside the card').toBeLessThanOrEqual(card.x + card.width)
  // A card whose strip has room names its tabs itself: no label there.
  await expect(wsCell(page, 'a').locator('[data-edit-strip-label]')).toHaveCount(0)
})
