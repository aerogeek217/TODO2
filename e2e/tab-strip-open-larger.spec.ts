import { expect, test, type Page } from '@playwright/test'
import { openCellMenu, seedWorkspace, wsCell, wsRow, type WsTabSeed } from './fixtures/workspace'
import { expectFits, findStripWidths, stripAt, stripState, widestWidthWhere, type StripState } from './fixtures/tab-strip'

/**
 * Open larger in a tab strip's header (cr34 T9), where jsdom can't say: the
 * button is hidden by a container query while the header is under 340px
 * wide (the strip keeps that room; the ⋯ menu still has the entry), and the
 * strip fits its tabs again when the button comes or goes without the header
 * changing size — it comes and goes with the active widget's face. The
 * window sizes are found by measuring (`fixtures/tab-strip`).
 */

/** The header width under which Open larger gives way (`WorkspaceCell.module.css`: `max-width: 339px`). */
const HEADER_MIN_FOR_OPEN_LARGER = 340

const popup = (page: Page) => page.getByTestId('widget-popup')

const OTHERS: WsTabSeed[] = [
  { id: 'n1', kind: 'notes' },
  { id: 'c1', kind: 'calendar' },
  { id: 'e1', kind: 'neglect' },
]

test('Open larger shows in a header of 340px or more and opens the active tab’s widget; under 340px it gives way, the ⋯ menu keeps the entry', async ({ page }) => {
  const narrow = (id: string) =>
    ({ id: `col-${id}`, weight: 1, rows: [wsRow({ id, tabs: [{ id: `n-${id}`, kind: 'notes' as const }] })] })
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Team' }],
    tasks: [{ title: 'Book the venue' }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }, ...OTHERS], activeTabId: 'l1' })] },
        narrow('k2'),
        narrow('k3'),
      ],
    }],
  })
  const { wide } = await findStripWidths(page, 'k1')
  // The widest window whose header the rule still hides the button in (339px or less).
  const under = await widestWidthWhere(page, 'k1', (s) => s.header <= HEADER_MIN_FOR_OPEN_LARGER - 1, { hi: wide, what: 'the header is over 339px' })

  // Either side of it, a px of window at a time: shown from 340px of header, hidden under it, the strip fitting both ways.
  const seen = { shown: 0, hidden: 0 }
  for (let width = under - 6; width <= under + 6; width++) {
    const state = await stripAt(page, 'k1', width)
    // A header within a hair of a whole px either side of the rule's edge says nothing certain.
    if (Math.abs(state.header - (HEADER_MIN_FOR_OPEN_LARGER - 1)) < 0.05) continue
    const expected = state.header > HEADER_MIN_FOR_OPEN_LARGER - 1 ? 'shown' : 'hidden'
    expect(state.openLarger, `${width}: a ${state.header}px header`).toBe(expected)
    expectFits(state, `${width}`)
    seen[expected]++
  }
  expect(seen.shown).toBeGreaterThan(0)
  expect(seen.hidden).toBeGreaterThan(0)

  // Hidden, the header's buttons take less room than shown — the strip and its handle get it.
  const hidden = await stripAt(page, 'k1', under)
  const shown = await stripAt(page, 'k1', under + 3)
  expect(hidden.openLarger).toBe('hidden')
  expect(shown.openLarger).toBe('shown')
  const room = (s: StripState) => s.actionsLeft - s.strip.left
  expect(room(hidden) - room(shown), 'the room the hidden button gives back').toBeGreaterThan(20)

  // Under 340px: no button to press, the entry in the ⋯ menu's widget section.
  await stripAt(page, 'k1', under)
  const cell = wsCell(page, 'k1')
  await cell.locator('[data-ws-cell-header]').hover()
  await expect(cell.locator('[data-ws-cell-header]').getByRole('button', { name: 'Open larger' })).toBeHidden()
  await openCellMenu(page, 'k1')
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Open larger' }).click()
  await expect(popup(page)).toHaveAttribute('aria-label', 'Team')
  await page.keyboard.press('Escape')
  await expect(popup(page)).toHaveCount(0)

  // From 340px: the button, after the grip and before Collapse row, opens the active tab's widget.
  await stripAt(page, 'k1', under + 3)
  await cell.locator('[data-ws-cell-header]').hover()
  const button = cell.locator('[data-ws-cell-header]').getByRole('button', { name: 'Open larger' })
  await expect(button).toBeVisible()
  expect(await cell.locator('[data-ws-cell-header] button').evaluateAll((els) => els
    .filter((el) => el.getBoundingClientRect().width > 0 && el.closest('[role="tablist"]') == null)
    .map((el) => el.getAttribute('aria-label'))
    .filter((name) => name === 'Cell layout' || name === 'Open larger' || name === 'Collapse row' || name === 'Cell options'),
  )).toEqual(['Cell layout', 'Open larger', 'Collapse row', 'Cell options'])
  await button.click()
  await expect(popup(page)).toHaveAttribute('aria-label', 'Team')
})

