import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsListWidget } from './fixtures/workspace'
import { box, expectInsideViewport } from './fixtures/geometry'

/**
 * The date panel in a real browser: one clause per date type (Due · Next
 * follow-up · Last follow-up / Completed · Created · Modified, two rows of
 * three), several at once (all must match), a type's tab lit while it
 * filters, and selecting a tab never fills in a date. Opened from the top
 * bar's Dates button, a list's date chip / + Filter, and the phone Filters
 * sheet. A Completed range brings in the tasks completed in it without Show
 * completed; Last follow-up is an optional date (cr24 P4, D22).
 */

/** A local date-time `days` from now, as the seed takes it (`2026-10-10T15:30`). */
function localDateTime(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function rows(page: Page, tabId: string) {
  return wsListWidget(page, tabId).locator('[data-todo-id]')
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Date filters' })

/** Every date type on in the top bar (through the filter store), so every tab shows its dot. */
async function lightEveryDateType(page: Page) {
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
      useFilterStore: { getState: () => { filters: Record<string, unknown>; setAllFilters: (f: Record<string, unknown>) => void } }
    }
    const st = mod.useFilterStore.getState()
    const range = (start: unknown, end: unknown) => ({ match: 'range', start, end })
    st.setAllFilters({
      ...st.filters,
      dates: {
        deadline: { match: 'set' },
        followup: { match: 'set' },
        lastFollowup: { ...range(null, { kind: 'offset', days: -14 }), includeNoDate: true },
        completed: range({ kind: 'relative', token: 'start-of-week' }, null),
        created: range({ kind: 'offset', days: -30 }, null),
        modified: range({ kind: 'offset', days: -30 }, null),
      },
    })
  })
}

/** The six tabs sit in two rows of three, in reading order, and no label (with its dot) is cut. */
async function expectTwoRowsUnclipped(scope: Locator) {
  const tabs = scope.getByRole('tab')
  await expect(tabs).toHaveText(['Due', 'Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified'])
  const boxes = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => box(tabs.nth(i))))
  const tops = boxes.map((x) => Math.round(x.y))
  expect(tops.slice(0, 3)).toEqual([tops[0], tops[0], tops[0]])
  expect(tops.slice(3)).toEqual([tops[3], tops[3], tops[3]])
  expect(tops[3]!).toBeGreaterThan(tops[0]!)
  expect(Math.round(boxes[3]!.x)).toBe(Math.round(boxes[0]!.x))
  const clipped = await tabs.evaluateAll((els) => els.flatMap((el) => {
    const label = el.querySelector('span') ?? el
    return label.scrollWidth > label.clientWidth || el.scrollWidth > el.clientWidth ? [el.textContent] : []
  }))
  expect(clipped).toEqual([])
}

test('top bar: Due then Modified filter the screen together; switching tabs fills in nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [
      { title: 'Due soon, old', dueInDays: 2, modifiedAt: localDateTime(-10) },
      { title: 'Due soon, fresh', dueInDays: 2 },
      { title: 'Due later, old', dueInDays: 30, modifiedAt: localDateTime(-10) },
      { title: 'Undated' },
    ],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  await expect(rows(page, 't1')).toHaveCount(4)

  await page.getByRole('button', { name: 'Dates filter', exact: true }).click()
  const panel = dialog(page)
  await expect(panel.getByRole('tab', { name: 'Due' })).toBeFocused()
  await expect(panel.getByText('Not filtering')).toBeVisible()
  await panel.getByLabel('To (relative)').selectOption('end-of-next-week')
  await expect(rows(page, 't1')).toHaveCount(2)
  await expect(panel.getByRole('tab', { name: 'Due, filtering' })).toHaveAttribute('data-filtering', '')

  // Modified: nothing filled in, nothing lit, nothing narrowed — until its own To is set.
  await panel.getByRole('tab', { name: 'Modified' }).click()
  await expect(panel.getByRole('tab', { name: 'Modified' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('tab', { name: 'Modified' })).not.toHaveAttribute('data-filtering', '')
  await expect(panel.getByLabel('From', { exact: true })).toHaveValue('')
  await expect(panel.getByLabel('To', { exact: true })).toHaveValue('')
  await expect(panel.getByLabel('To (relative)')).toHaveValue('__none__')
  await expect(rows(page, 't1')).toHaveCount(2)
  await panel.getByLabel('To (relative)').selectOption('yesterday')
  await expect(rows(page, 't1')).toHaveCount(1)
  await expect(rows(page, 't1')).toHaveText([/Due soon, old/])
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // The button reads both names; its tooltip lists each type; every list shows a screen chip per type.
  const button = page.getByRole('button', { name: /^Dates filter: Due by end of next week; Modified before today$/ })
  await expect(button).toHaveText('Due + Modified')
  await button.hover()
  const tip = page.getByRole('tooltip')
  await expect(tip).toContainText('Due: by end of next week')
  await expect(tip).toContainText('Modified: before today')
  await expect(tip).toContainText('Tasks must match both · × clears both')
  await expect(wsListWidget(page, 't1').getByTestId('screen-filter-chip')).toHaveText(['Due by end of next week', 'Modified before today'])

  // The × clears every date type.
  await page.getByRole('button', { name: 'Clear date filters' }).click()
  await expect(rows(page, 't1')).toHaveCount(4)
  await expect(page.getByRole('button', { name: 'Dates filter', exact: true })).toBeVisible()
})

