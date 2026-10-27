import { expect, test, type Locator, type Page } from '@playwright/test'
import { ADD_FILTER, openSettings, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Popovers stand off the page (D21): a popover over the page (level 1) and
 * one on a popover or in a dialog (level 2) take their level's surface and
 * shadow — the ring inside it — in both themes. Computed styles are compared
 * with the tokens resolved on the document (the level-2 twins read straight
 * from the root, so the swap under `[data-popover-level='2']` is what's
 * tested), and the surfaces with the design's values.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  lenses: [{ id: 'l1', name: 'Has a person' }],
  listDefinitions: [{ name: 'Team', people: ['Ann'] }],
  tasks: [
    { title: 'Ann one', people: ['Ann'] },
    { title: 'Ann two', people: ['Ann'] },
    { title: 'Ann three', people: ['Ann'] },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

/** The design's surfaces (D21 board E). */
const SURFACE = {
  dark: { 1: 'rgb(42, 40, 37)', 2: 'rgb(53, 50, 48)' },
  light: { 1: 'rgb(255, 255, 255)', 2: 'rgb(255, 255, 255)' },
} as const

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** A level's tokens as computed values, resolved on a probe under the document root. */
async function tokens(page: Page, level: 1 | 2) {
  return page.evaluate((suffix) => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = `var(--color-popover-bg${suffix})`
    probe.style.boxShadow = `var(--shadow-dropdown${suffix})`
    probe.style.color = 'var(--color-popover-text-muted)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const out = { background: cs.backgroundColor, shadow: cs.boxShadow, muted: cs.color }
    probe.remove()
    return out
  }, level === 2 ? '-2' : '')
}

async function look(el: Locator) {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node)
    return { background: cs.backgroundColor, shadow: cs.boxShadow }
  })
}

async function expectLevel(page: Page, popover: Locator, level: 1 | 2, theme: 'dark' | 'light') {
  await expect(popover).toHaveAttribute('data-popover-level', String(level))
  const want = await tokens(page, level)
  expect(await look(popover)).toEqual({ background: want.background, shadow: want.shadow })
  expect(want.background).toBe(SURFACE[theme][level])
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ viewport: { width: 1400, height: 900 } })

    test.beforeEach(async ({ page }) => {
      await seedWorkspace(page, SEED)
      await setTheme(page, theme)
    })

    test('over the list: + Filter’s menu and a chip’s picker are level 1, the menu’s muted text the popover muted', async ({ page }) => {
      const row = wsListWidget(page, 't1').getByTestId('list-filter-row')
      await row.getByRole('button', { name: ADD_FILTER }).click()
      const menu = page.getByRole('menu', { name: 'Add a filter' })
      await expectLevel(page, menu, 1, theme)
      const heading = menu.getByText('Add a filter to this list')
      expect(await heading.evaluate((el) => getComputedStyle(el).color)).toBe((await tokens(page, 1)).muted)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)

      await row.getByTestId('list-filter-chip').click()
      await expectLevel(page, page.getByTestId('list-filter-picker'), 1, theme)
    })

    test('a picker from Edit list is level 2; Edit list itself level 1', async ({ page }) => {
      await wsListWidget(page, 't1').getByTestId('list-summary').click()
      const editList = page.getByTestId('edit-list')
      await expectLevel(page, editList, 1, theme)
      await editList.getByTestId('list-filter-chip').click()
      await expectLevel(page, page.getByTestId('list-filter-picker'), 2, theme)
    })

    test('a menu in Settings is level 2', async ({ page }) => {
      const settings = await openSettings(page, 'Tasks')
      await settings.getByTestId('lens-list').getByRole('button', { name: /^Has a person/ }).click()
      await settings.getByRole('button', { name: ADD_FILTER }).first().click()
      await expectLevel(page, page.getByRole('menu', { name: 'Add a filter' }), 2, theme)
    })
  })
}
