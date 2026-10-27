import { expect, test, type Page } from '@playwright/test'
import { rowTitles } from './fixtures/seed'
import { openSettings, seedWorkspace, switchLayout, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * D15 Lenses, as cr22 made them: the top bar's lens control picks one lens
 * for every layout — saved at once (the `activeLensId` settings row; no
 * unsaved layout, no undo step) — and it composes under every widget. The
 * glasses lift it for now: a layout switch keeps the lift, a reload puts the
 * lens back. The counter at the tray's end says what the lens and the chips
 * keep. The control is found by its name in the header, wherever in the bar
 * it sits.
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
const header = (page: Page) => page.locator('header')
const tray = (page: Page) => header(page).getByRole('group', { name: 'Screen filters — apply to every widget' })
const lensName = (page: Page) => header(page).getByRole('button', { name: /^Lens:/ })
const glasses = (page: Page, name: 'Lens on. Lift it' | 'Lens lifted. Put it back') => header(page).getByRole('button', { name })
const counter = (page: Page) => tray(page).getByRole('button', { name: /tasks shown\. Show them$/ })
const mainTitles = (page: Page) => rowTitles(wsListWidget(page, 't1'))
const otherTitles = (page: Page) => rowTitles(wsListWidget(page, 't2'))
const saveButton = (page: Page) => page.getByTestId('layout-save')

async function pickLens(page: Page, name: string) {
  await lensName(page).click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
}

async function reload(page: Page) {
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

test.use({ viewport: { width: 1440, height: 900 } })

test('a pick is saved at once for every layout: Save stays unlit, a reload and a layout switch keep it; the widgets and the counter follow it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect.poll(() => mainTitles(page)).toEqual(ALL)
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
  await expect(counter(page)).toHaveCount(0)
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  await pickLens(page, 'Has a person')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
  await expect(counter(page)).toHaveAccessibleName('2 of 3 open tasks shown. Show them')
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  await reload(page)
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])

  // The other layout shows the same lens.
  await switchLayout(page, 'Other')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await expect.poll(() => otherTitles(page)).toEqual(['Ann plan', 'Ann waits'])
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  // A pick there is the pick everywhere.
  await pickLens(page, 'Plans')
  await expect.poll(() => otherTitles(page)).toEqual(['Ann plan'])
  await switchLayout(page, 'Main')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Plans')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan'])

  await pickLens(page, 'No lens')
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
  await expect.poll(() => mainTitles(page)).toEqual(ALL)
  await reload(page)
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
})

test('the glasses lift the lens for now; a layout switch keeps the lift, a reload puts the lens back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Has a person')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])

  await glasses(page, 'Lens on. Lift it').click()
  await expect(glasses(page, 'Lens lifted. Put it back')).toHaveAttribute('aria-pressed', 'false')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person, lifted')
  await expect.poll(() => mainTitles(page)).toEqual(ALL)
  await expect(counter(page)).toHaveAccessibleName('3 of 3 open tasks shown. Show them')

  // A layout switch: still lifted there and back.
  await switchLayout(page, 'Other')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person, lifted')
  await expect.poll(() => otherTitles(page)).toEqual(ALL)
  await switchLayout(page, 'Main')
  await expect(glasses(page, 'Lens lifted. Put it back')).toBeVisible()
  await expect.poll(() => mainTitles(page)).toEqual(ALL)

  // A reload: on again.
  await reload(page)
  await expect(glasses(page, 'Lens on. Lift it')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
})

test('a chip on top narrows further and turns the tray red; Clear all leaves the lens', async ({ page }) => {
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

test('deleting the picked lens in Settings puts the top bar on No lens, without asking; Undo brings both back', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Has a person')
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])

  const settings = await openSettings(page, 'Tasks')
  const lenses = settings.getByTestId('lens-list')
  const row = lenses.getByRole('button', { name: /^Has a person/ })
  await expect(row).toContainText('In use')
  await expect(lenses.getByRole('button', { name: /^Plans/ })).not.toContainText('In use')
  await row.click()
  await settings.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText(/Delete lens/)).toHaveCount(0)
  await expect(lenses.getByRole('button', { name: /^Has a person/ })).toHaveCount(0)
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(lenses.getByRole('button', { name: /^Has a person/ })).toContainText('In use')
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect.poll(() => mainTitles(page)).toEqual(['Ann plan', 'Ann waits'])
  await reload(page)
  await expect(lensName(page)).toHaveAccessibleName('Lens: Has a person')
})
