import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { filterMenu, filterMenuButton, filterMenuRow, openFilterMenu, openFilterPicker } from './fixtures/filters'

/**
 * The top bar shrinks its filter tray before it folds anything: short of
 * room, the field narrows first, then long values on the set filters' chips
 * are cut with an ellipsis (the whole value stays in the chip's name and
 * tooltip); only when the tray shrunk as far as it goes still doesn't fit do
 * the chips fold into the Filter button (then the layout tabs into the
 * picker). Nothing left of the tray moves for it, and the bar never wraps.
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
    { name: 'Default', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
    { name: 'Lists from upgrade', columns: [] },
  ],
}

const header = (page: Page) => page.locator('header')
const tray = (page: Page) => header(page).getByRole('group', { name: 'Screen filters — apply to every widget' })
const people = (page: Page) => tray(page).getByRole('button', { name: /^People filter/ })

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

/**
 * The bar once it has settled: two animation frames in a row with no resize
 * of the bar or any part of it and no change to its DOM. The fold is a
 * ResizeObserver → re-render → re-measure loop, so it is done when a frame
 * passes with nothing for its observer to report (cr31 tests 2.1: two equal
 * reads 100 ms apart could catch it mid-way under load).
 */
async function settled(page: Page) {
  await header(page).evaluate((el) => new Promise<void>((resolve) => {
    let changed = true
    let quiet = 0
    const resized = new ResizeObserver(() => { changed = true })
    // The bar and what its fold measures: its parts, the search, the filter values.
    for (const node of [el, ...el.querySelectorAll('[data-fold-part], [data-fold-search], [data-fold-value], [data-filter-row], button, input')]) resized.observe(node)
    const mutated = new MutationObserver(() => { changed = true })
    mutated.observe(el, { attributes: true, childList: true, characterData: true, subtree: true })
    const frame = () => {
      quiet = changed ? 0 : quiet + 1
      changed = false
      if (quiet < 2) {
        requestAnimationFrame(frame)
        return
      }
      resized.disconnect()
      mutated.disconnect()
      resolve()
    }
    requestAnimationFrame(frame)
  }))
  return bar(page)
}

/** Picks `option` in `field`'s picker from the Filter menu; closes the picker and the menu. */
async function pick(page: Page, field: 'People' | 'Status', ...options: string[]) {
  await openFilterPicker(page, field)
  for (const option of options) await page.getByRole('option', { name: option }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(filterMenu(page)).toHaveCount(0)
}

// The storage pill is its 24px dot while all is well. Measured on this seed
// with Aisha Rahman picked: the field narrows below 968px, her name is cut
// below 876px, the chip folds into the Filter button below 852px and the
// layout tabs fold below 766px. With nothing picked the field narrows only
// below 776px and nothing folds.
test.use({ viewport: { width: 862, height: 900 } })

test('at 862px one person picked shows her chip: the field narrows, the name is cut and whole in its tooltip', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter')
  const before = await settled(page)
  expect(before).toMatchObject({ fold: 'none', search: 200, valueCut: null, oneLine: true })

  await pick(page, 'People', 'Aisha Rahman')
  await expect(people(page)).toHaveAccessibleName('People filter: Aisha Rahman')

  // Shrunk, not folded: the tray where it was, up to the right zone.
  const shrunk = await settled(page)
  expect(shrunk).toMatchObject({ fold: 'none', trayLeft: before.trayLeft, valueCut: true, oneLine: true })
  expect(shrunk.search).toBe(110)
  expect(shrunk.trayRight).toBeLessThanOrEqual(shrunk.springLeft)
  // The whole name in the tooltip.
  await people(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('People: Aisha Rahman')
  await page.mouse.move(640, 600)

  // Wider: the full field and the whole name, no tooltip needed.
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(async () => (await settled(page)).search).toBe(200)
  expect(await settled(page)).toMatchObject({ fold: 'none', trayLeft: before.trayLeft, valueCut: false, oneLine: true })
  await people(page).hover()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.move(640, 600)

  // Too narrow even shrunk: the chip folds into the Filter button, the field wider again.
  await page.setViewportSize({ width: 820, height: 900 })
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter, 1 active')
  await expect(people(page)).toHaveCount(0)
  const folded = await settled(page)
  expect(folded).toMatchObject({ fold: 'filters', trayLeft: before.trayLeft, oneLine: true })
  expect(folded.search).toBeGreaterThan(110)
  // Its menu still says what is on.
  await openFilterMenu(page)
  await expect(filterMenu(page).getByRole('button', { name: 'People filter: Aisha Rahman' })).toBeVisible()
})

test('narrowing: the field narrows first, then the value is cut, then the chips fold, then the tabs; never a wrap, never a flicker', async ({ page }) => {
  // About 70 widths, each waited out: longer than the default under a parallel run.
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  await seedWorkspace(page, SEED)
  await pick(page, 'People', 'Aisha Rahman')
  const wide = await settled(page)

  const seen = new Set<string>()
  // 20 px steps, 5 px across the narrow band where the value is cut (about
  // 876–852 px in this seed), so each phase is seen more than once.
  for (let width = 1600; width >= 700; width -= width <= 890 && width > 840 ? 5 : 20) {
    await page.setViewportSize({ width, height: 900 })
    const s = await settled(page)
    expect(s.oneLine, `at ${width}px`).toBe(true)
    if (s.fold !== 'both') {
      // Nothing left of the tray moves for any of it.
      expect(s.trayLeft, `at ${width}px`).toBe(wide.trayLeft)
      expect(s.trayRight, `at ${width}px`).toBeLessThanOrEqual(s.springLeft)
    }
    // The value is cut only once the field is as narrow as it goes.
    if (s.valueCut) expect(s.search, `at ${width}px`).toBe(110)
    seen.add(s.fold === 'none' ? (s.valueCut ? 'value cut' : s.search < 200 ? 'search narrowed' : 'natural') : s.fold!)
  }
  // Every step on the way, in order.
  expect([...seen]).toEqual(['natural', 'search narrowed', 'value cut', 'filters', 'both'])

  // And back.
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(() => settled(page)).toEqual(wide)
})

test('a pick that needs the fold waits for the Filter menu to close: the menu and its picker stay put mid-pick (cr31 UI F10)', async ({ page }) => {
  // Aisha's chip fits (the field narrowed); a Status value as well folds the chips (below 960px).
  await page.setViewportSize({ width: 920, height: 900 })
  await seedWorkspace(page, SEED)
  await pick(page, 'People', 'Aisha Rahman')
  expect((await settled(page)).fold).toBe('none')

  await openFilterPicker(page, 'Status')
  const list = page.getByRole('listbox', { name: 'Status' })
  await list.getByRole('option', { name: 'Assigned' }).click()
  await list.getByRole('option', { name: 'Waiting' }).click()
  // Still open, both picked, the bar unfolded under it.
  await expect(list.getByRole('option', { name: 'Waiting' })).toHaveAttribute('aria-selected', 'true')
  await expect(list.getByRole('option', { name: 'Assigned' })).toHaveAttribute('aria-selected', 'true')
  await expect(filterMenuRow(page, 'Status')).toHaveAccessibleName('Status filter: Assigned or Waiting')
  expect(await header(page).getAttribute('data-fold')).toBe('none')

  // Closed: now it folds.
  await page.keyboard.press('Escape')
  await expect(list).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(filterMenu(page)).toHaveCount(0)
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter, 2 active')
  expect(await settled(page)).toMatchObject({ fold: 'filters', oneLine: true })
})
