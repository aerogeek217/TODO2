import { expect, test, type Locator, type Page } from '@playwright/test'
import { clicksGetThrough, drag, enterLayoutEdit, releaseDrag, seedWorkspace, wsCell, wsGrip, wsPanelHandle, wsShape, type WsLayoutSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The cell menus (UX cleanup 4A; layout edit mode E3, E4) in a real
 * browser: outside the layout edit mode there is no grip — a cell's ⋯ opens
 * the widget's entries, Add widget as tab ›, Remove widget, Collapse row
 * and Edit layout. In the mode (E3) the grip is gone too: the cell is a
 * card, its ⋯ (Cell layout) opens its menu (Move to, Swap with, Split,
 * Merge with, Stretch, Remove widget, Close cell) under it; Enter on the
 * focused card opens it and Esc gives the card its focus back; a drag from
 * anywhere on the card moves it (on the draft) and opens nothing, also when
 * it ends back where it began; a multi-tab card's header room drags it too.
 * The one-widget slot shows without a fade; floating over a face, it takes
 * no press while hidden.
 */

/** `a b`: Notes beside a Calendar, each alone in its cell. */
const notesCalendar: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b'],
    cells: [
      { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
      { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
    ],
  },
}

/** `a b`: two widgets in a, Notes in b. */
const strip: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['a b'],
    cells: [
      { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'calTab', kind: 'calendar' }] },
      { id: 'b', tabs: [{ id: 'notes2', kind: 'notes' }] },
    ],
  },
}

/** A Number alone in a cell (its slot floats over the cell's corner) beside Notes. */
const number: WsLayoutSeed = {
  name: 'Main',
  table: {
    areas: ['n b'],
    cells: [
      { id: 'n', tabs: [{ id: 'num', kind: 'number' }] },
      { id: 'b', tabs: [{ id: 'notesTab', kind: 'notes' }] },
    ],
  },
}

const layoutMenu = (page: Page) => page.getByRole('menu', { name: 'Cell layout' })
const optionsMenu = (page: Page) => page.getByRole('menu', { name: 'Cell options' })
const labels = (menu: Locator) => menu.locator(':scope > [role^="menuitem"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-menu-label')))

test('outside the mode: no grip, no drag handle; the ⋯ the widget’s entries, Add widget as tab, Remove widget, Collapse row, Edit layout', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  const cell = wsCell(page, 'a')
  await cell.hover()
  await expect(wsGrip(page, 'a')).toHaveCount(0)
  await expect(page.locator('[data-ws-panel-handle]')).toHaveCount(0)
  await cell.getByRole('button', { name: 'Cell options' }).click()
  await expect(optionsMenu(page)).toBeVisible()
  expect(await labels(optionsMenu(page))).toEqual(['Open larger', 'Name and icon…', 'Change widget', 'Add widget as tab', 'Remove widget', 'Collapse row', 'Edit layout'])
})

const CARD_MENU = ['Move to', 'Swap with', 'Split', 'Merge with', 'Stretch right', 'Stretch down', 'Remove widget', 'Close cell']

test('in the mode, one widget: no grip; the card’s ⋯ opens its menu under it', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await enterLayoutEdit(page)
  await expect(page.getByTestId('ws-cell-grip')).toHaveCount(0)
  const more = wsCell(page, 'a').getByRole('button', { name: 'Cell layout' })
  await expect(more).toHaveAttribute('aria-haspopup', 'menu')
  await more.click()
  await expect(layoutMenu(page)).toBeVisible()
  expect(await labels(layoutMenu(page))).toEqual(CARD_MENU)
  await expect(more).toHaveAttribute('aria-expanded', 'true')
  // It opens under the ⋯.
  const g = await box(more)
  const m = await box(layoutMenu(page))
  expect(m.y).toBeGreaterThanOrEqual(g.y + g.height)
  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toHaveCount(0)
})

test('in the mode, the keyboard: Enter on the focused card opens its menu; Esc gives the card its focus back', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await enterLayoutEdit(page)
  const card = wsGrip(page, 'b')
  await card.focus()
  await page.keyboard.press('Enter')
  await expect(layoutMenu(page)).toBeVisible()
  // The first item it can run: no slot to move to, so Swap with.
  await expect(layoutMenu(page).getByRole('menuitem', { name: 'Swap with' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect(card).toBeFocused()
  await page.keyboard.press('Enter')
  // ↓ to Split, → into its sides, ⏎ on Above.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await wsShape(page)).flat().length).toBe(3)
})

test('in the mode, a drag from anywhere on the card moves it and opens no menu, also when it ends back where it began', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await enterLayoutEdit(page)
  const from = await pointIn(wsGrip(page, 'a'))
  // Away and back: the drag starts (past 5px) and ends where it began.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 60, { steps: 6 })
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await releaseDrag(page)
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])

  // Into the Calendar's right zone: the card moves, no menu.
  const b = await box(wsCell(page, 'b'))
  await drag(page, await pointIn(wsGrip(page, 'a')), { x: b.x + b.width - 20, y: b.y + b.height / 2 })
  await expect.poll(() => wsShape(page)).toEqual([[['calTab']], [['notesTab']]])
  await expect(layoutMenu(page)).toHaveCount(0)
})

