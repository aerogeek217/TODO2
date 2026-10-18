import { expect, test, type Locator, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Native `<select>` drop-downs are readable in both themes: every option is
 * painted on the opaque surface colour with the primary text colour (the
 * selects themselves sit on translucent fills, which the open list can't
 * show), from the one global rule in `tokens.css`.
 */

const SEED: WorkspaceSeed = {
  listDefinitions: [{ name: 'Team' }],
  tasks: [{ title: 'A task' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c', cells: [{ id: 'k', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** Each option's computed background and text colour, next to the theme's surface / text colours. */
async function optionColours(scope: Locator) {
  return scope.locator('select').evaluateAll((selects) => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--color-surface)'
    probe.style.color = 'var(--color-text-primary)'
    document.body.append(probe)
    const want = { background: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color }
    probe.remove()
    const got = selects.flatMap((s) => Array.from((s as HTMLSelectElement).options, (o) => {
      const cs = getComputedStyle(o)
      return { background: cs.backgroundColor, color: cs.color }
    }))
    return { want, got }
  })
}

for (const theme of ['dark', 'light'] as const) {
  test(`${theme} theme: options in Settings read on the surface colour`, async ({ page }) => {
    await seedWorkspace(page, SEED)
    await setTheme(page, theme)

    const settings = await openSettings(page, 'Task defaults')
    const inSettings = await optionColours(settings)
    expect(inSettings.got.length).toBeGreaterThan(0)
    // The surface colour is opaque, so the open list never shows through to white.
    expect(inSettings.want.background).toMatch(/^rgb\(/)
    for (const o of inSettings.got) expect(o).toEqual(inSettings.want)
  })
}
