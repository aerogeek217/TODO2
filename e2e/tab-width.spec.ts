import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsTab } from './fixtures/workspace'

/**
 * A tab's width (cr31 UI M4, the user's call: "Tabs can grow to fit
 * contents. But I don't like them to change size on mouseover."): no tab
 * changes width on hover — its close × has its place whether it shows or not.
 */

const SEED = {
  people: ['Ann'],
  listDefinitions: [{ name: 'Everything' }, { name: 'Client follow-ups', people: ['Ann'] }],
  tasks: [
    { title: 'Overdue task', dueInDays: -2, people: ['Ann'] },
    { title: 'Due soon', dueInDays: 2, people: ['Ann'] },
    { title: 'Follow up today', followupInDays: 0, people: ['Ann'] },
  ],
  layouts: [{
    name: 'Main',
    columns: [{
      id: 'c1',
      cells: [{
        id: 'k1',
        activeTabId: 'all',
        tabs: [
          { id: 'all', kind: 'lens' as const, listDefIdx: 0 },
          { id: 'ann', kind: 'lens' as const, listDefIdx: 1 },
          { id: 'n1', kind: 'notes' as const },
          { id: 'c1t', kind: 'calendar' as const },
        ],
      }],
    }],
  }],
}

const badge = (tab: Locator) => tab.locator('[data-tab-badge]')

/** The tab's width after the strip has settled (two frames). */
const widthOf = (tab: Locator) => tab.evaluate(async (el) => {
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  return el.getBoundingClientRect().width
})

/** Moves the pointer off every tab. */
const pointerAway = (page: Page) => page.mouse.move(5, 790)

test.describe('tab width', () => {
  test.use({ viewport: { width: 1400, height: 800 } })

  test('no tab changes width on hover: an inactive one, a badged one, the active one', async ({ page }) => {
    await seedWorkspace(page, SEED)
    await expect(badge(wsTab(page, 'ann')).locator('span')).toHaveText(['2', '1'])
    for (const id of ['n1', 'c1t', 'ann', 'all']) {
      const tab = wsTab(page, id)
      await pointerAway(page)
      const before = await widthOf(tab)
      await tab.hover()
      await expect(tab.getByRole('button', { name: /^Close / })).toBeVisible()
      const during = await widthOf(tab)
      expect(during, `${id}: width during hover`).toBe(before)
    }
  })
})