test('in the mode, a drag cancelled with Esc and let go on the card opens no menu', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await enterLayoutEdit(page)
  const from = await pointIn(wsGrip(page, 'a'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 30, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.move(from.x, from.y, { steps: 4 })
  // Past dnd-kit's own click guard (50 ms after the cancel): the click this mouse-up makes reaches the card.
  await clicksGetThrough(page)
  await page.mouse.up()
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
  // The mode stayed (Esc cancelled the drag only).
  await expect(page.locator('[data-layout-edit-bar]')).toBeVisible()
})

test('in the mode, several widgets: the header’s own buttons give way to the card’s ⋯; a click on the header room opens nothing, a drag there moves the card', async ({ page }) => {
  await seedWorkspace(page, { layouts: [strip] })
  await enterLayoutEdit(page)
  const header = page.locator('[data-ws-cell-header="a"]')
  await expect(header.getByRole('button', { name: 'Cell options' })).toHaveCount(0)
  await wsCell(page, 'a').getByRole('button', { name: 'Cell layout' }).click()
  expect(await labels(layoutMenu(page))).toEqual([...CARD_MENU.slice(0, -1), 'Close cell (2 tabs)'])
  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toHaveCount(0)

  // The header's room: a click selects the card, no menu.
  const room = await pointIn(wsPanelHandle(page, 'a'))
  await page.mouse.click(room.x, room.y)
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect(optionsMenu(page)).toHaveCount(0)
  await expect(wsCell(page, 'a')).toHaveAttribute('data-edit-selected', '')

  // A drag from there moves the whole card.
  const b = await box(wsCell(page, 'b'))
  await drag(page, await pointIn(wsPanelHandle(page, 'a')), { x: b.x + b.width - 20, y: b.y + b.height / 2 })
  await expect.poll(() => wsShape(page)).toEqual([[['notes2']], [['notesTab', 'calTab']]])
  await expect(layoutMenu(page)).toHaveCount(0)
})

test.describe('the one-widget slot', () => {
  /** Whether a press at the middle of `el` would land on one of the slot's controls (a button in it). */
  async function pressLandsInSlot(page: Page, el: Locator): Promise<boolean> {
    const p = await pointIn(el)
    return page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-cell-controls] button') != null, p)
  }
  const controls = (cell: Locator) => cell.locator('[data-cell-controls] > span').last()
  const style = (el: Locator) => el.evaluate((e) => ({ opacity: getComputedStyle(e).opacity, transition: getComputedStyle(e).transitionDuration, events: getComputedStyle(e).pointerEvents }))

  test('in a top line: no fade, and nothing of a neighbour’s lies under the slot', async ({ page }) => {
    await seedWorkspace(page, { layouts: [notesCalendar] })
    const cal = wsCell(page, 'b')
    await page.mouse.move(2, 2)
    await expect.poll(async () => (await style(controls(cal))).opacity).toBe('0')
    expect((await style(controls(cal))).transition).toBe('0s')
    // Under each control: only the slot and what holds it (the top line, the cell…), never another part of the line.
    for (const el of [cal.getByRole('button', { name: 'Cell options' })]) {
      const p = await pointIn(el)
      const others = await page.evaluate(({ x, y }) => {
        const slot = document.elementFromPoint(x, y)?.closest('[data-cell-controls]')
        if (!slot) return ['no slot']
        return document.elementsFromPoint(x, y)
          .filter((e) => !slot.contains(e) && !e.contains(slot))
          .map((e) => e.outerHTML.slice(0, 80))
      }, p)
      expect(others).toEqual([])
    }
    await cal.hover()
    expect(await style(controls(cal))).toMatchObject({ opacity: '1', transition: '0s' })
  })

  test('floating over a Number’s corner: hidden, a press there reaches the Number', async ({ page }) => {
    await seedWorkspace(page, { layouts: [number] })
    const cell = wsCell(page, 'n')
    const more = cell.getByRole('button', { name: 'Cell options' })
    await page.mouse.move(2, 2)
    await expect.poll(async () => (await style(controls(cell))).opacity).toBe('0')
    expect(await style(controls(cell))).toEqual({ opacity: '0', transition: '0s', events: 'none' })
    expect(await pressLandsInSlot(page, more)).toBe(false)
    const p = await pointIn(more)
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-ws-cell="n"]') != null, p)).toBe(true)
    await cell.hover()
    expect(await pressLandsInSlot(page, more)).toBe(true)
    await more.click()
    await expect(optionsMenu(page)).toBeVisible()
  })
})
