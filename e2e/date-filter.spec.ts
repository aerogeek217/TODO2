import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_FILTER, closeListFilterEditor, editListSave, openListFilterEditor, seedWorkspace, wsListWidget, wsRow } from './fixtures/workspace'
import { box, expectInsideViewport } from './fixtures/geometry'
import {
  completedChip, dateBody, dateTypeButton, dateTypeItem, dateTypeMenu, filterMenu, filterMenuButton, filterMenuRow, filterPills, openFilterMenu, openFilterPicker,
  pickDateType,
} from './fixtures/filters'

/**
 * The date panel in a real browser: one clause per date type (Due · Planned ·
 * Next follow-up · Last follow-up, then Completed · Created · Modified, in the
 * type button's menu), several at once (all must match), a type lit in the
 * menu while it filters, and picking a type never fills in a date. Opened from the top
 * bar's Filter menu (Dates) or its Dates chip, a list's date chip / + Filter, and the phone Filters
 * sheet. A Completed range brings in the tasks completed in it without Show
 * completed; Last follow-up is an optional date (cr24 P4, D22). Show picks
 * Calendar · Relative (· Any · None on the optional types); a new range is
 * Relative (cr25 P8, D23 board B).
 */

/** A local date-time `days` from now, as the seed takes it (`2026-10-10T15:30`). */
function localDateTime(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** The day `days` from today as a range's tooltip spells it: `Mon 26 Oct` (`… 2027` in another year); a past day `10/26`. */
function dayWords(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const pad = (n: number) => String(n).padStart(2, '0')
  if (days < 0) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
  const base = `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getDate()} ${d.toLocaleDateString('en-US', { month: 'short' })}`
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`
}

/** A day as the line under a Relative end names it: `Thu, Dec 3` (`Thu, Dec 3, 2027` in another year). */
function endDayWords(d: Date): string {
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString('en-US', sameYear ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
}

/** Today + `days` (or `months` calendar months, clamped to the month's end), at local midnight. */
function fromToday(days: number, months = 0): Date {
  const t = new Date()
  const first = new Date(t.getFullYear(), t.getMonth() + months, 1)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return new Date(first.getFullYear(), first.getMonth(), Math.min(t.getDate(), last) + days)
}

function rows(page: Page, tabId: string) {
  return wsListWidget(page, tabId).locator('[data-todo-id]')
}

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Date filters' })

/** Picks `item` (its label) from an end's Relative chevron (the rolling days, No start / No end) in the open date panel. */
async function pickRelative(page: Page, end: 'From' | 'To', item: string) {
  await dialog(page).getByRole('button', { name: `${end}: rolling days` }).click()
  await page.getByRole('menu', { name: `${end}: rolling days` }).locator(`[data-menu-label="${item}"]`).click()
}

/** An end's typed Relative field in the open date panel. */
const relativeEnd = (page: Page, end: 'From' | 'To') => dialog(page).getByRole('textbox', { name: end })

/** Every date type on in the top bar (through the filter store), so every type is lit in the menu. */
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
        planned: { match: 'held' },
        followup: { match: 'set' },
        lastFollowup: { ...range(null, { kind: 'offset', days: -14 }), includeNoDate: true },
        completed: range({ kind: 'relative', token: 'start-of-week' }, null),
        created: range({ kind: 'offset', days: -30 }, null),
        modified: range({ kind: 'offset', days: -30 }, null),
      },
    })
  })
}

/** Show's choices, in one row, none clipped. */
async function expectShowUnclipped(scope: Locator, labels: string[]) {
  const radios = scope.getByRole('radiogroup', { name: 'Which tasks' }).getByRole('radio')
  await expect(radios).toHaveText(labels)
  const tops = await Promise.all(labels.map(async (_, i) => Math.round((await box(radios.nth(i))).y)))
  expect(new Set(tops).size).toBe(1)
  const clipped = await radios.evaluateAll((els) => els.flatMap((el) => (el.scrollWidth > el.clientWidth ? [el.textContent] : [])))
  expect(clipped).toEqual([])
}

const TYPES = ['Due', 'Planned', 'Next follow-up', 'Last follow-up', 'Completed', 'Created', 'Modified']

/**
 * The type menu (opened from the button in `scope`, closed again with Esc):
 * the seven types in order, one separator before the record, each lit with
 * its clause; under the button and as wide, no name cut, items at least
 * `minItemHeight` tall.
 */
async function expectTypeMenuUnclipped(page: Page, scope: Locator, minItemHeight: number) {
  const button = dateTypeButton(scope)
  await button.click()
  const menu = dateTypeMenu(page)
  const items = menu.getByRole('menuitemradio')
  await expect(items).toHaveCount(TYPES.length)
  expect(await items.evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.menuLabel))).toEqual(TYPES)
  const order = await menu.evaluate((el) => Array.from(el.children).map((c) => (c.getAttribute('role') === 'separator' ? '-' : (c as HTMLElement).dataset.menuLabel)))
  expect(order).toEqual([...TYPES.slice(0, 4), '-', ...TYPES.slice(4)])
  for (const name of TYPES) await expect(dateTypeItem(page, name)).toHaveAccessibleName(new RegExp(`^${name}\\s*,\\s*\\S`))
  const clipped = await items.evaluateAll((els) => els.flatMap((el) => {
    const label = Array.from(el.querySelectorAll('span')).find((sp) => sp.textContent === (el as HTMLElement).dataset.menuLabel)
    return !label || label.scrollWidth > label.clientWidth ? [el.textContent] : []
  }))
  expect(clipped).toEqual([])
  const buttonBox = await box(button)
  const menuBox = await box(menu)
  expect(menuBox.y).toBeGreaterThanOrEqual(buttonBox.y + buttonBox.height)
  expect(Math.round(menuBox.width)).toBe(Math.round(buttonBox.width))
  expect((await box(items.first())).height).toBeGreaterThanOrEqual(minItemHeight)
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(button).toBeFocused()
}

test('top bar: Due then Modified filter the screen together; switching types fills in nothing', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [
      { title: 'Due soon, old', dueInDays: 2, modifiedAt: localDateTime(-10) },
      { title: 'Due soon, fresh', dueInDays: 2 },
      { title: 'Due later, old', dueInDays: 30, modifiedAt: localDateTime(-10) },
      { title: 'Undated' },
    ],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  await expect(rows(page, 't1')).toHaveCount(4)

  await openFilterPicker(page, 'Dates')
  const panel = dialog(page)
  await expect(dateTypeButton(panel)).toBeFocused()
  await expect(dateTypeButton(panel)).toHaveAccessibleName('Date type: Due')
  await expect(panel.getByText('Not filtering')).toBeVisible()
  await expect(panel.getByRole('radio', { name: 'Relative' })).toHaveAttribute('aria-checked', 'true')
  await relativeEnd(page, 'To').fill('+2w')
  await expect(relativeEnd(page, 'To')).toHaveValue('+2w')
  // Its day today under it (cr25 P8; typed intervals: `Thu, Dec 3`).
  await expect(panel.getByText(`${endDayWords(fromToday(14))} and earlier`)).toBeVisible()
  await expect(rows(page, 't1')).toHaveCount(2)
  await expect(dateTypeButton(panel)).toHaveAccessibleName('Date type: Due, filtering')
  await expect(dateTypeButton(panel)).toContainText('1 filtering')

  // Modified: nothing filled in, nothing lit, nothing narrowed — until its own To is set.
  await pickDateType(page, panel, 'Modified')
  await expect(dateTypeButton(panel)).toHaveAccessibleName('Date type: Modified')
  await expect(relativeEnd(page, 'From')).toHaveValue('')
  await expect(relativeEnd(page, 'To')).toHaveValue('')
  await expect(rows(page, 't1')).toHaveCount(2)
  await relativeEnd(page, 'To').fill('-7d')
  await expect(rows(page, 't1')).toHaveCount(1)
  await expect(rows(page, 't1')).toHaveText([/Due soon, old/])
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(filterMenu(page)).toHaveCount(0)

  // The field's pills: a term per date type; the menu's row reads both names.
  await expect(filterPills(page)).toHaveText([/^due <= \+2w/, /^modified <= -7d/])
  await openFilterMenu(page)
  const row = filterMenuRow(page, 'Dates')
  await expect(row).toHaveAccessibleName('Dates filter: Due in 2 weeks or earlier; Modified 7+ days ago')
  await expect(row).toContainText('Due + Modified')
  // A list's line doesn't repeat the top bar's filters (J13): its count says they narrow it.
  await expect(wsListWidget(page, 't1').getByTestId('list-filter-row')).not.toContainText('Modified')
  await expect(wsListWidget(page, 't1').getByTestId('list-count')).toHaveText('1 of 4')

  // The row's × clears every date type.
  await filterMenu(page).getByRole('button', { name: 'Clear date filters' }).click()
  await expect(rows(page, 't1')).toHaveCount(4)
  await expect(filterPills(page)).toHaveCount(0)
})

test('keyboard: Enter opens the panel on Due; the type menu by keyboard writes nothing; Tab enters the body', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [{ title: 'One' }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  // The Filter button opens its menu on its first row (no people, tags or statuses here: Priority, then Dates).
  await filterMenuButton(page).focus()
  await page.keyboard.press('Enter')
  await expect(filterMenuRow(page, 'Priority')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(filterMenuRow(page, 'Dates')).toBeFocused()
  await page.keyboard.press('Enter')
  const panel = dialog(page)
  const typeButton = dateTypeButton(panel)
  await expect(typeButton).toBeFocused()
  await expect(typeButton).toHaveAccessibleName('Date type: Due')
  // Down opens the type menu on the selected type; the arrows move; Enter picks and the focus is back on the button.
  await page.keyboard.press('ArrowDown')
  await expect(dateTypeItem(page, 'Due')).toBeFocused()
  await expect(dateTypeItem(page, 'Due')).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(dateTypeItem(page, 'Planned')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(dateTypeItem(page, 'Next follow-up')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dateTypeMenu(page)).toBeHidden()
  await expect(typeButton).toBeFocused()
  await expect(typeButton).toHaveAccessibleName('Date type: Next follow-up')
  await expect(dateBody(panel).getByText('Next follow-up', { exact: true })).toBeVisible()
  // Space opens it again; Esc closes only the menu, back on the button.
  await page.keyboard.press('Space')
  await expect(dateTypeItem(page, 'Next follow-up')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dateTypeMenu(page)).toBeHidden()
  await expect(panel).toBeVisible()
  await expect(typeButton).toBeFocused()
  // Enter opens it; End, Enter: Modified.
  await page.keyboard.press('Enter')
  await page.keyboard.press('End')
  await expect(dateTypeItem(page, 'Modified')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(typeButton).toHaveAccessibleName('Date type: Modified')
  await expect(dateBody(panel).getByText('Modified', { exact: true })).toBeVisible()
  // Tab: Show (its checked Relative), the range's Is / Is not (its checked Is), then From's field.
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('radiogroup', { name: 'Which tasks' }).getByRole('radio', { name: 'Relative' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('radiogroup', { name: 'Modified: is or is not' }).getByRole('radio', { name: 'Is', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(relativeEnd(page, 'From')).toBeFocused()
  // Nothing written so far.
  await expect(filterMenuRow(page, 'Dates')).toHaveAccessibleName('Dates filter')
  await expect(filterPills(page)).toHaveCount(0)
  // Typed: written once it reads — a calendar month back; text on its way writes nothing.
  await page.keyboard.type('-1')
  await expect(filterPills(page)).toHaveCount(0)
  await page.keyboard.type('m')
  await expect(dateBody(panel)).toContainText('1 month ago or later')
  await expect(panel.getByText(`${endDayWords(fromToday(0, -1))} and later`)).toBeVisible()
  await expect(filterMenuRow(page, 'Dates')).toHaveAccessibleName('Dates filter: Modified 1 month ago or later')
  // The chevron next: its menu by keyboard keeps the rolling days; Esc closes only the menu.
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'From: rolling days' })).toBeFocused()
  await page.keyboard.press('Enter')
  const menu = page.getByRole('menu', { name: 'From: rolling days' })
  await expect(menu.getByRole('menuitemradio', { name: 'today' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'From: rolling days' })).toBeFocused()
  // Text that doesn't read: nothing written, its hint once the field is left.
  await relativeEnd(page, 'From').fill('2 weeks')
  await relativeEnd(page, 'From').press('Enter')
  await expect(panel.getByRole('alert')).toHaveText('Type +2w, -1m, +3d or today, or pick a rolling day')
  await expect(filterMenuRow(page, 'Dates')).toHaveAccessibleName('Dates filter: Modified 1 month ago or later')
  // Esc puts the end back (and leaves the panel open); the next Esc closes it.
  await relativeEnd(page, 'From').press('Escape')
  await expect(relativeEnd(page, 'From')).toHaveValue('-1m')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
})

test('a saved Calendar date emptied from the keyboard keeps Calendar and the focus in its date input', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [{ title: 'One' }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  // A saved Due on or before a date a week ahead (its local midnight, as a typed date stores it).
  const month = await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
      useFilterStore: { getState: () => { filters: Record<string, unknown>; setAllFilters: (f: Record<string, unknown>) => void } }
    }
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() + 7)
    const st = mod.useFilterStore.getState()
    st.setAllFilters({ ...st.filters, dates: { deadline: { match: 'range', start: null, end: { kind: 'fixed', iso: d.toISOString() } } } })
    return d.getMonth() + 1
  })
  await openFilterMenu(page)
  await expect(filterMenuRow(page, 'Dates')).toHaveAccessibleName(/^Dates filter: Due on or before /)
  await filterMenuRow(page, 'Dates').click()
  const panel = dialog(page)
  const calendar = panel.getByRole('radiogroup', { name: 'Which tasks' }).getByRole('radio', { name: 'Calendar' })
  await expect(calendar).toHaveAttribute('aria-checked', 'true')
  const to = panel.getByLabel('To', { exact: true })
  const saved = await to.inputValue()
  // Backspace empties the focused part (the month): no date, so no clause — but the input stays, focused.
  await to.focus()
  await page.keyboard.press('Backspace')
  await expect(panel.getByText('Not filtering')).toBeVisible()
  await expect(calendar).toHaveAttribute('aria-checked', 'true')
  await expect(to).toBeFocused()
  // Typing the month back completes the date again.
  await page.keyboard.type(String(month).padStart(2, '0'))
  await expect(to).toHaveValue(saved)
  await expect(dateBody(panel)).toContainText('on or before')
  await expect(to).toBeFocused()
})

test('Edit list’s chips: one per date type; a chip opens the panel under it on its type; its × clears only that type', async ({ page }) => {
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
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] })] },
      ],
    }],
  })
  const widget = wsListWidget(page, 't2')
  await expect(rows(page, 't2')).toHaveText([/Due only/])
  // The line reads the filter in words; its chips are Edit list's (2A).
  await expect(widget.getByTestId('list-filter-chip')).toHaveCount(0)
  const editor = await openListFilterEditor(page, widget)
  const chips = editor.getByTestId('list-filter-chip')
  await expect(chips).toHaveText([/Due\s*any date/, /Next follow-up\s*none/])

  // The Next follow-up chip (in the right-hand column) opens the panel under it, inside the viewport, on Next follow-up.
  const followupChip = chips.nth(1)
  await followupChip.click()
  const panel = dialog(page)
  await expect(dateTypeButton(panel)).toHaveAccessibleName('Date type: Next follow-up, filtering')
  await expect(panel.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')
  // The chip's own button says it is open (its × is a sibling button, cr31 F9).
  await expect(followupChip.getByRole('button', { name: /Next follow-up/ })).toHaveAttribute('aria-expanded', 'true')
  await expectInsideViewport(page, panel)
  const chipBox = await box(followupChip)
  const panelBox = await box(panel)
  expect(panelBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height)
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()

  // × on the Due chip: only the due-date clause goes; Edit list can save it.
  await chips.nth(0).getByRole('button', { name: 'Remove filter' }).click()
  await expect(chips).toHaveText([/Next follow-up\s*none/])
  await expect(rows(page, 't2')).toHaveText([/Due only/, /Neither/])
  await expect(editListSave(page)).toBeEnabled()

  // + Filter › Dates: the panel opens on the first type that doesn't filter
  // yet (cr25 P4b) — Due, before Next follow-up —, focused there, so it adds a chip.
  await editor.getByRole('button', { name: ADD_FILTER }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  await expect(dateTypeButton(panel)).toBeFocused()
  await expect(dateTypeButton(panel)).toHaveAccessibleName('Date type: Due')
  await panel.getByRole('radio', { name: 'None' }).click()
  // A new chip goes last (the rows keep the order they were added in).
  await expect(chips).toHaveText([/Next follow-up\s*none/, /Due\s*none/])
})

test('the type menu at 336px: the seven types, every one lit with its clause; no name clips', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'All' }],
    tasks: [{ title: 'One' }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
  })
  await lightEveryDateType(page)
  await openFilterPicker(page, 'Dates')
  const panel = dialog(page)
  expect(Math.round((await box(panel)).width)).toBe(336)
  await expect(dateTypeButton(panel)).toHaveAccessibleName('Date type: Due, filtering')
  await expect(dateTypeButton(panel)).toContainText('7 filtering')
  await expectTypeMenuUnclipped(page, panel, 28)
  // Show's four choices fit its row (cr25 P8).
  await expectShowUnclipped(panel, ['Calendar', 'Relative', 'Any', 'None'])
  // Planned held: None, its box ticked.
  await pickDateType(page, panel, 'Planned')
  await expect(panel.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByRole('checkbox', { name: 'Only tasks held in Unplanned' })).toBeChecked()
  await expect(dateBody(panel)).toContainText('held in Unplanned')
  // Completed is a range only (Calendar · Relative, no Is not), with its line.
  await pickDateType(page, panel, 'Completed')
  await expect(panel.getByRole('radiogroup')).toHaveCount(1)
  await expectShowUnclipped(panel, ['Calendar', 'Relative'])
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
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] })] },
      ],
    }],
  })
  // Show completed is off: the plain list hides both completed tasks; the Completed range brings in this week's.
  await expect(completedChip(page)).toHaveCount(0)
  await expect(rows(page, 't1')).toHaveText([/Open task/])
  await expect(rows(page, 't2')).toHaveText([/Done today/])
  // Its line reads the range in words.
  await expect(wsListWidget(page, 't2').getByTestId('list-filter-expression')).toContainText(/completed/i)

  // The same range in the top bar brings it into every list (the open task fails it).
  await openFilterPicker(page, 'Dates')
  const panel = dialog(page)
  await pickDateType(page, panel, 'Completed')
  await pickRelative(page, 'From', 'start of week')
  await expect(rows(page, 't1')).toHaveText([/Done today/])
  // The counter's total: the open task and the completed one the range admits, not the month-old one.
  await expect(page.getByRole('button', { name: /^1 of 2 tasks shown/ })).toBeVisible()
})

test('Last follow-up "14+ days ago, or never" in a list', async ({ page }) => {
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
    layouts: [{
      name: 'Main',
      columns: [
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] })] },
      ],
    }],
  })
  await expect(rows(page, 't1')).toHaveCount(4)
  // Oldest first, never followed up last.
  await expect(rows(page, 't2')).toHaveText([/Chased a month ago/, /Chased 20 days ago/, /Never chased/])
  // Its chip (in Edit list, opened from the line's words, 2A).
  const editor = await openListFilterEditor(page, wsListWidget(page, 't2'))
  const chip = editor.getByTestId('list-filter-chip')
  await expect(chip).toHaveText([/Last follow-up\s*14\+ days ago, or never/])
  // Its tooltip spells the exact last day, and the never-followed-up tasks it keeps (cr25 P7).
  await chip.hover()
  await expect(page.getByRole('tooltip')).toHaveText(`Last follow-up: 14+ days ago, or neverLast followed up on or before ${dayWords(-14)}, or never`)
  await page.mouse.move(0, 0)
  await closeListFilterEditor(page)
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
      layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
    })
    const allRows = page.locator('[data-todo-id]')
    await expect(allRows).toHaveCount(3)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Filters', exact: true }).click()
    const datesRow = page.getByText('Dates', { exact: true })
    // Off: no value (not `Any` — Show's Any means "has the date").
    await expect(datesRow.locator('..')).toHaveText(/^Dates\s*▸$/)
    await datesRow.click()

    const sheet = page.getByRole('dialog', { name: 'Filters' })
    expect((await box(dateTypeButton(sheet))).height).toBeGreaterThanOrEqual(44)
    await pickDateType(page, sheet, 'Next follow-up')
    await expect(allRows).toHaveCount(3)
    const noDate = page.getByRole('radio', { name: 'None' })
    expect((await box(noDate)).height).toBeGreaterThanOrEqual(36)
    await noDate.click()
    await expect(page.getByText('Only tasks with no next follow-up.')).toBeVisible()
    await expect(allRows).toHaveCount(2)
    await expect(datesRow.locator('..')).toContainText('Next follow-up none')

    await pickDateType(page, sheet, 'Due')
    await expect(allRows).toHaveCount(2)
    await page.getByRole('radio', { name: 'Any' }).click()
    await expect(allRows).toHaveCount(1)
    await expect(datesRow.locator('..')).toContainText('Due + Next follow-up')

    await page.getByRole('button', { name: 'Clear all dates' }).click()
    await expect(allRows).toHaveCount(3)
    await expect(datesRow.locator('..')).toHaveText(/^Dates\s*▸$/)
  })
})

test.describe('phone, narrowest', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('the sheet’s type button and menu at touch size, every name whole with its clause', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'All' }],
      tasks: [{ title: 'One' }],
      layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] }],
    })
    await lightEveryDateType(page)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: /^Filters/ }).click()
    await page.getByText('Dates', { exact: true }).click()
    const filters = page.getByRole('dialog', { name: 'Filters' })
    await expect(dateTypeButton(filters)).toHaveAccessibleName('Date type: Due, filtering')
    expect((await box(dateTypeButton(filters))).height).toBeGreaterThanOrEqual(44)
    await expectTypeMenuUnclipped(page, filters, 44)
    // Show's four choices fit the sheet's 343px at touch size (cr25 P8).
    const sheet = page.getByRole('radiogroup', { name: 'Which tasks' }).locator('..')
    await expectShowUnclipped(sheet, ['Calendar', 'Relative', 'Any', 'None'])
    expect((await box(page.getByRole('radio', { name: 'Calendar' }))).height).toBeGreaterThanOrEqual(36)
    // The Relative ends at touch size, on Last follow-up (14+ days ago).
    await pickDateType(page, filters, 'Last follow-up')
    const to = page.getByRole('textbox', { name: 'To' })
    await to.scrollIntoViewIfNeeded()
    expect((await box(to)).height).toBeGreaterThanOrEqual(44)
    await expect(to).toHaveValue('-14d')
    await expect(page.getByText(`${endDayWords(fromToday(-14))} and earlier`)).toBeVisible()
    await expectInsideViewport(page, to)
    await expectInsideViewport(page, page.getByRole('button', { name: 'To: rolling days' }))
  })
})