test('keyboard: Enter opens the panel on Due; arrows move between tabs without writing; Tab enters the body', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [{ title: 'One' }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  await page.getByRole('button', { name: 'Dates filter', exact: true }).focus()
  await page.keyboard.press('Enter')
  const panel = dialog(page)
  await expect(panel.getByRole('tab', { name: 'Due' })).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(panel.getByRole('tab', { name: 'Next follow-up' })).toBeFocused()
  await expect(panel.getByRole('tab', { name: 'Next follow-up' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('tabpanel').getByText('Next follow-up', { exact: true })).toBeVisible()
  // Down: the row below, same column; Up: back.
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByRole('tab', { name: 'Created' })).toBeFocused()
  await expect(panel.getByRole('tabpanel').getByText('Created', { exact: true })).toBeVisible()
  await page.keyboard.press('ArrowUp')
  await expect(panel.getByRole('tab', { name: 'Next follow-up' })).toBeFocused()
  await page.keyboard.press('End')
  await expect(panel.getByRole('tab', { name: 'Modified' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel.getByLabel('From', { exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Dates filter', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('list chips: one per date type; a chip opens the panel under it on its type; its × clears only that type', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seedWorkspace(page, {
    listDefinitions: [
      { name: 'Left' },
      { name: 'Dated', predicate: { dates: { deadline: { match: 'set' }, followup: { match: 'unset' } } } },
    ],
    tasks: [
      { title: 'Due only', dueInDays: 2 },
      { title: 'Due and follow-up', dueInDays: 2, followupInDays: 3 },
      { title: 'Follow-up only', followupInDays: 3 },
      { title: 'Neither' },
    ],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] }] },
      ],
    }],
  })
  const widget = wsListWidget(page, 't2')
  await expect(rows(page, 't2')).toHaveText([/Due only/])
  const chips = widget.getByTestId('list-filter-chip')
  await expect(chips).toHaveText([/Due\s*has a date/, /Next follow-up\s*no date/])

  // The Next follow-up chip (in the right-hand column) opens the panel under it, inside the viewport, on Next follow-up.
  const followupChip = chips.nth(1)
  await followupChip.click()
  const panel = dialog(page)
  await expect(panel.getByRole('tab', { name: 'Next follow-up, filtering' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByRole('radio', { name: 'No date' })).toHaveAttribute('aria-checked', 'true')
  await expect(followupChip).toHaveAttribute('aria-expanded', 'true')
  await expectInsideViewport(page, panel)
  const chipBox = await box(followupChip)
  const panelBox = await box(panel)
  expect(panelBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // × on the Due chip: only the due-date clause goes; the list is unsaved.
  await chips.nth(0).getByRole('button', { name: 'Remove filter' }).click()
  await expect(chips).toHaveText([/Next follow-up\s*no date/])
  await expect(rows(page, 't2')).toHaveText([/Due only/, /Neither/])
  await expect(wsCell(page, 'k2').getByTestId('save-list')).toBeVisible()

  // + Filter › Dates: the panel opens on the first type that filters, focused there.
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  await expect(panel.getByRole('tab', { name: 'Next follow-up, filtering' })).toBeFocused()
  await expect(panel.getByRole('tab', { name: 'Next follow-up, filtering' })).toHaveAttribute('aria-selected', 'true')
})

test('the six types sit in two rows of three at 336px; no label clips, every type lit', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [{ title: 'One' }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
  })
  await lightEveryDateType(page)
  await page.getByRole('button', { name: /^Dates filter/ }).click()
  const panel = dialog(page)
  expect(Math.round((await box(panel)).width)).toBe(336)
  for (const name of ['Due', 'Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified']) {
    await expect(panel.getByRole('tab', { name: `${name}, filtering` })).toHaveAttribute('data-filtering', '')
  }
  await expectTwoRowsUnclipped(panel)
  // Completed is a range only, with its line.
  await panel.getByRole('tab', { name: 'Completed, filtering' }).click()
  await expect(panel.getByRole('radiogroup')).toHaveCount(0)
  await expect(panel.getByText('Shows tasks completed in this range, even where completed tasks are hidden.')).toBeVisible()
})

