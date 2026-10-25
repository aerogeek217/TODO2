import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, withSpareLayouts, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'

/**
 * The screen filter's tasks. Desktop: the top bar's Show N tasks (while a
 * filter is on) and the palette drop the filtered-tasks panel from the
 * filter tray, joined to it; the tray stays the filter's editor (its
 * pickers open above the panel and take the first Esc; a change re-resolves
 * the rows and the workspace behind follows). Opening it changes nothing in
 * the bar's layout: over folded filters the tray expands in place to show
 * every filter button (rightwards over the free space and the right zone,
 * shrunk, then slid left only as far as the window needs). A scrim dims and blurs the
 * workspace and a press on it closes the panel. On a phone the Filters
 * sheet ends with the button and the task dialog's Filters edit the filter.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  tags: ['q4'],
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Ann plan', people: ['Ann'], tags: ['q4'] },
    { title: 'Ann call', people: ['Ann'] },
    { title: 'Bob task', people: ['Bob'], tags: ['q4'] },
    { title: 'Nobody task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const ALL = ['Ann plan', 'Ann call', 'Bob task', 'Nobody task']
const workspaceTitles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const panel = (page: Page) => page.locator('[data-filter-panel]')
const panelTitles = (page: Page) => rowTitles(panel(page))
const dialog = (page: Page) => page.locator('[data-task-dialog]')
const header = (page: Page) => page.locator('header')
const tray = (page: Page) => header(page).getByRole('group', { name: 'Screen filters — apply to every widget' })
const showTasks = (page: Page) => tray(page).getByRole('button', { name: /^\d+ of \d+ (open )?tasks shown\. Show them$/ })

/** Whether the element on top at `locator`'s centre is inside it (nothing covers it). */
async function onTop(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit != null && el.contains(hit)
  })
}