test('the strip fits its tabs again when Open larger comes and goes with the active widget’s face (the header’s size unchanged)', async ({ page }) => {
  // A Number with a breakdown offers Open larger only where its face leaves the breakdown out: in a short cell.
  await seedWorkspace(page, {
    people: ['Aisha', 'Ben'],
    tasks: [{ title: 'One', people: ['Aisha'] }, { title: 'Two', people: ['Ben'] }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'col1', weight: 1, rows: [wsRow({ id: 'k1', tabs: [{ id: 'num', kind: 'number', glance: { metric: 'open', breakdown: 'people' } }, ...OTHERS, { id: 'c2', kind: 'calendar' }], activeTabId: 'num' })] },
        { id: 'col2', weight: 1, rows: [wsRow({ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }] })] },
      ],
    }],
  })
  const viewport = page.viewportSize()
  if (!viewport) throw new Error('no viewport')
  const { foldAt, fullAt } = await findStripWidths(page, 'k1')
  expect(fullAt - 1).toBeGreaterThan(foldAt)
  // The narrowest window that folds no tab: every tab shrunk as far as it goes, no room to spare.
  const width = foldAt + 1
  const tall = await stripAt(page, 'k1', width)
  expect(tall.openLarger, 'a tall cell draws the Number whole: no Open larger').toBe('absent')
  expect(tall.folded).toHaveLength(0)
  expectFits(tall, 'tall')

  // Shorten the window until the Number's face leaves its breakdown out: Open larger appears in the header.
  let short: StripState | null = null
  let height = viewport.height
  while (height > 160 && short == null) {
    height -= 40
    await page.setViewportSize({ width, height })
    const state = await stripState(page, 'k1')
    if (state.openLarger !== 'absent') short = state
  }
  if (!short) throw new Error('Open larger never showed, down to a 160px window')
  expect(short.openLarger).toBe('shown')
  // Only the button came: the header is as wide as it was.
  expect(Math.abs(short.header - tall.header), 'the header’s width').toBeLessThanOrEqual(0.5)
  // The strip gave it the room: no tab cut off or under the buttons — one folded, there being none to spare.
  expectFits(short, 'short')
  expect(short.folded.length, 'a tab folded to make room for the button').toBeGreaterThan(0)

  // Tall again: the button goes, and the strip takes the room back.
  await page.setViewportSize({ width, height: viewport.height })
  const back = await stripState(page, 'k1')
  expect(back.openLarger).toBe('absent')
  expectFits(back, 'tall again')
  expect(back.shown.map((t) => t.id)).toEqual(tall.shown.map((t) => t.id))
  for (const [i, t] of back.shown.entries()) expect(Math.abs(t.width - (tall.shown[i]?.width ?? 0)), `${t.id}’s width`).toBeLessThanOrEqual(1)
})