test('a list with Completed this week shows the tasks completed this week, without Show completed', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [
      { name: 'All' },
      {
        name: 'Done this week',
        sort: 'completed',
        sortDirection: 'desc',
        predicate: { dates: { completed: { match: 'range', start: { kind: 'relative', token: 'start-of-week' }, end: { kind: 'relative', token: 'today' } } } },
      },
    ],
    tasks: [
      { title: 'Open task' },
      { title: 'Done today', completedInDays: 0 },
      { title: 'Done a month ago', completedInDays: -30 },
    ],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] }] },
      ],
    }],
  })
  // Show completed is off: the plain list hides both completed tasks; the Completed range brings in this week's.
  await expect(page.getByRole('button', { name: 'Show completed' })).toHaveAttribute('aria-pressed', 'false')
  await expect(rows(page, 't1')).toHaveText([/Open task/])
  await expect(rows(page, 't2')).toHaveText([/Done today/])
  await expect(wsListWidget(page, 't2').getByTestId('list-filter-chip')).toHaveText([/Completed\s*start of week – today/])

  // The same range in the top bar brings it into every list (the open task fails it).
  await page.getByRole('button', { name: 'Dates filter', exact: true }).click()
  const panel = dialog(page)
  await panel.getByRole('tab', { name: 'Completed' }).click()
  await panel.getByLabel('From (relative)').selectOption('start-of-week')
  await expect(rows(page, 't1')).toHaveText([/Done today/])
  await expect(page.getByRole('button', { name: /^1 of 3 tasks shown/ })).toBeVisible()
})

test('Last follow-up "up to 14 days ago, or none": in a list, and as a lens in the top bar', async ({ page }) => {
  const stale = { match: 'range', start: null, end: { kind: 'offset', days: -14 }, includeNoDate: true }
  await seedWorkspace(page, {
    listDefinitions: [
      { name: 'All' },
      { name: 'Not followed up lately', sort: 'lastFollowup', predicate: { dates: { lastFollowup: stale } } },
    ],
    tasks: [
      { title: 'Chased yesterday', lastFollowupInDays: -1 },
      { title: 'Chased 20 days ago', lastFollowupInDays: -20 },
      { title: 'Chased a month ago', lastFollowupInDays: -30 },
      { title: 'Never chased' },
    ],
    lenses: [{ id: 'lens-stale', name: 'Stale follow-ups', predicate: { dates: { lastFollowup: stale } } }],
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] }] },
      ],
    }],
  })
  await expect(rows(page, 't1')).toHaveCount(4)
  // Oldest first, never followed up last.
  await expect(rows(page, 't2')).toHaveText([/Chased a month ago/, /Chased 20 days ago/, /Never chased/])
  await expect(wsListWidget(page, 't2').getByTestId('list-filter-chip')).toHaveText([/Last follow-up\s*up to 14 days ago, or none/])

  await page.getByRole('button', { name: /^Lens:/ }).click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Stale follow-ups/ }).click()
  await expect(rows(page, 't1')).toHaveText([/Chased 20 days ago/, /Chased a month ago/, /Never chased/])
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Filters sheet’s Dates section: the same panel at touch sizes, the row shows the value', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'All' }],
      tasks: [
        { title: 'Due only', dueInDays: 2 },
        { title: 'Due and follow-up', dueInDays: 2, followupInDays: 3 },
        { title: 'Neither' },
      ],
      layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
    })
    const allRows = page.locator('[data-todo-id]')
    await expect(allRows).toHaveCount(3)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: 'Filters', exact: true }).click()
    const datesRow = page.getByText('Dates', { exact: true })
    await expect(datesRow.locator('..')).toContainText('Any')
    await datesRow.click()

    await page.getByRole('tab', { name: 'Next follow-up' }).click()
    await expect(allRows).toHaveCount(3)
    expect((await box(page.getByRole('tab', { name: 'Next follow-up' }))).height).toBeGreaterThanOrEqual(36)
    const noDate = page.getByRole('radio', { name: 'No date' })
    expect((await box(noDate)).height).toBeGreaterThanOrEqual(36)
    await noDate.click()
    await expect(page.getByText('Only tasks with no follow-up.')).toBeVisible()
    await expect(allRows).toHaveCount(2)
    await expect(datesRow.locator('..')).toContainText('Next follow-up no date')

    await page.getByRole('tab', { name: 'Due' }).click()
    await expect(allRows).toHaveCount(2)
    await page.getByRole('radio', { name: 'Has a date' }).click()
    await expect(allRows).toHaveCount(1)
    await expect(datesRow.locator('..')).toContainText('Due + Next follow-up')

    await page.getByRole('button', { name: 'Clear all dates' }).click()
    await expect(allRows).toHaveCount(3)
    await expect(datesRow.locator('..')).toContainText('Any')
  })
})

test.describe('phone, narrowest', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('the sheet’s six tabs sit in two rows of three at touch size, every label whole with its dot', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'All' }],
      tasks: [{ title: 'One' }],
      layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
    })
    await lightEveryDateType(page)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: /^Filters/ }).click()
    await page.getByText('Dates', { exact: true }).click()
    const tablist = page.getByRole('tablist', { name: 'Date type' })
    await expectTwoRowsUnclipped(tablist)
    expect((await box(tablist.getByRole('tab').first())).height).toBeGreaterThanOrEqual(36)
  })
})
