import { expect, test, type Page } from '@playwright/test'
import { pickWidgetKind, seedWorkspace, wsCell, wsTab, type WorkspaceSeed, expectLayoutStep, expectLayoutStored } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * The glance widgets in a real browser, as the Dashboard's tiles and
 * sections were (v77 made every Dashboard these): a cold load straight into
 * a layout of them renders their counts (the people and tag assignments
 * loaded); the top-bar filter turns counts into `shown of total`; a tab's
 * setting and a new widget are layout changes.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const METRICS = ['open', 'urgent', 'overdue', 'followupDue', 'focus'] as const

function seedWith(extraColumns: WorkspaceSeed['layouts'][number]['columns'] = []): WorkspaceSeed {
  return {
    people: [{ name: 'Alice Chen', initials: 'AC', color: '#e8a25c' }, 'Ben Ortiz'],
    tags: ['q4', 'home'],
    tasks: [
      { title: 'Fix checkout outage', urgent: true, important: true, dueInDays: 0, people: ['Alice Chen'], tags: ['q4'] },
      { title: 'Plan the offsite', focus: true, tags: ['q4'], followupInDays: 2 },
      { title: 'Call the plumber', dueInDays: -2, tags: ['home'] },
      { title: 'Vendor contract', followupInDays: -1, people: ['Ben Ortiz'] },
      { title: 'Done already', isCompleted: true, urgent: true },
    ],
    layouts: [{
      name: 'Glance',
      columns: [
        { id: 'c1', rows: [
          // A fit row of Numbers, then Tags, People and Status side by side.
          { id: 'numbers', cells: METRICS.map((metric) => ({ id: `n-${metric}`, tabs: [{ id: metric, kind: 'number' as const, glance: { metric } }] })) },
          { id: 'sections', cells: [
            { id: 'k-tags', tabs: [{ id: 'tags', kind: 'breakdown', glance: { name: 'Tags', splitBy: 'tags' } }] },
            { id: 'k-people', tabs: [{ id: 'people', kind: 'breakdown', glance: { name: 'People', splitBy: 'people' } }] },
            { id: 'k-status', tabs: [{ id: 'status', kind: 'breakdown', glance: { name: 'Status', splitBy: 'status' } }] },
          ] },
        ] },
        ...extraColumns,
      ],
    }],
  }
}

const count = (page: Page, metric: string) => page.locator(`[data-glance-tab="${metric}"] [data-number]`).getByTestId('number-count')
/** A section by its kind (`trend`), or a chart by its tab id. */
const section = (page: Page, id: string) => page.locator(`[data-glance-section="${id}"], [data-chart="${id}"]`)
const rows = (page: Page, id: string) => section(page, id).locator('[data-breakdown-row]')

test('a cold-loaded layout of glance widgets renders their counts and the rows’ chips', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await page.goto('about:blank')
  await page.goto('/#/')

  await expect(count(page, 'open')).toHaveText('4')
  await expect(count(page, 'urgent')).toHaveText('2')
  await expect(count(page, 'overdue')).toHaveText('1')
  await expect(count(page, 'followupDue')).toHaveText('1')
  await expect(count(page, 'focus')).toHaveText('1')
  // A Number's tab reads its metric.
  await expect(wsTab(page, 'overdue')).toContainText('Overdue')

  // Tags: assignments loaded on a cold load too.
  await expect(rows(page, 'tags')).toHaveCount(3)

  // People: assignments loaded on a cold load (not everything "Unassigned").
  await expect(rows(page, 'people')).toHaveCount(3)
  await expect(section(page, 'people').locator('[data-breakdown-row="none"] [data-testid="breakdown-figure"]')).toHaveText('2')
  await expect(section(page, 'status')).toContainText('4 open')
})

test('the top-bar filter turns counts into shown of total', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await page.getByRole('button', { name: 'Tags filter' }).click()
  await page.getByRole('option', { name: 'q4' }).click()
  await page.keyboard.press('Escape')

  await expect(count(page, 'open')).toHaveText('2of 4')
  await expect(count(page, 'urgent')).toHaveText('1of 2')
  await expect(count(page, 'overdue')).toHaveText('0of 1')
  await expect(count(page, 'followupDue')).toHaveText('0of 1')
  // A Breakdown counts what the top bar shows.
  await expect(section(page, 'status')).toContainText('2 open')
  await expect(rows(page, 'people')).toHaveCount(2)
})

