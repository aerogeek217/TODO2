import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The top bar shrinks its filter tray before it folds anything: short of
 * room, the search narrows first, then long filter values are cut with an
 * ellipsis (the whole value stays in the button's name and tooltip); only
 * when the tray shrunk as far as it goes still doesn't fit do the filter
 * buttons fold into the Filters menu (then the layout tabs into the picker).
 * Nothing left of the tray moves for it, and the bar never wraps.
 */

/** Two layouts named like the dev seed's, so the tray starts where it does there. */
const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Marcus Chen', 'Sarah Kim'],
  tags: ['customer', 'urgent'],
  statuses: ['Assigned', 'Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Write the review', people: ['Aisha Rahman'] },
    { title: 'Plan the offsite', people: ['Marcus Chen'], tags: ['customer'] },
  ],
  layouts: [
    { name: 'Default', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
    { name: 'Lists from upgrade', columns: [] },
  ],
}

const header = (page: Page) => page.locator('header')
const tray = (page: Page) => header(page).getByRole('group', { name: 'Screen filters — apply to every widget' })
const filtersMenu = (page: Page) => tray(page).getByRole('button', { name: /^Filters/ })
const people = (page: Page) => tray(page).getByRole('button', { name: /^People filter/ })
const FILTER_BUTTONS = ['Priority filter', 'Tags filter', /^People filter/, 'Dates filter', 'Status filter']

/** The bar now: its fold, the tray's edges, the search's width, the People value's widths, how it fits. */
const bar = (page: Page) => header(page).evaluate((el) => {
  const t = el.querySelector('[data-filter-row]')!.getBoundingClientRect()
  const spring = el.querySelector('[data-fold-part="spring"]')!.getBoundingClientRect()
  const value = Array.from(el.querySelectorAll<HTMLElement>('[data-fold-value="people"]')).find((v) => !v.closest('[data-fold-hidden]'))
  const parts = [...el.querySelectorAll('button, input')].map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0)
  const box = el.getBoundingClientRect()
  return {
    fold: el.dataset.fold,
    trayLeft: Math.round(t.left),
    trayRight: Math.round(t.right),
    springLeft: Math.round(spring.left),
    search: Math.round(el.querySelector('[data-fold-search]')!.getBoundingClientRect().width),
    // The value cut: its text runs past its box (the ellipsis shows).
    valueCut: value ? value.scrollWidth > value.clientWidth : null,
    oneLine: box.height === 40 && el.scrollWidth === el.clientWidth
      && parts.every((r) => r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5),
  }
})

/** The bar once it has settled (the same on two reads a few frames apart: no flicker). */
async function settled(page: Page) {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await bar(page))
    const same = now === last
    last = now
    return same
  }, { intervals: [100, 100, 100, 200] }).toBe(true)
  return JSON.parse(last) as Awaited<ReturnType<typeof bar>>
}

async function expectEveryFilterButton(page: Page) {
  await expect(filtersMenu(page)).toHaveCount(0)
  for (const name of FILTER_BUTTONS) {
    await expect(tray(page).getByRole('button', { name, exact: typeof name === 'string' })).toBeVisible()
  }
}

test.use({ viewport: { width: 1370, height: 900 } })

test('at 1370px one person ticked keeps every filter button: the search narrows, the name is cut and whole in its tooltip', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expectEveryFilterButton(page)
  const before = await settled(page)
  expect(before).toMatchObject({ fold: 'none', search: 200, valueCut: null, oneLine: true })

  await people(page).click()
  await page.getByRole('option', { name: '@Aisha Rahman' }).click()
  await page.keyboard.press('Escape')
  await expect(people(page)).toHaveAccessibleName('People filter: Aisha Rahman')

  // Shrunk, not folded: the tray where it was, up to the right zone.
  await expectEveryFilterButton(page)
  const shrunk = await settled(page)
  expect(shrunk).toMatchObject({ fold: 'none', trayLeft: before.trayLeft, valueCut: true, oneLine: true })
  expect(shrunk.search).toBe(110)
  expect(shrunk.trayRight).toBeLessThanOrEqual(shrunk.springLeft)
  // The whole name in the tooltip.
  await people(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('People: Aisha Rahman')
  await page.mouse.move(640, 600)

  // Wider: the full search and the whole name, no tooltip needed.
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(async () => (await settled(page)).search).toBe(200)
  expect(await settled(page)).toMatchObject({ fold: 'none', trayLeft: before.trayLeft, valueCut: false, oneLine: true })
  await people(page).hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.move(640, 600)

  // Too narrow even shrunk: the filters fold as before, the search back to its width.
  await page.setViewportSize({ width: 1200, height: 900 })
  await expect(filtersMenu(page)).toHaveAccessibleName('Filters, 1 active')
  expect(await settled(page)).toMatchObject({ fold: 'filters', trayLeft: before.trayLeft, search: 200, oneLine: true })
})

test('narrowing: the search narrows first, then the value is cut, then the filters fold, then the tabs; never a wrap, never a flicker', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 })
  await seedWorkspace(page, SEED)
  await people(page).click()
  await page.getByRole('option', { name: '@Aisha Rahman' }).click()
  await page.keyboard.press('Escape')
  const wide = await settled(page)

  const seen = new Set<string>()
  for (let width = 1600; width >= 760; width -= 20) {
    await page.setViewportSize({ width, height: 900 })
    const s = await settled(page)
    expect(s.oneLine, `at ${width}px`).toBe(true)
    if (s.fold !== 'both') {
      // Nothing left of the tray moves for any of it.
      expect(s.trayLeft, `at ${width}px`).toBe(wide.trayLeft)
      expect(s.trayRight, `at ${width}px`).toBeLessThanOrEqual(s.springLeft)
    }
    // The value is cut only once the search is as narrow as it goes.
    if (s.valueCut) expect(s.search, `at ${width}px`).toBe(110)
    seen.add(s.fold === 'none' ? (s.valueCut ? 'value cut' : s.search < 200 ? 'search narrowed' : 'natural') : s.fold!)
  }
  // Every step on the way, in order.
  expect([...seen]).toEqual(['natural', 'search narrowed', 'value cut', 'filters', 'both'])

  // And back.
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(() => settled(page)).toEqual(wide)
})
