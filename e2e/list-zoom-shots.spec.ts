import { test, type Page } from '@playwright/test'
import { seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Not a regression: screenshots of one grouped list at each zoom level
 * (D25 C + I1), dark, plus Stacked and Lines in light, for a design review.
 * Runs only with `LIST_ZOOM_SHOTS=<folder>` (the screenshots go there).
 */
const OUT = process.env.LIST_ZOOM_SHOTS
test.skip(!OUT, 'set LIST_ZOOM_SHOTS=<folder> to take the zoom screenshots')

const NOW = new Date(2026, 10, 6, 10, 30)

const TITLES = [
  'Migrate billing jobs to the new cluster', 'Q4 budget reforecast', 'Go-live checklist sign-off',
  'Set up shadowing for the new hire', 'Renew the vendor security review', 'Update the on-call rotation doc',
  'Collect signed travel forms', 'Draft release notes for 4.2', 'Map Northwind integration points',
  'Prepare guest list for the offsite', 'Send interview feedback', 'Reconcile September invoices',
]

const TASKS: NonNullable<WorkspaceSeed['tasks']> = TITLES.flatMap((t, i) => [
  {
    title: t,
    people: [['Aisha', 'Ben', 'Cy'][i % 3] ?? 'Aisha', ...(i % 4 === 0 ? ['Dana'] : [])],
    tags: i % 2 === 0 ? ['docs'] : ['customer', 'q4'],
    dueInDays: [-3, 0, 2, 9, 20, undefined][i % 6],
    followupInDays: i % 5 === 0 ? -2 : i % 3 === 0 ? 4 : undefined,
    subtasks: i % 4 === 1 ? [{ title: 'a', done: true }, { title: 'b' }, { title: 'c' }] : undefined,
    urgent: i % 7 === 0,
    important: i % 5 === 2,
    modifiedInDays: i % 6 === 5 ? -45 : undefined,
  },
])

function seed(zoom: 'stacked' | 'rows' | 'lines'): WorkspaceSeed {
  return {
    people: ['Aisha', 'Ben', 'Cy', 'Dana'],
    tags: ['docs', 'customer', 'q4'],
    tasks: TASKS,
    listDefinitions: [{ name: 'All open', grouping: 'people', sort: 'deadline' }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0, zoom }] }] }] }],
  }
}

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
}

test.use({ viewport: { width: 760, height: 820 } })

for (const zoom of ['stacked', 'rows', 'lines'] as const) {
  for (const theme of ['dark', 'light'] as const) {
    if (theme === 'light' && zoom === 'rows') continue
    test(`${zoom} · ${theme}`, async ({ page }) => {
      // No theme cross-fade mid-shot.
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.clock.setFixedTime(NOW)
      await seedWorkspace(page, seed(zoom))
      await setTheme(page, theme)
      const widget = wsListWidget(page, 'tasks')
      await widget.waitFor({ state: 'visible' })
      await page.mouse.move(2, 2)
      await page.screenshot({ path: `${OUT}/zoom-${zoom}-${theme}.png` })
    })
  }
}
