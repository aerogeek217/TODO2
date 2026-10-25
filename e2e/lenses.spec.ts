import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { seedWorkspace, switchLayout, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D15 Lenses: a layout's lens, picked in the top bar's lens control, is
 * view state — it survives a reload — and composes under every widget; the
 * glasses lift it for now, and a layout switch (or a reload) puts it back.
 * The counter at the tray's end says what the lens and the chips keep.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann'],
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Everything', layoutIdx: 0 }, { name: 'Also everything', layoutIdx: 1 }],
  tasks: [
    { title: 'Ann plan', people: ['Ann'] },
    { title: 'Ann waits', people: ['Ann'], status: 'Waiting' },
    { title: 'Nobody task' },
  ],
  lenses: [
    { id: 'lens-person', name: 'Has a person', predicate: { personIds: [0], negate: { personIds: true } } },
    { id: 'lens-text', name: 'Plans', predicate: { searchText: 'plan' } },
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
    { name: 'Other', columns: [{ id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 't2', kind: 'lens', listDefIdx: 1 }] }] }] },
  ],
}

const ALL = ['Ann plan', 'Ann waits', 'Nobody task']
const tray = (page: Page) => page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
const lensName = (page: Page) => tray(page).getByRole('button', { name: /^Lens:/ })
const counter = (page: Page) => tray(page).getByRole('button', { name: /tasks shown\. Show them$/ })
const mainTitles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

async function pickLens(page: Page, name: string) {
  await lensName(page).click()
  await page.getByRole('menu', { name: 'Lens for this layout' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
}

test.use({ viewport: { width: 1440, height: 900 } })

test('a lens picked for a layout survives a reload; the counter and the widgets follow it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => mainTitles(page)).toEqual(ALL)
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
  await expect(counter(page)).toHaveCount(0)

  await pickLens(page, 'Has a person')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
  await expect(counter(page)).toHaveAccessibleName('2 of 3 open tasks shown. Show them')

  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
  await expect(counter(page)).toHaveAccessibleName('2 of 3 open tasks shown. Show them')

  // The other layout has its own pick (none); coming back, this one's is there.
  await switchLayout(page, 'Other')
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
  await switchLayout(page, 'Main')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
})

test('the glasses lift the lens for now; a layout switch and a reload put it back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Has a person')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])

  await tray(page).getByRole('button', { name: 'Lens on. Lift it' }).click()
  await expect(tray(page).getByRole('button', { name: 'Lens lifted. Put it back' })).toHaveAttribute('aria-pressed', 'false')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person, lifted')
  await expect.poll(() => mainTitles(page)).toEqual(ALL)
  await expect(counter(page)).toHaveAccessibleName('3 of 3 open tasks shown. Show them')

  // A layout switch and back: the lens is on again.
  await switchLayout(page, 'Other')
  await switchLayout(page, 'Main')
  await expect(tray(page).getByRole('button', { name: 'Lens on. Lift it' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])

  // Lifted, then reloaded: on again.
  await tray(page).getByRole('button', { name: 'Lens on. Lift it' }).click()
  await expect.poll(() => mainTitles(page)).toEqual(ALL)
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await expect(tray(page).getByRole('button', { name: 'Lens on. Lift it' })).toBeVisible()
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
})

test('a chip on top narrows further and turns the counter red; Clear all leaves the lens', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Has a person')
  await tray(page).getByRole('button', { name: /^Status filter/ }).click()
  await page.getByRole('option', { name: 'Waiting' }).click()
  await page.keyboard.press('Escape')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann waits'])
  await expect(counter(page)).toHaveAccessibleName('1 of 3 open tasks shown. Show them')
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')
  await tray(page).getByRole('button', { name: 'Clear all filters' }).click()
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await expect(tray(page)).not.toHaveAttribute('data-filtered')
})
