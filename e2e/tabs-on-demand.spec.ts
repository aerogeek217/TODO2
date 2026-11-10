import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  drag,
  edges,
  expectSameEdges,
  openCellMenu,
  seedWorkspace,
  wsCell,
  wsGhost,
  wsGrip,
  wsShape,
  type WsLayoutSeed,
} from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * Tabs on demand (D26 AA1) in a real browser: a cell with one widget has no
 * tab strip — its widget's top line names it, and the grip and ⋯ show on
 * hover and on keyboard focus —; a second widget brings the tabs, closing it
 * takes them away; the grip drags the whole cell under the drop ghost; a
 * list's name and badge sit on its filter line; a collapsed row shows its
 * cells' top lines; the phone has no tab row for one widget either.
 */

/** `a b`: Notes beside a Calendar. */
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

const topLine = (cell: Locator) => cell.locator('[data-widget-top-line]').first()
const slotControls = (cell: Locator) => cell.locator('[data-cell-controls] > span').last()
const opacity = (el: Locator) => el.evaluate((e) => Number(getComputedStyle(e).opacity))

test('a cell of several widgets: the active tab’s × and the add-tab + show on the cell’s hover and keyboard focus, the strip’s fit unchanged', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a b'],
        cells: [
          { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'calTab', kind: 'calendar' }] },
          { id: 'b', tabs: [{ id: 'notes2', kind: 'notes' }] },
        ],
      },
    }],
  })
  const cell = wsCell(page, 'a')
  const close = cell.getByRole('tab', { selected: true }).getByRole('button', { name: /^Close / })
  const add = cell.getByRole('button', { name: 'Add widget as tab' })
  const tabBox = () => box(cell.getByRole('tab', { selected: true }))
  await page.mouse.move(2, 2)
  await expect.poll(() => opacity(close)).toBe(0)
  await expect.poll(() => opacity(add)).toBe(0)
  const atRest = await tabBox()
  await cell.hover()
  await expect.poll(() => opacity(close)).toBe(1)
  await expect.poll(() => opacity(add)).toBe(1)
  // Opacity only: the tab keeps its width and place.
  expect(await tabBox()).toEqual(atRest)
  await page.mouse.move(2, 2)
  await expect.poll(() => opacity(add)).toBe(0)
  // Keyboard focus in the cell shows them too.
  await cell.getByRole('tab', { selected: true }).focus()
  await expect.poll(() => opacity(close)).toBe(1)
  await expect.poll(() => opacity(add)).toBe(1)
})

test('a one-widget cell has no tablist; its top line’s grip and ⋯ show on hover and on keyboard focus', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  const cal = wsCell(page, 'b')
  await expect(cal).toBeVisible()
  await expect(page.locator('[data-ws-table]').getByRole('tablist')).toHaveCount(0)
  await expect(page.locator('[data-ws-cell-header]')).toHaveCount(0)
  // The calendar's header is its top line; it stands for the tab.
  await expect(topLine(cal)).toHaveAttribute('data-ws-tab', 'calTab')
  await expect(topLine(cal).getByTestId('calendar-range-label')).toBeVisible()
  await expect(topLine(cal).getByRole('button', { name: 'Cell options' })).toHaveCount(1)
  await expect(topLine(cal).getByTestId('ws-cell-grip')).toHaveCount(1)

  // At rest the slot is out of sight (opacity only: the line never moves).
  await page.mouse.move(2, 2)
  await expect.poll(() => opacity(slotControls(cal))).toBe(0)
  await cal.hover()
  await expect.poll(() => opacity(slotControls(cal))).toBe(1)
  await page.mouse.move(2, 2)
  await expect.poll(() => opacity(slotControls(cal))).toBe(0)

  // Keyboard: Tab from the calendar's Previous month button reaches its other controls, the slot shows.
  await cal.getByRole('button', { name: 'Previous month' }).focus()
  await page.keyboard.press('Tab')
  await expect.poll(() => opacity(slotControls(cal))).toBe(1)
  // Shift+F10 in the top line opens the ⋯ menu: the widget's entries, then the cell's.
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Split cell' })).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: /^Change widget/ })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  // The focus is back in the cell: Tab reaches the ⋯ itself.
  const more = topLine(cal).getByRole('button', { name: 'Cell options' })
  await more.focus()
  await page.keyboard.press('Enter')
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(more).toBeFocused()
})

