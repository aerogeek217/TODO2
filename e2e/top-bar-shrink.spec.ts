import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { filterField, filterMenu, filterMenuButton, filterPills, openFilterPicker } from './fixtures/filters'

/**
 * The top bar shrinks its filter field before it folds anything (feedback
 * P2): short of room, the field narrows first (560px down to 240px; its
 * pills fade with `+N more`), then the layout tabs fold into the picker,
 * then the field narrows further (down to 160px). The filters never fold —
 * they are the field's pills, and the Filter button only counts them in its
 * name. Nothing left of the tray moves for it, and the bar never wraps.
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

/** The bar now: its fold, the tray's edges, the field's width, how it fits. */
const bar = (page: Page) => header(page).evaluate((el) => {
  const t = el.querySelector('[data-filter-row]')!.getBoundingClientRect()
  const spring = el.querySelector('[data-fold-part="spring"]')!.getBoundingClientRect()
  // The bar's own controls (a pill's × inside the clipped field aside).
  const parts = [...el.querySelectorAll('button, input')].filter((p) => !p.closest('[data-top-bar-pill]'))
    .map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0)
  const box = el.getBoundingClientRect()
  return {
    fold: el.dataset.fold,
    trayLeft: Math.round(t.left),
    trayRight: Math.round(t.right),
    springLeft: Math.round(spring.left),
    search: Math.round(el.querySelector('[data-fold-search]')!.getBoundingClientRect().width),
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
    for (const node of [el, ...el.querySelectorAll('[data-fold-part], [data-fold-search], [data-filter-row], button, input')]) resized.observe(node)
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

test.use({ viewport: { width: 1600, height: 900 } })

test('wide, the field is 560px; a filter picked is its pill, the Filter button counts it, nothing folds', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter')
  expect(await settled(page)).toMatchObject({ fold: 'none', search: 560, oneLine: true })
  await pick(page, 'People', 'Aisha Rahman')
  await expect(filterPills(page)).toHaveText([/@"Aisha Rahman"/])
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter, 1 active')
  expect(await settled(page)).toMatchObject({ fold: 'none', search: 560, oneLine: true })
})

test('narrowing: the field narrows first, then the tabs fold, then the field narrows further; never a wrap, never a flicker', async ({ page }) => {
  // About 60 widths, each waited out: longer than the default under a parallel run.
  test.setTimeout(90_000)
  await seedWorkspace(page, SEED)
  await pick(page, 'People', 'Aisha Rahman')
  const wide = await settled(page)

  const seen: string[] = []
  // Down to just above the phone layout (no top bar under 640px).
  for (let width = 1600; width >= 660; width -= 20) {
    await page.setViewportSize({ width, height: 900 })
    const s = await settled(page)
    expect(s.oneLine, `at ${width}px`).toBe(true)
    // The tray (centred while there is room, `top-bar-centre.spec.ts`) never runs into the right zone.
    expect(s.trayRight, `at ${width}px`).toBeLessThanOrEqual(s.springLeft)
    // Never narrower than the fold allows.
    expect(s.search, `at ${width}px`).toBeGreaterThanOrEqual(s.fold === 'none' ? 240 : 160)
    const phase = s.fold === 'none' ? (s.search < 560 ? 'field narrowed' : 'natural') : s.search < 560 ? `${s.fold}, field narrowed` : s.fold!
    if (seen.at(-1) !== phase) seen.push(phase)
  }
  // Every step on the way, in order (the tabs fold while the field is already narrowed).
  expect(seen).toEqual(['natural', 'field narrowed', 'tabs, field narrowed'])

  // And back.
  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(() => settled(page)).toEqual(wide)
})

test('a long filter fades at the field’s end with +N more; its tooltip is the whole filter', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 900 })
  await seedWorkspace(page, SEED)
  await filterField(page).click()
  await page.keyboard.type('(@"Aisha Rahman" or @"Marcus Chen" or @"Sarah Kim") and (#customer or #urgent) and not !Assigned and not !Waiting and due <= +7d')
  await page.keyboard.press('Enter')
  await filterField(page).blur()
  const more = page.getByTestId('top-bar-pills-more')
  await expect(more).toHaveText(/^\+\d+ more$/)
  expect(await settled(page)).toMatchObject({ fold: 'none', oneLine: true })
  // The pointer comes in from outside (it was over the field while typing).
  await page.mouse.move(500, 600)
  await filterField(page).hover()
  await expect(page.getByRole('tooltip')).toContainText('(@"Aisha Rahman" or @"Marcus Chen" or @"Sarah Kim")')
})