/** The top bar on one line: its height, its overflow and how many of its controls lie outside it. */
const fit = (page: Page) => header(page).evaluate((bar) => {
  const box = bar.getBoundingClientRect()
  const parts = [...bar.querySelectorAll('button, input')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
  return {
    height: box.height,
    overflow: bar.scrollWidth - bar.clientWidth,
    outside: parts.filter((r) => r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5).length,
  }
})
const ONE_LINE = { height: 40, overflow: 0, outside: 0 }

/** The panel's top and left edges against the tray's bottom and left, and its room to the window's right, px. */
const joint = (page: Page) => page.evaluate(() => {
  const t = document.querySelector('header [data-filter-row]')!.getBoundingClientRect()
  const p = document.querySelector('[data-filter-panel]')!.getBoundingClientRect()
  return { top: Math.round(p.top - t.bottom), left: Math.round(p.left - t.left), right: Math.round(window.innerWidth - p.right) }
})

const filtersMenu = (page: Page) => tray(page).getByRole('button', { name: /^Filters/ })
const FILTER_BUTTONS = ['Priority filter', 'Tags filter', /^People filter/, 'Dates filter', 'Status filter']

/** Ticks `option` in a filter's picker, from its button or (folded) the Filters menu. */
async function pickFilter(page: Page, field: 'People' | 'Tags', option: string) {
  const name = new RegExp(`^${field} filter`)
  if (await filtersMenu(page).isVisible()) {
    await filtersMenu(page).click()
    await page.getByRole('group', { name: 'Screen filters' }).getByRole('button', { name }).click()
    await page.getByRole('option', { name: option }).click()
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
  } else {
    await tray(page).getByRole('button', { name }).click()
    await page.getByRole('option', { name: option }).click()
    await page.keyboard.press('Escape')
  }
}

/** The People filter on Ann. */
async function filterToAnn(page: Page) {
  await pickFilter(page, 'People', '@Ann')
  await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan', 'Ann call'])
}

/** What the bar shows and where: its fold, the tray's edges, the right zone's left edge, how many layout tabs. */
const bar = (page: Page) => header(page).evaluate((el) => {
  const t = el.querySelector('[data-filter-row]')!.getBoundingClientRect()
  const spring = el.querySelector('[data-fold-part="spring"]')!.getBoundingClientRect()
  return {
    fold: el.dataset.fold,
    trayLeft: Math.round(t.left),
    trayRight: Math.round(t.right),
    springLeft: Math.round(spring.left),
    tabs: el.querySelectorAll('[data-testid="layout-tab"]').length,
  }
})

/** Every filter button shown in the tray (none in a Filters menu). */
async function expectEveryFilterButton(page: Page) {
  await expect(filtersMenu(page)).toHaveCount(0)
  for (const name of FILTER_BUTTONS) {
    await expect(tray(page).getByRole('button', { name, exact: typeof name === 'string' })).toBeVisible()
  }
}

test.describe('desktop', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Show N tasks drops the panel joined to the tray; with everything fitting nothing in the bar moves', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 800 })
    await seedWorkspace(page, withSpareLayouts(SEED, 1))
    await expect.poll(() => workspaceTitles(page)).toEqual(ALL)
    await expect(showTasks(page)).toHaveCount(0)
    await filterToAnn(page)
    await expectEveryFilterButton(page)
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    const closed = await bar(page)
    expect(closed).toMatchObject({ fold: 'none', tabs: 2 })

    const show = tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' })
    await show.hover()
    await expect(page.getByRole('tooltip')).toContainText('2 of 4 open tasks shown')
    await show.click()
    await expect(panel(page)).toBeVisible()
    await expect(show).toHaveAttribute('aria-expanded', 'true')
    await expect(panel(page)).toBeFocused()
    await expect(panel(page).getByRole('heading')).toHaveText('Filtered tasks')
    await expect(panel(page).getByTestId('task-dialog-count')).toHaveText('2')
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan', 'Ann call'])
    // Open: the bar exactly as it was — the tabs, the tray where it was, every filter button.
    expect(await bar(page)).toEqual(closed)
    await expect(header(page).locator('[data-expanded]')).toHaveCount(0)
    await expectEveryFilterButton(page)
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    // Joined: its top on the tray's bottom border, its left on the tray's left.
    await expect.poll(() => joint(page)).toMatchObject({ top: -1, left: 0 })
    expect((await joint(page)).right).toBeGreaterThanOrEqual(16)
    // No task dialog: the panel is the list.
    await expect(dialog(page)).toHaveCount(0)

    await show.click()
    await expect(panel(page)).toHaveCount(0)
    expect(await bar(page)).toEqual(closed)
  })

  test('over folded filters the tray expands in place, rightwards over the right zone; closing folds them back — every time', async ({ page }) => {
    await page.setViewportSize({ width: 1305, height: 800 })
    await seedWorkspace(page, withSpareLayouts(SEED, 1))
    await filterToAnn(page)
    // Closed: the layouts as tabs, the filters folded to fit beside them.
    await expect(filtersMenu(page)).toBeVisible()
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    const closed = await bar(page)
    expect(closed).toMatchObject({ fold: 'filters', tabs: 2 })

    const show = tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' })
    for (const close of ['scrim', 'toggle', 'escape', 'scrim'] as const) {
      await show.click()
      await expect(panel(page)).toBeVisible()
      // Expanded: the same left edge, every filter button, over the right zone; the tabs stay.
      await expectEveryFilterButton(page)
      const open = await bar(page)
      expect(open).toMatchObject({ fold: 'filters', trayLeft: closed.trayLeft, springLeft: closed.springLeft, tabs: 2 })
      expect(open.trayRight).toBeGreaterThan(closed.springLeft)
      // The right zone under it: a press there is the tray's.
      expect(await header(page).evaluate((el, x) => {
        const hit = document.elementFromPoint(x, 20)
        return hit != null && el.querySelector('[data-filter-row]')!.contains(hit)
      }, closed.springLeft + 4)).toBe(true)
      await expect.poll(() => joint(page)).toMatchObject({ top: -1, left: 0 })
      await expect.poll(() => fit(page)).toEqual(ONE_LINE)

      if (close === 'scrim') await page.mouse.click(640, 700)
      else if (close === 'toggle') await show.click()
      else await page.keyboard.press('Escape')
      await expect(panel(page)).toHaveCount(0)
      await expect(filtersMenu(page)).toBeVisible()
      expect(await bar(page)).toEqual(closed)
      await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    }
  })

  test('a filter changed in the expanded tray: on close the bar folds as it would for the new filter', async ({ page }) => {
    await page.setViewportSize({ width: 1335, height: 800 })
    await seedWorkspace(page, withSpareLayouts(SEED, 1))
    // No filter: every button fits beside the tabs.
    await expectEveryFilterButton(page)
    await filterToAnn(page)
    await expect(filtersMenu(page)).toBeVisible()

    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expectEveryFilterButton(page)
    await pickFilter(page, 'People', '@Bob')
    await pickFilter(page, 'Tags', '#q4')
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan', 'Bob task'])
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    const after = await bar(page)

    // The same filter set without the panel, from a fresh load.
    await page.reload()
    await expect.poll(() => workspaceTitles(page)).toEqual(ALL)
    await pickFilter(page, 'People', '@Ann')
    await pickFilter(page, 'People', '@Bob')
    await pickFilter(page, 'Tags', '#q4')
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan', 'Bob task'])
    await expect.poll(() => bar(page)).toEqual(after)

    // Cleared in the expanded tray: on close every button is back.
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expect(panel(page)).toBeVisible()
    await tray(page).getByRole('button', { name: 'Clear all filters' }).click()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expectEveryFilterButton(page)
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
  })

  test('a filter set and cleared without the panel: the filters fold, then unfold again', async ({ page }) => {
    await page.setViewportSize({ width: 1335, height: 800 })
    await seedWorkspace(page, withSpareLayouts(SEED, 1))
    await expectEveryFilterButton(page)
    const none = await bar(page)
    await filterToAnn(page)
    await expect(filtersMenu(page)).toBeVisible()
    await tray(page).getByRole('button', { name: 'Clear all filters' }).click()
    await expectEveryFilterButton(page)
    await expect.poll(() => bar(page)).toEqual(none)
  })

  test('a filter picker from the tray opens above the panel and edits its rows and the workspace; Esc closes the picker, then the panel', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await filterToAnn(page)
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan', 'Ann call'])

    await tray(page).getByRole('button', { name: 'Tags filter' }).click()
    const q4 = page.getByRole('option', { name: '#q4' })
    await expect(q4).toBeVisible()
    expect(await onTop(q4)).toBe(true)
    await q4.click()
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan'])
    await expect(panel(page).getByTestId('task-dialog-count')).toHaveText('1')
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan'])

    // Esc: the picker first, the panel stays; then the panel, the focus back on Show N tasks.
    await page.keyboard.press('Escape')
    await expect(q4).toBeHidden()
    await expect(panel(page)).toBeVisible()
    await expect(tray(page).getByRole('button', { name: 'Tags filter: q4' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
    await expect(tray(page).getByRole('button', { name: '1 of 4 open tasks shown. Show them' })).toBeFocused()
  })

  test('the Dates and Priority pickers open above the panel and take the first Esc too', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await tray(page).getByRole('button', { name: 'Show completed' }).click()
    await tray(page).getByRole('button', { name: '4 of 4 tasks shown. Show them' }).click()
    await expect(panel(page)).toBeVisible()
    for (const name of ['Dates filter', 'Priority filter']) {
      const button = tray(page).getByRole('button', { name, exact: true })
      await button.click()
      await expect(button).toHaveAttribute('aria-expanded', 'true')
      const picker = name === 'Dates filter'
        ? page.getByRole('dialog', { name: 'Date filters' })
        : page.getByRole('group', { name: 'Priority', exact: true })
      await expect(picker).toBeVisible()
      expect(await onTop(picker)).toBe(true)
      await page.keyboard.press('Escape')
      await expect(button).toHaveAttribute('aria-expanded', 'false')
      await expect(panel(page)).toBeVisible()
    }
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
  })

  test('a row opens the editor above the panel; Esc closes the editor, then the panel', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await filterToAnn(page)
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await panel(page).locator('[data-todo-id]').filter({ hasText: 'Ann call' }).locator('[data-task-title]').click()
    const editor = page.getByRole('dialog', { name: 'Edit task' })
    await expect(editor).toBeVisible()
    expect(await onTop(editor.getByRole('button', { name: 'Done' }))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(editor).toHaveCount(0)
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
  })

  test('the scrim dims and blurs the workspace below the top bar; a press on it, or on the bar outside the tray, closes the panel', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await filterToAnn(page)
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    const scrim = page.locator('[data-filter-panel-scrim]')
    await expect(scrim).toBeVisible()
    // It covers the workspace, not the top bar, and blurs it as a modal's backdrop does.
    expect(await scrim.evaluate((el) => el.getBoundingClientRect().top)).toBe(40)
    expect(await scrim.evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/^blur\(\d+(\.\d+)?px\)$/)
    expect(await onTop(tray(page).getByRole('button', { name: 'Show completed' }))).toBe(true)
    expect(await onTop(wsListWidget(page, 't1'))).toBe(false)
    await page.mouse.click(640, 700)
    await expect(panel(page)).toHaveCount(0)
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan', 'Ann call'])

    // The gear: closes the panel, then opens Settings.
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expect(panel(page)).toBeVisible()
    await header(page).getByRole('button', { name: 'Settings' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible()
  })

  test('Clear all keeps it open on every open task; rows stay fixed between filter changes; the search narrows them with no dropdown', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const search = tray(page).getByRole('textbox', { name: 'Search tasks' })
    await search.fill('ann')
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan', 'Ann call'])

    // Completed here: the row stays, struck through.
    const call = panel(page).locator('[data-todo-id]').filter({ hasText: 'Ann call' })
    await call.getByRole('checkbox', { name: 'Mark complete' }).click()
    await expect(call.getByRole('checkbox', { name: 'Mark incomplete' })).toBeChecked()
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan', 'Ann call'])
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan'])

    // Typing in the tray's search narrows the rows; no results dropdown over the panel.
    await search.fill('ann pl')
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan'])
    await expect(page.locator('#search-results')).toHaveCount(0)

    await tray(page).getByRole('button', { name: 'Clear all filters' }).click()
    await expect(panel(page)).toBeVisible()
    await expect.poll(() => panelTitles(page)).toEqual(['Ann plan', 'Bob task', 'Nobody task'])
    await expect(search).toHaveValue('')
    await expect(panel(page)).toContainText('Every open task: no screen filter is on.')
    await expect.poll(() => workspaceTitles(page)).toEqual(['Ann plan', 'Bob task', 'Nobody task'])
    // The toggle stays while it is open; closed with no filter, it goes.
    await expect(tray(page).getByRole('button', { name: '3 of 3 open tasks shown. Show them' })).toHaveAttribute('aria-expanded', 'true')
    await panel(page).getByRole('button', { name: /^Close\s*Esc$/ }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(showTasks(page)).toHaveCount(0)
  })

  test('the palette’s Show Tasks Matching the Filter opens it (with no filter, every open task)', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await page.keyboard.press('ControlOrMeta+k')
    await page.getByRole('combobox').fill('matching the filter')
    const option = page.getByRole('option', { name: /Show Tasks Matching the Filter/ })
    await expect(option).toContainText('4 tasks')
    await option.click()
    await expect(panel(page)).toBeVisible()
    await expect(panel(page)).toBeFocused()
    await expect.poll(() => panelTitles(page)).toEqual(ALL)
    await expect(tray(page).getByRole('button', { name: '4 of 4 open tasks shown. Show them' })).toHaveAttribute('aria-expanded', 'true')
  })

  test('where the expanded tray would cross the window’s right gutter it shrinks, then slides left by just what still crosses, over the layout tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await seedWorkspace(page, withSpareLayouts(SEED, 1))
    await filterToAnn(page)
    const closed = await bar(page)
    expect(closed.fold).not.toBe('none')
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expect(panel(page)).toBeVisible()
    await expectEveryFilterButton(page)
    const open = await bar(page)
    // Shrunk first (the search as narrow as it goes), then its right edge on
    // the gutter, its left moved by the overflow only; nothing else moved.
    expect(await header(page).locator('[data-fold-search]').evaluate((el) => el.getBoundingClientRect().width)).toBe(110)
    expect(Math.abs(open.trayRight - (1000 - 16))).toBeLessThanOrEqual(1)
    expect(open.trayLeft).toBeLessThan(closed.trayLeft)
    expect(open).toMatchObject({ fold: closed.fold, springLeft: closed.springLeft, tabs: closed.tabs })
    expect((await joint(page)).left).toBe(0)
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    // A resize while open places it again (here: room enough, the bar unfolds as it would closed).
    await page.setViewportSize({ width: 1600, height: 800 })
    await expect.poll(async () => (await bar(page)).fold).toBe('none')
    await expect(header(page).locator('[data-expanded]')).toHaveCount(0)
    await expect.poll(() => joint(page)).toMatchObject({ top: -1, left: 0 })
    await page.keyboard.press('Escape')
    await expect(panel(page)).toHaveCount(0)
  })

  test('too narrow for every filter button even across the window, they stay folded and the panel still fits', async ({ page }) => {
    await page.setViewportSize({ width: 780, height: 800 })
    await seedWorkspace(page, withSpareLayouts(SEED))
    await filterToAnn(page)
    const closed = await bar(page)
    await tray(page).getByRole('button', { name: '2 of 4 open tasks shown. Show them' }).click()
    await expect(panel(page)).toBeVisible()
    await expect(filtersMenu(page)).toBeVisible()
    expect(await bar(page)).toEqual(closed)
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    const j = await joint(page)
    expect(j.top).toBe(-1)
    expect(j.right).toBeGreaterThanOrEqual(16)
    expect(await panel(page).evaluate((el) => el.getBoundingClientRect().left)).toBeGreaterThanOrEqual(16)
  })

  test('without a filter Show N tasks isn’t there and the room comes back', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await tray(page).getByRole('button', { name: 'Show completed' }).click()
    await expect(tray(page).getByRole('button', { name: '4 of 4 tasks shown. Show them' })).toBeVisible()
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
    await tray(page).getByRole('button', { name: 'Clear all filters' }).click()
    await expect(showTasks(page)).toHaveCount(0)
    await expect(tray(page).getByRole('button', { name: 'Status filter', exact: true })).toBeVisible()
    await expect.poll(() => fit(page)).toEqual(ONE_LINE)
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Filters sheet ends with Show N tasks; the dialog’s Filters edit the screen filter', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const rows = page.locator('[data-ws-area] [data-todo-id]')
    await expect(rows).toHaveCount(4)
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('tab', { name: 'Filters', exact: true }).click()
    await expect(page.getByRole('button', { name: /^Show \d+ tasks?$/ })).toHaveCount(0)
    await page.getByPlaceholder('Search tasks...').fill('ann')
    await page.getByRole('button', { name: 'Show 2 tasks' }).click()
    await expect(page.getByPlaceholder('Search tasks...')).toHaveCount(0)
    await expect(dialog(page)).toBeVisible()
    // Phone rows: their text (no title attribute on a phone row).
    const dialogRows = dialog(page).locator('[data-todo-id]')
    await expect(dialogRows).toHaveCount(2)
    await expect(dialogRows.nth(0)).toContainText('Ann plan')
    await expect(dialogRows.nth(1)).toContainText('Ann call')

    const filters = dialog(page).getByRole('button', { name: 'Filters', exact: true })
    await expect(filters).toHaveAttribute('aria-expanded', 'false')
    await filters.click()
    await dialog(page).getByText('Show / hide', { exact: true }).click()
    await dialog(page).getByRole('switch', { name: 'Show completed' }).click()
    await expect(dialog(page).getByRole('button', { name: 'Filters, 1 active' })).toBeVisible()
    await dialog(page).getByRole('textbox', { name: 'Search tasks' }).fill('')
    await expect(dialogRows).toHaveCount(4)
    await expect(rows).toHaveCount(4)
  })
})