test('a right-click on the top line opens the ⋯ menu at the pointer', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await topLine(wsCell(page, 'a')).click({ button: 'right', position: { x: 12, y: 10 } })
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu).toBeVisible()
  await expect(menu.getByRole('menuitem', { name: 'Close cell', exact: true })).toBeVisible()
})

test('adding a second widget shows the tabs; closing it hides them again', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  const notes = wsCell(page, 'a')
  await expect(notes.getByRole('tablist')).toHaveCount(0)
  await openCellMenu(page, 'a')
  await page.getByRole('menuitem', { name: 'Add widget…' }).click()
  await page.getByRole('menu', { name: 'Add widget' }).getByRole('menuitem', { name: 'Calendar', exact: true }).click()

  await expect(notes.getByRole('tablist')).toBeVisible()
  await expect(notes.getByRole('tab')).toHaveCount(2)
  // With a strip, the strip names the widgets: no top line stands for a tab.
  await expect(notes.locator('[data-widget-top-line][data-ws-tab]')).toHaveCount(0)

  // Close the new one from the merged ⋯ menu (the strip's header holds it now).
  await openCellMenu(page, 'a')
  await page.getByRole('menuitem', { name: 'Close tab “Calendar”' }).click()
  await expect(notes.getByRole('tablist')).toHaveCount(0)
  await expect(topLine(notes)).toHaveAttribute('data-ws-tab', 'notesTab')
})

test('dragging by the grip moves the whole cell, under the drop ghost', async ({ page }) => {
  await seedWorkspace(page, { layouts: [notesCalendar] })
  await wsCell(page, 'a').hover()
  const target = wsCell(page, 'b').locator('[data-ws-cell-body]')
  const b = await box(target)
  // b's right zone: Notes goes to the right of the Calendar.
  const to = { x: b.x + b.width - 20, y: b.y + b.height / 2 }
  let ghost = { left: 0, top: 0, right: 0, bottom: 0 }
  await drag(page, await pointIn(wsGrip(page, 'a')), to, {
    during: async () => {
      await expect(wsGhost(page)).toBeVisible()
      await expect(page.getByTestId('ws-drop-label')).toHaveText('Split Calendar · right')
      ghost = await edges(wsGhost(page))
    },
  })
  await expect.poll(() => wsShape(page)).toEqual([[['calTab']], [['notesTab']]])
  expectSameEdges(ghost, await edges(page.locator('[data-ws-cell]:has([data-ws-tab="notesTab"])')))
})

test('a list widget alone: its name and badge sit on its filter line', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Inbox' }],
    tasks: [{ title: 'Due today', dueInDays: 0 }, { title: 'Later', dueInDays: 20 }],
    layouts: [{ name: 'Main', table: { areas: ['l'], cells: [{ id: 'l', tabs: [{ id: 'inbox', kind: 'lens', listDefIdx: 0 }] }] } }],
  })
  const cell = wsCell(page, 'l')
  const line = cell.getByTestId('list-filter-row')
  await expect(line).toHaveAttribute('data-widget-top-line', '')
  await expect(line.getByTestId('top-line-name')).toHaveText('Inbox')
  await expect(line.locator('[data-top-line-badge]')).toBeVisible()
  await expect(line.locator('[data-top-line-badge] [data-badge-part="due"]')).toHaveText('1')
  await expect(line.getByTestId('list-count')).toHaveText('2')
  await expect(cell.getByRole('tablist')).toHaveCount(0)
  // Name, badge and the line's own chips on one line, the ⋯ at its end.
  const nameBox = await box(line.getByTestId('top-line-name'))
  const moreBox = await box(line.getByRole('button', { name: 'Cell options' }))
  expect(Math.abs(nameBox.y + nameBox.height / 2 - (moreBox.y + moreBox.height / 2))).toBeLessThanOrEqual(2)
})

