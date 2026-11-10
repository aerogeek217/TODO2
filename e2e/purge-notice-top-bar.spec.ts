import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsRow } from './fixtures/workspace'
import { purgeDialog } from './fixtures/purge-notice'

/**
 * The purge notice gives the storage pill its text (`17 old completed`) in
 * place of the 24px dot: the top bar re-measures its fold for the wider pill
 * and still never wraps, and the pill's text is never cut.
 */

const header = (page: Page) => page.locator('header')

/** The bar on one line (40px, nothing past its edges) and the pill's text whole. */
const fit = (page: Page) => header(page).evaluate((el) => {
  const box = el.getBoundingClientRect()
  const parts = [...el.querySelectorAll('button, input')].map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0)
  const pill = el.querySelector<HTMLElement>('[data-testid="storage-pill"]')!
  const text = [...pill.querySelectorAll<HTMLElement>('span')].find((s) => s.textContent === pill.textContent)!
  const p = pill.getBoundingClientRect()
  return {
    oneLine: box.height === 40 && el.scrollWidth === el.clientWidth
      && parts.every((r) => r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5),
    pillInside: p.left >= box.left && p.right <= box.right + 0.5,
    textWhole: text.scrollWidth <= text.clientWidth,
    fold: el.dataset.fold,
  }
})

/** Two quiet animation frames: the fold's ResizeObserver loop has settled. */
async function settled(page: Page) {
  await header(page).evaluate((el) => new Promise<void>((resolve) => {
    let changed = true
    let quiet = 0
    const resized = new ResizeObserver(() => { changed = true })
    for (const node of [el, ...el.querySelectorAll('[data-fold-part], [data-fold-search], button, input')]) resized.observe(node)
    const mutated = new MutationObserver(() => { changed = true })
    mutated.observe(el, { attributes: true, childList: true, characterData: true, subtree: true })
    const frame = () => {
      quiet = changed ? 0 : quiet + 1
      changed = false
      if (quiet < 2) { requestAnimationFrame(frame); return }
      resized.disconnect()
      mutated.disconnect()
      resolve()
    }
    requestAnimationFrame(frame)
  }))
  return fit(page)
}

test('the pill shows "17 old completed" with no dialog at launch; the bar stays on one line from 1600 to 760px', async ({ page }) => {
  test.setTimeout(90_000)
  await page.setViewportSize({ width: 1600, height: 900 })
  await seedWorkspace(page, {
    people: ['Aisha Rahman', 'Marcus Chen'],
    tags: ['customer'],
    statuses: ['Waiting'],
    listDefinitions: [{ name: 'Team' }],
    settings: { completedRetentionDays: '30' },
    tasks: [
      { title: 'Open task', people: ['Aisha Rahman'] },
      ...Array.from({ length: 17 }, (_, i) => ({ title: `Old done ${i + 1}`, completedInDays: -40 - i })),
      { title: 'Recently done', completedInDays: -2 },
    ],
    layouts: [
      { name: 'Default', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
      { name: 'Lists from upgrade', columns: [] },
    ],
  })
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveText('17 old completed')
  await expect(pill).toHaveAccessibleName('Storage: 17 old completed')
  await expect(purgeDialog(page)).toHaveCount(0)

  for (let width = 1600; width >= 760; width -= 40) {
    await page.setViewportSize({ width, height: 900 })
    const s = await settled(page)
    expect(s, `at ${width}px`).toMatchObject({ oneLine: true, pillInside: true, textWhole: true })
  }
})
