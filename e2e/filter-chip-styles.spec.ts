import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import LOOKS from './fixtures/filter-chip-looks.json' with { type: 'json' }

/**
 * The filter chips look the same wherever they render — a list widget's
 * filter row (desktop and phone) and the Edit list form — in both themes:
 * computed styles of the list chip, its label and × button, + Filter, the
 * screen-filter chip and the group · sort summary, pinned to their values
 * (`fixtures/filter-chip-looks.json`, recorded before the chips' styles moved).
 */

const SEED: WorkspaceSeed = {
  people: ['Alice'],
  listDefinitions: [{ name: 'Team', people: ['Alice'], grouping: 'people' }],
  tasks: [{ title: 'A task', people: ['Alice'] }],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const PROPS = ['height', 'padding', 'border-radius', 'font-size', 'font-weight', 'line-height', 'background-color', 'color', 'box-shadow', 'gap', 'cursor'] as const

async function look(el: Locator): Promise<Record<string, string>> {
  return el.evaluate((node, props) => {
    const cs = getComputedStyle(node)
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]))
  }, [...PROPS])
}

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts')) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** Turns on a screen filter (the top bar's People: Alice) so the screen chip shows. */
async function screenFilterOn(page: Page) {
  await page.evaluate(async () => {
    const people = (await import(/* @vite-ignore */ '/src/stores/person-store.ts')) as {
      usePersonStore: { getState: () => { people: Array<{ id?: number; name: string }> } }
    }
    const filters = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts')) as {
      useFilterStore: { getState: () => { setPersonIds: (ids: Set<number> | null) => void } }
    }
    const alice = people.usePersonStore.getState().people.find((x) => x.name === 'Alice')
    if (alice?.id != null) filters.useFilterStore.getState().setPersonIds(new Set([alice.id]))
  })
}

async function rowLooks(row: Locator) {
  const chip = row.getByTestId('list-filter-chip').first()
  return {
    chip: await look(chip),
    label: await look(chip.locator('span').first()),
    remove: await look(chip.getByRole('button', { name: 'Remove filter' })),
    add: await look(row.getByRole('button', { name: /Filter/ }).last()),
  }
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.describe('desktop', () => {
      test.use({ viewport: { width: 1280, height: 800 } })

      test('list filter row and the Edit list form', async ({ page }) => {
        await seedWorkspace(page, SEED)
        await setTheme(page, theme)
        await screenFilterOn(page)
        const row = page.getByTestId('list-filter-row')
        await expect(row.getByTestId('list-filter-chip')).toHaveCount(1)
        const widget = await rowLooks(row)
        const screenChip = await look(row.locator('[class*="screenChip"]').first())
        const summary = await look(row.locator('[class*="summary"]').first())
        expect({ ...widget, screenChip, summary }).toEqual(LOOKS[`${theme} desktop-row`])

        await wsTab(page, 'list').click({ button: 'right' })
        await page.getByRole('menuitem', { name: 'Edit list…' }).click()
        const form = page.getByRole('dialog', { name: /Edit list:/ })
        await expect(form.getByTestId('list-filter-chip')).toHaveCount(1)
        const formLooks = await rowLooks(form)
        expect(formLooks).toEqual(LOOKS[`${theme} form`])
      })
    })

    test.describe('phone', () => {
      test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

      test('list filter row', async ({ page }) => {
        await seedWorkspace(page, SEED)
        await setTheme(page, theme)
        await screenFilterOn(page)
        const row = page.getByTestId('list-filter-row')
        await expect(row.getByTestId('list-filter-chip')).toHaveCount(1)
        const widget = await rowLooks(row)
        const screenChip = await look(row.locator('[class*="screenChip"]').first())
        const summary = await look(row.locator('[class*="summary"]').first())
        expect({ ...widget, screenChip, summary }).toEqual(LOOKS[`${theme} phone-row`])
      })
    })
  })
}