test('a list whose filter line is hidden: alone, a slim top line still names it with its badge and count', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Inbox', showFilterLine: false }],
    tasks: [{ title: 'Due today', dueInDays: 0 }],
    layouts: [{ name: 'Main', table: { areas: ['l'], cells: [{ id: 'l', tabs: [{ id: 'inbox', kind: 'lens', listDefIdx: 0 }] }] } }],
  })
  const cell = wsCell(page, 'l')
  await expect(cell.getByTestId('list-filter-row')).toHaveCount(0)
  const line = cell.getByTestId('list-name-line')
  await expect(line.getByTestId('top-line-name')).toHaveText('Inbox')
  await expect(line.locator('[data-top-line-badge]')).toBeVisible()
  await expect(line.getByTestId('list-count')).toHaveText('1')
})

test('a collapsed row shows each cell’s top line', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{
      name: 'Main',
      table: {
        areas: ['a b', 'c c'],
        rows: [{ weight: 1000, collapsed: true }, 1000],
        cells: [
          { id: 'a', tabs: [{ id: 'notesTab', kind: 'notes' }] },
          { id: 'b', tabs: [{ id: 'calTab', kind: 'calendar' }] },
          { id: 'c', tabs: [{ id: 'notes2', kind: 'notes' }] },
        ],
      },
    }],
  })
  for (const id of ['a', 'b']) {
    const cell = wsCell(page, id)
    await expect(topLine(cell)).toBeVisible()
    const cellBox = await box(cell)
    const lineBox = await box(topLine(cell))
    expect(cellBox.height).toBeLessThanOrEqual(40)
    // The line starts at the card's top and is what shows of it.
    expect(Math.abs(lineBox.y - cellBox.y)).toBeLessThanOrEqual(1)
    await expect(topLine(cell).getByRole('button', { name: 'Expand row' })).toBeVisible()
  }
  await expect(topLine(wsCell(page, 'a'))).toContainText('Notes')
  await expect(topLine(wsCell(page, 'b')).getByTestId('calendar-range-label')).toBeVisible()
  // The calendar's grid is hidden under its top line.
  await expect(wsCell(page, 'b').locator('[data-cal-grid]')).toBeHidden()

  await topLine(wsCell(page, 'a')).getByRole('button', { name: 'Expand row' }).click()
  await expect.poll(async () => (await box(wsCell(page, 'b'))).height).toBeGreaterThan(100)
})

test.describe('the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('a one-widget cell has no tab row; its ⋯ shows; two widgets have tabs', async ({ page }: { page: Page }) => {
    await seedWorkspace(page, {
      layouts: [{
        name: 'Main',
        table: {
          areas: ['a', 'b'],
          cells: [
            { id: 'a', tabs: [{ id: 'calTab', kind: 'calendar' }] },
            { id: 'b', tabs: [{ id: 'notesTab', kind: 'notes' }, { id: 'cal2', kind: 'calendar' }] },
          ],
        },
      }],
    })
    const one = wsCell(page, 'a')
    await expect(one).toBeVisible()
    await expect(one.getByRole('tablist')).toHaveCount(0)
    await expect(one.locator('[data-ws-cell-header]')).toHaveCount(0)
    const more = topLine(one).getByRole('button', { name: 'Cell options' })
    await expect(more).toBeVisible()
    expect(await opacity(slotControls(one))).toBe(1)
    await expect(one.getByTestId('ws-cell-grip')).toHaveCount(0)
    await more.click()
    await expect(page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Collapse row' })).toBeVisible()
    await page.keyboard.press('Escape')

    await expect(wsCell(page, 'b').getByRole('tablist')).toBeVisible()
    await expect(wsCell(page, 'b').getByRole('tab')).toHaveCount(2)
  })
})
