import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, releaseDrag, seedWorkspace, wsCell, wsGrip, wsPanelHandle, wsShape, type WsLayoutSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The grip menu (UX cleanup 4A) in a real browser: a cell's ⋯ opens the
 * widget's entries and Add widget…; a click on its grip — a button —
 * opens the cell's layout entries (Split, Merge, Insert, Collapse row,
 * Close …); Enter / Space on the focused grip open it and Esc gives the grip
 * its focus back; a drag by the grip moves the cell and opens nothing, also
 * when it ends back on the grip; a multi-tab cell has a grip button in its
 * header, while a click on the header's empty space opens nothing. The
 * one-widget slot shows without a fade; floating over a face, it takes no
 * press while hidden.
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

test('one widget: the grip opens the layout menu, the ⋯ the widget’s entries and Add widget…', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  const cell = wsCell(page, 'a')
  await cell.hover()
  const grip = wsGrip(page, 'a')
  await expect(grip).toHaveAttribute('aria-haspopup', 'menu')
  await expect(grip).toHaveAccessibleName('Cell layout')
  await grip.click()
  await expect(layoutMenu(page)).toBeVisible()
  expect(await labels(layoutMenu(page))).toEqual(['Split cell', 'Merge with', 'Insert', 'Collapse row', 'Close cell'])
  await expect(grip).toHaveAttribute('aria-expanded', 'true')
  // It opens under the grip.
  const g = await box(grip)
  const m = await box(layoutMenu(page))
  expect(m.y).toBeGreaterThanOrEqual(g.y + g.height)
  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toHaveCount(0)

  await cell.getByRole('button', { name: 'Cell options' }).click()
  await expect(optionsMenu(page)).toBeVisible()
  expect(await labels(optionsMenu(page))).toEqual(['Name and icon…', 'Change widget', 'Add widget…'])
})

test('the keyboard: Enter and Space on the focused grip open its menu; Esc gives the grip its focus back', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  const grip = wsGrip(page, 'b')
  await grip.focus()
  await page.keyboard.press('Enter')
  await expect(layoutMenu(page)).toBeVisible()
  await expect(layoutMenu(page).getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect(grip).toBeFocused()
  await page.keyboard.press(' ')
  await expect(layoutMenu(page)).toBeVisible()
  // ↓ to Merge with, then Collapse row by its letter… or simply Split ▸ Right by the keyboard.
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (await wsShape(page)).flat().length).toBe(3)
})

test('a drag by the grip moves the cell and opens no menu, also when it ends back on the grip', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await wsCell(page, 'a').hover()
  const from = await pointIn(wsGrip(page, 'a'))
  // Away and back: the drag starts (past 5px) and ends where it began.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 40, from.y + 60, { steps: 6 })
  await page.mouse.move(from.x, from.y, { steps: 6 })
  await releaseDrag(page)
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])

  // Into the Calendar's right zone: the cell moves, no menu.
  await wsCell(page, 'a').hover()
  const b = await box(wsCell(page, 'b').locator('[data-ws-cell-body]'))
  await drag(page, await pointIn(wsGrip(page, 'a')), { x: b.x + b.width - 20, y: b.y + b.height / 2 })
  await expect.poll(() => wsShape(page)).toEqual([[['calTab']], [['notesTab']]])
  await expect(layoutMenu(page)).toHaveCount(0)
})

test('a drag cancelled with Esc and let go on the grip opens no menu', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await wsCell(page, 'a').hover()
  const from = await pointIn(wsGrip(page, 'a'))
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 30, { steps: 4 })
  await page.keyboard.press('Escape')
  await page.mouse.move(from.x, from.y, { steps: 4 })
  // Long past dnd-kit's own 50ms click guard.
  await page.waitForTimeout(150)
  await page.mouse.up()
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect.poll(() => wsShape(page)).toEqual([[['notesTab']], [['calTab']]])
})

test('several widgets: the header’s grip button opens the layout menu; a click on the empty header opens nothing, a drag there moves the cell', async ({ page }) => {
  await seedWorkspace(page, { layouts: [strip] })
  const header = page.locator('[data-ws-cell-header="a"]')
  await header.hover()
  const grip = header.getByRole('button', { name: 'Cell layout' })
  await expect(grip).toHaveAttribute('aria-haspopup', 'menu')
  await grip.click()
  expect(await labels(layoutMenu(page))).toEqual(['Split cell', 'Merge with', 'Insert', 'Collapse row', 'Close tab “Notes”', 'Close cell (2 tabs)'])
  await page.keyboard.press('Escape')
  await expect(layoutMenu(page)).toHaveCount(0)

  // The empty space: no menu on a click.
  await wsPanelHandle(page, 'a').click()
  await expect(layoutMenu(page)).toHaveCount(0)
  await expect(optionsMenu(page)).toHaveCount(0)

  // The header grip drags the whole cell too.
  const b = await box(wsCell(page, 'b').locator('[data-ws-cell-body]'))
  await header.hover()
  await drag(page, await pointIn(grip), { x: b.x + b.width - 20, y: b.y + b.height / 2 })
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
    for (const el of [wsGrip(page, 'b'), cal.getByRole('button', { name: 'Cell options' })]) {
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
    expect(await pressLandsInSlot(page, wsGrip(page, 'n'))).toBe(false)
    const p = await pointIn(more)
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-ws-cell="n"]') != null, p)).toBe(true)
    await cell.hover()
    expect(await pressLandsInSlot(page, more)).toBe(true)
    await more.click()
    await expect(optionsMenu(page)).toBeVisible()
  })
})