test('a tab’s setting and a new widget are layout changes', async ({ page }) => {
  await seedWorkspace(page, seedWith())
  await expect(section(page, 'people').locator('[data-breakdown-row="none"]')).toBeVisible()
  await expectLayoutStored(page)

  // People's Unassigned row, hidden from its tab menu.
  const cell = wsCell(page, 'k-people')
  await cell.hover()
  await wsTab(page, 'people').click({ button: 'right' })
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: /^Unassigned/ }).click()
  await page.getByRole('menuitemradio', { name: 'Hidden', exact: true }).click()
  await expect(section(page, 'people').locator('[data-breakdown-row="none"]')).toHaveCount(0)
  await expectLayoutStep(page)
  await expectLayoutStored(page)

  // Add widget → Numbers & charts › Created vs completed: a second tab, an unsaved layout change.
  await cell.hover()
  await cell.getByRole('button', { name: 'Cell options' }).click()
  await page.getByRole('menuitem', { name: 'Add widget…' }).click()
  await pickWidgetKind(page, 'Add widget', 'Created vs completed')
  await expect(cell.getByRole('tab')).toHaveCount(2)
  await expect(section(page, 'trend')).toBeVisible()
  await expectLayoutStep(page)
})

test('narrow section cells keep their parts inside: People keeps the names, Created vs completed its stats and key', async ({ page }) => {
  // Three sections side by side in a wide column: each cell about 350px wide.
  await seedWorkspace(page, seedWith([
    { id: 'c2', weight: 3, rows: [{ cells: [
      { id: 'narrow-people', tabs: [{ id: 'narrow-people-tab', kind: 'breakdown', glance: { name: 'People', splitBy: 'people' } }] },
      { id: 'narrow-trend', tabs: [{ id: 'narrow-trend-tab', kind: 'trend' }] },
      { id: 'narrow-status', tabs: [{ id: 'narrow-status-tab', kind: 'breakdown', glance: { name: 'Status', splitBy: 'status' } }] },
    ] }] },
  ]))
  const people = page.locator('[data-glance-tab="narrow-people-tab"]')
  const trend = page.locator('[data-glance-tab="narrow-trend-tab"]')
  await expect(people.locator('[data-breakdown-row]').first()).toBeVisible()
  await expect(trend.locator('[data-glance-section="trend"]')).toBeVisible()

  // Nothing drawn past a section's right edge (a cut title's ellipsis box excepted).
  const spill = (root: typeof people) => root.evaluate((el) => {
    const right = el.getBoundingClientRect().right
    return Array.from(el.querySelectorAll<HTMLElement>('*'))
      .filter((e) => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > right + 0.5)
      .filter((e) => !e.closest('[class*="titleText"]'))
      .map((e) => e.textContent?.trim().slice(0, 30) ?? e.tagName)
  })
  expect((await people.boundingBox())!.width).toBeLessThan(380)
  expect(await spill(people)).toEqual([])
  expect(await spill(trend)).toEqual([])

  // People: each name keeps room to read (the bar goes first).
  const names = await people.locator('[data-breakdown-row]').evaluateAll((rows) => rows.map((r) => r.firstElementChild!.getBoundingClientRect().width))
  for (const w of names) expect(w).toBeGreaterThan(60)
})

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })

  test('Created vs completed keeps a set height in a stacked column, however many tasks', async ({ page }) => {
    const many = Array.from({ length: 30 }, (_, i) => ({ title: `Due today ${i + 1}`, dueInDays: 0 }))
    await seedWorkspace(page, {
      tasks: many,
      layouts: [{
        name: 'Glance',
        columns: [{ id: 'c1', rows: [
          { id: 'charts', cells: [{ id: 'k-trend', tabs: [{ id: 'trend', kind: 'trend' }] }] },
          { id: 'more', cells: [{ id: 'k-status', tabs: [{ id: 'status', kind: 'breakdown', glance: { name: 'Status', splitBy: 'status' } }] }] },
        ] }],
      }],
    })
    await expect(section(page, 'trend')).toBeVisible()
    // Sized to its content, the bars (36px a task) would run past 600px.
    for (const id of ['trend']) {
      const h = (await box(page.locator(`[data-ws-cell-body][data-kind="${id}"]`))).height
      expect(h, id).toBeGreaterThan(200)
      expect(h, id).toBeLessThan(360)
    }
  })
})
