import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, withSpareLayouts, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { filterChip, filterField } from './fixtures/filters'

/**
 * The top bar in three groups: the layout tabs on the left, the lens control
 * with the filter tray in the middle, the storage pill, the gear and New task
 * on the right. At rest (no chip, no counter) the middle group is centred in
 * the bar, at least 20px clear of both neighbours; a chip or the counter
 * grows it rightwards — the lens control and the field never move under the
 * user — until it would reach the right zone. Short of room it sits as near
 * the centre as it can, then the fold takes over; never a wrap.
 */

/** Two layouts named like the dev seed's. */
const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Marcus Chen'],
  tags: ['customer', 'urgent'],
  statuses: ['Assigned', 'Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Write the review', people: ['Aisha Rahman'] },
    { title: 'Plan the offsite', people: ['Marcus Chen'], tags: ['customer'] },
  ],
  layouts: [
    { name: 'Default', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
    { name: 'Planning', columns: [] },
  ],
}

const MIN_GAP = 20

/** The bar's groups now: the tabs' right edge, the middle group's edges, the field's left, the right zone's first control. */
const geometry = (page: Page) => page.locator('header').evaluate((bar) => {
  const rect = (sel: string) => bar.querySelector(sel)!.getBoundingClientRect()
  const box = bar.getBoundingClientRect()
  const parts = [...bar.querySelectorAll('button, input')].map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0)
  const rightControls = [...bar.querySelectorAll('[data-fold-part="spring"] > *')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
  return {
    fold: bar.dataset.fold,
    barCentre: box.left + box.width / 2,
    tabsRight: rect('[data-fold-part="layout"]').right,
    groupLeft: rect('[data-fold-part="lens"]').left,
    groupRight: rect('[data-filter-row]').right,
    fieldLeft: rect('[data-fold-search]').left,
    rightLeft: Math.min(...rightControls.map((r) => r.left)),
    oneLine: box.height === 40 && bar.scrollWidth === bar.clientWidth
      && parts.every((r) => r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5),
  }
})

/** The bar once it has settled: two animation frames in a row with nothing resized or changed in it. */
async function settled(page: Page) {
  await page.locator('header').evaluate((el) => new Promise<void>((resolve) => {
    let changed = true
    let quiet = 0
    const resized = new ResizeObserver(() => { changed = true })
    for (const node of [el, ...el.querySelectorAll('[data-fold-part], [data-filter-row] > *, button, input')]) resized.observe(node)
    const mutated = new MutationObserver(() => { changed = true })
    mutated.observe(el, { attributes: true, childList: true, characterData: true, subtree: true })
    const frame = () => {
      quiet = changed ? 0 : quiet + 1
      changed = false
      if (quiet < 3) {
        requestAnimationFrame(frame)
        return
      }
      resized.disconnect()
      mutated.disconnect()
      resolve()
    }
    requestAnimationFrame(frame)
  }))
  return geometry(page)
}

function expectClear(g: Awaited<ReturnType<typeof geometry>>, at: string) {
  // Within a px: a tray the fold shrank is cut to whole px.
  expect(g.groupLeft - g.tabsRight, `gap to the tabs at ${at}`).toBeGreaterThanOrEqual(MIN_GAP - 1)
  expect(g.rightLeft - g.groupRight, `gap to the right zone at ${at}`).toBeGreaterThanOrEqual(MIN_GAP - 1)
  expect(g.oneLine, `one line at ${at}`).toBe(true)
}

async function pickAisha(page: Page) {
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
      useFilterStore: { getState: () => { setPersonIds: (s: Set<number> | null) => void } }
    }
    mod.useFilterStore.getState().setPersonIds(new Set([1]))
  })
  await expect(filterChip(page, 'People')).toBeVisible()
}

for (const width of [1920, 1440, 1280, 1100]) {
  test(`at ${width}px, at rest, the lens and filter group is centred in the bar, clear of both neighbours`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedWorkspace(page, SEED)
    const g = await settled(page)
    expect(g.fold).toBe('none')
    expect(Math.abs((g.groupLeft + g.groupRight) / 2 - g.barCentre), `centre at ${width}px`).toBeLessThanOrEqual(3)
    expectClear(g, `${width}px`)
  })
}

test('a filter set grows the group rightwards: the lens control and the field stay put', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, SEED)
  const rest = await settled(page)
  await pickAisha(page)
  const set = await settled(page)
  expect(set.groupLeft).toBe(rest.groupLeft)
  expect(set.fieldLeft).toBe(rest.fieldLeft)
  expect(set.groupRight).toBeGreaterThan(rest.groupRight)
  expectClear(set, 'one filter')
})

test('typing @name in the field makes a chip without sliding the field under the caret', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, SEED)
  const rest = await settled(page)
  await filterField(page).click()
  await page.keyboard.type('@Aisha ')
  await expect(filterChip(page, 'People')).toBeVisible()
  const after = await settled(page)
  expect(after.fieldLeft).toBe(rest.fieldLeft)
  expect(after.groupLeft).toBe(rest.groupLeft)
})

test('with six layout tabs the group is off centre, still clear of them', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, withSpareLayouts(SEED, 4))
  const g = await settled(page)
  expect(g.fold).toBe('none')
  expect((g.groupLeft + g.groupRight) / 2).toBeGreaterThan(g.barCentre + 3)
  expectClear(g, 'six tabs')
})

test('with Couldn’t save · Retry beside the tabs the group stays clear of them, on one line', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 })
  await seedWorkspace(page, SEED)
  await pickAisha(page)
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/workspace-store.ts' as string)) as { useWorkspaceStore: { setState: (s: { writeFailed: boolean }) => void } }
    mod.useWorkspaceStore.setState({ writeFailed: true })
  })
  await expect(page.getByTestId('layout-write-failed')).toBeVisible()
  expectClear(await settled(page), 'Couldn’t save')
})

test('narrowing with a filter on: always clear of both neighbours and on one line, the fold taking over when there is no slack', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  await seedWorkspace(page, SEED)
  await pickAisha(page)
  for (let width = 1600; width >= 760; width -= 40) {
    await page.setViewportSize({ width, height: 900 })
    expectClear(await settled(page), `${width}px`)
  }
})
