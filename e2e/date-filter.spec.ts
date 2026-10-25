import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsListWidget } from './fixtures/workspace'
import { box, expectInsideViewport } from './fixtures/geometry'

/**
 * The date panel in a real browser: one clause per date type (Due ·
 * Follow-up · Created · Modified), several at once (all must match), a
 * type's tab lit while it filters, and selecting a tab never fills in a
 * date. Opened from the top bar's Dates button, a list's date chip /
 * + Filter, and the phone Filters sheet.
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
  await expect(panel.getByRole('tab', { name: 'Follow-up' })).toBeFocused()
  await expect(panel.getByRole('tab', { name: 'Follow-up' })).toHaveAttribute('aria-selected', 'true')
  await expect(panel.getByText('Next follow-up')).toBeVisible()
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
  await expect(chips).toHaveText([/Due\s*has a date/, /Follow-up\s*no date/])

  // The Follow-up chip (in the right-hand column) opens the panel under it, inside the viewport, on Follow-up.
  const followupChip = chips.nth(1)
  await followupChip.click()
  const panel = dialog(page)
  await expect(panel.getByRole('tab', { name: 'Follow-up, filtering' })).toHaveAttribute('aria-selected', 'true')
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
  await expect(chips).toHaveText([/Follow-up\s*no date/])
  await expect(rows(page, 't2')).toHaveText([/Due only/, /Neither/])
  await expect(wsCell(page, 'k2').getByTestId('save-list')).toBeVisible()

  // + Filter › Dates: the panel opens on the first type that filters, focused there.
  await widget.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  await expect(panel.getByRole('tab', { name: 'Follow-up, filtering' })).toBeFocused()
  await expect(panel.getByRole('tab', { name: 'Follow-up, filtering' })).toHaveAttribute('aria-selected', 'true')
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

    await page.getByRole('tab', { name: 'Follow-up' }).click()
    await expect(allRows).toHaveCount(3)
    const noDate = page.getByRole('radio', { name: 'No date' })
    expect((await box(noDate)).height).toBeGreaterThanOrEqual(36)
    await noDate.click()
    await expect(page.getByText('Only tasks with no follow-up.')).toBeVisible()
    await expect(allRows).toHaveCount(2)
    await expect(datesRow.locator('..')).toContainText('Follow-up no date')

    await page.getByRole('tab', { name: 'Due' }).click()
    await expect(allRows).toHaveCount(2)
    await page.getByRole('radio', { name: 'Has a date' }).click()
    await expect(allRows).toHaveCount(1)
    await expect(datesRow.locator('..')).toContainText('Due + Follow-up')

    await page.getByRole('button', { name: 'Clear all dates' }).click()
    await expect(allRows).toHaveCount(3)
    await expect(datesRow.locator('..')).toContainText('Any')
  })
})
