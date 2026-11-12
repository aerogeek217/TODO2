import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, type Browser, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { openFilterPicker } from './fixtures/filters'
import { layoutTab, pickInReview, wsCell } from './fixtures/workspace'

/**
 * Not a regression: screenshots of most of the app's screens over the dev
 * seed, at 1440 × 900, 1920 × 1080 and 390 × 844 in both themes, for a
 * before / after comparison of a styling change (UX cleanup 5A: type and
 * targets). Runs only with `TYPE_SHOTS=<folder>`; the seed is
 * `TYPE_SHOTS_SEED` (default `dev-data/seed-v79.json`, `npm run seed:dev`).
 * Ambience is off and motion reduced, so an unchanged tree gives the same
 * pictures on the same day (the seed's dates are relative to the day it was
 * written; a fixed clock would make the app read its stored dates as foreign
 * `Date`s and repair every layout). A screen that can't be opened is logged and skipped.
 */
const OUT = process.env.TYPE_SHOTS
test.skip(!OUT, 'set TYPE_SHOTS=<folder> to take the screenshots')
test.describe.configure({ mode: 'parallel' })
// Each test makes its own contexts (sizes, touch); a trace on them only gets in the way.
test.use({ trace: 'off' })
test.setTimeout(15 * 60_000)

const SEED_PATH = process.env.TYPE_SHOTS_SEED ?? 'dev-data/seed-v79.json'

/** The heavy task: people, tags, due, notes, subtasks and status updates. */
const HEAVY_TASK = 69

type Theme = 'dark' | 'light'
interface Size { name: string; width: number; height: number; phone: boolean }
const SIZES: Size[] = [
  { name: '1440', width: 1440, height: 900, phone: false },
  { name: '1920', width: 1920, height: 1080, phone: false },
  { name: '390', width: 390, height: 844, phone: true },
]

/** The dev seed, plus a "Shots" layout: one list at each zoom, a Review widget under them. */
function seedText(): string {
  const data = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as Record<string, unknown> & {
    layouts: Array<Record<string, unknown>>
    listDefinitions: Array<Record<string, unknown>>
  }
  const base = data.listDefinitions.find((d) => d.id === 6) ?? data.listDefinitions[0]!
  const maxId = Math.max(...data.listDefinitions.map((d) => Number(d.id)))
  const ids = [maxId + 1, maxId + 2, maxId + 3]
  ids.forEach((id, i) => data.listDefinitions.push({ ...base, id, name: `${String(base.name)} ${['A', 'B', 'C'][i]}`, owner: { layoutId: 3 } }))
  const zooms = ['stacked', 'rows', 'lines'] as const
  data.layouts.push({
    id: 3,
    name: 'Shots',
    sortOrder: 2,
    grid: {
      columns: [{ id: 's-c1', weight: 333 }, { id: 's-c2', weight: 333 }, { id: 's-c3', weight: 334 }],
      rows: [{ id: 's-r1', weight: 340 }, { id: 's-r2', weight: 660 }],
    },
    cells: [
      ...zooms.map((zoom, i) => ({
        id: `s-${zoom}`,
        tabs: [{ id: `s-tab-${zoom}`, kind: 'lens', config: { listDefinitionId: ids[i] }, viewState: { zoom } }],
        activeTabId: `s-tab-${zoom}`,
        area: { col: i, row: 0, colSpan: 1, rowSpan: 1 },
      })),
      {
        id: 's-review',
        tabs: [{ id: 's-tab-review', kind: 'review', config: {} }],
        activeTabId: 's-tab-review',
        area: { col: 0, row: 1, colSpan: 3, rowSpan: 1 },
      },
    ],
    createdAt: '2026-11-01T10:00:00.000Z',
    modifiedAt: '2026-11-01T10:00:00.000Z',
    lastUsedAt: '2026-11-01T10:00:00.000Z',
  })
  return JSON.stringify(data)
}

async function store<T>(page: Page, path: string, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(async ({ path, fn, args }) => {
    const mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>
    const parts = fn.split('.')
    let target: unknown = mod
    for (const p of parts.slice(0, -1)) target = (target as Record<string, unknown>)[p]
    const holder = typeof (target as { getState?: unknown }).getState === 'function' ? (target as { getState: () => Record<string, unknown> }).getState() : target as Record<string, unknown>
    const f = holder[parts.at(-1)!] as (...a: unknown[]) => unknown
    return (await f(...args)) as never
  }, { path, fn, args }) as Promise<T>
}

const ui = (page: Page, fn: string, ...args: unknown[]) => store(page, '/src/stores/ui-store.ts', `useUIStore.${fn}`, ...args)

async function boot(page: Page, size: Size): Promise<void> {
  await page.locator('[data-ws-cell]').first().waitFor({ state: 'visible', timeout: 60_000 })
  if (!size.phone) await page.locator('[data-todo-id]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await layoutSettled(page)
}

/** Waits until nothing in the top bar or the workspace has moved for half a second (the bar centres its group after load). */
async function layoutSettled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __shotsLast?: string; __shotsSince?: number }
    const els = Array.from(document.querySelectorAll('header *, [data-ws-cell]')).slice(0, 400)
    const sig = els.map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}` }).join(';')
    const now = performance.now()
    if (sig !== w.__shotsLast) { w.__shotsLast = sig; w.__shotsSince = now; return false }
    return now - (w.__shotsSince ?? now) > 500
  }, null, { timeout: 90_000, polling: 100 })
}

async function setup(browser: Browser, size: Size, theme: Theme, text: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    deviceScaleFactor: 1,
    hasTouch: size.phone,
    isMobile: size.phone,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  page.setDefaultTimeout(10_000)
  await page.goto('/#/')
  // A browser just launched can take a while to draw its first frame: wait for one.
  await page.waitForFunction(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))), null, { timeout: 180_000 })
  // A fresh browser opens on an empty layout: wait for the shell.
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (json) => {
    const files = (await import(/* @vite-ignore */ '/src/services/data-files.ts' as string)) as {
      readImportFile: (f: File) => Promise<{ ok: boolean; data?: unknown; error?: string }>
    }
    const restore = (await import(/* @vite-ignore */ '/src/data/restore.ts' as string)) as { restoreFromImportData: (d: unknown) => Promise<void> }
    const r = await files.readImportFile(new File([json], 'seed.json', { type: 'application/json' }))
    if (!r.ok) throw new Error(`seed import failed: ${r.error}`)
    await restore.restoreFromImportData(r.data)
  }, text)
  await page.reload()
  await page.locator('[data-ws-cell]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await store(page, '/src/stores/settings-store.ts', 'useSettingsStore.setThemeMode', theme)
  await store(page, '/src/stores/settings-store.ts', 'useSettingsStore.setAmbience', { enabled: false })
  // Warm up: the first full load of every module the workspace draws.
  await page.reload()
  await page.locator('[data-ws-cell]').first().waitFor({ state: 'visible', timeout: 120_000 })
  if (!size.phone) await page.locator('[data-todo-id]').first().waitFor({ state: 'visible', timeout: 120_000 })
  return { context, page }
}

/** `TYPE_SHOTS_SWEEP=1`: also list each screen's form controls with their computed font size and their parent's. */
const SWEEP = !!process.env.TYPE_SHOTS_SWEEP
interface ControlSize { tag: string; cls: string; text: string; size: string; parent: string; w: number; h: number; ownText: boolean }

async function controlSizes(page: Page): Promise<ControlSize[]> {
  return page.evaluate(() => {
    const out: Array<{ tag: string; cls: string; text: string; size: string; parent: string; w: number; h: number; ownText: boolean }> = []
    for (const el of Array.from(document.querySelectorAll('button, input, select, textarea'))) {
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      const parent = el.parentElement ? getComputedStyle(el.parentElement).fontSize : ''
      const own = getComputedStyle(el).fontSize
      // Is any of its text (or a 1em icon) drawn at the control's own size?
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
      let ownText = false
      for (let n = walker.nextNode(); n && !ownText; n = walker.nextNode()) {
        if (n.nodeType === Node.TEXT_NODE) ownText = !!n.textContent?.trim() && getComputedStyle(n.parentElement!).fontSize === own
        else if ((n as Element).tagName.toLowerCase() === 'svg') ownText = (n as Element).getAttribute('width') === '1em' && getComputedStyle(n as Element).fontSize === own
      }
      if ((el as HTMLInputElement).value && /^(text|search|date|number|)$/.test((el as HTMLInputElement).type ?? '')) ownText = true
      out.push({
        tag: el.tagName.toLowerCase() + ((el as HTMLInputElement).type ? `[${(el as HTMLInputElement).type}]` : ''),
        cls: (el.getAttribute('class') ?? '').slice(0, 120),
        text: ((el as HTMLElement).innerText || el.getAttribute('aria-label') || (el as HTMLInputElement).placeholder || '').slice(0, 40).replace(/\s+/g, ' '),
        size: getComputedStyle(el).fontSize,
        parent,
        w: Math.round(r.width),
        h: Math.round(r.height),
        ownText,
      })
    }
    return out
  })
}

async function settle(page: Page): Promise<void> {
  await layoutSettled(page)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

for (const size of SIZES) {
  for (const theme of ['dark', 'light'] as const) {
    test(`shots ${size.name} ${theme}`, async ({ browser }) => {
      const dir = OUT!
      mkdirSync(dir, { recursive: true })
      const { context, page } = await setup(browser, size, theme, seedText())
      const failed: string[] = []
      const sweep: Record<string, ControlSize[]> = {}

      /** Reload onto the workspace (layout `layout`), run `open`, take `<name>-<size>-<theme>.png`. */
      const shot = async (name: string, open: () => Promise<void>, { layout = 'Default', clip, keepMouse = false }: { layout?: string; clip?: () => Promise<Locator>; keepMouse?: boolean } = {}) => {
        try {
          if (!page.url().endsWith('#/')) await page.goto('/#/')
          await page.reload()
          await boot(page, size)
          if (!size.phone) {
            const tab = layoutTab(page, layout)
            if (await tab.getAttribute('aria-selected') !== 'true') await tab.click({ force: true })
            await page.locator('[data-testid="layout-tab"][aria-selected="true"]').filter({ hasText: layout }).waitFor()
            await page.locator('[data-todo-id], [data-review-widget]').first().waitFor({ state: 'visible' })
          }
          if (!keepMouse) await page.mouse.move(1, size.height - 1)
          await open()
          if (!keepMouse) await page.mouse.move(1, size.height - 1)
          await settle(page)
          if (SWEEP) sweep[name] = await controlSizes(page)
          const path = join(dir, `${name}-${size.name}-${theme}.png`)
          if (clip) {
            const target = await clip()
            await target.screenshot({ path, animations: 'disabled', caret: 'hide' })
          } else {
            await page.screenshot({ path, animations: 'disabled', caret: 'hide' })
          }
        } catch (err) {
          failed.push(`${name}: ${err instanceof Error ? err.message.split('\n').slice(0, 8).join(' | ') : String(err)}`)
          await page.screenshot({ path: join(dir, `_failed-${name}-${size.name}-${theme}.png`) }).catch(() => {})
        }
      }

      if (!size.phone) {
        await shot('ws-default', async () => {})
        await shot('ws-planning', async () => {}, { layout: 'Planning' })
        await shot('ws-zooms', async () => {}, { layout: 'Shots' })
        await shot('review-widget', async () => {
          await pickInReview(page, 's-tab-review', 'Priya')
          await page.locator('[data-review-widget="s-tab-review"] [data-todo-id], [data-review-widget="s-tab-review"]').first().waitFor()
        }, { layout: 'Shots' })
        await shot('task-editor', async () => {
          await ui(page, 'openEditPopup', HEAVY_TASK)
          await page.getByRole('dialog').first().waitFor()
        })
        await shot('task-new', async () => {
          await ui(page, 'openCreatePopup')
          await page.getByRole('dialog').first().waitFor()
        })
        await shot('edit-list', async () => {
          await ui(page, 'openListEditor', 5, 'tab-someday')
          await page.getByRole('dialog').first().waitFor()
        }, { layout: 'Planning' })
        await shot('number-editor', async () => {
          await ui(page, 'openNumberEditor', 'tab-open')
          await page.getByRole('dialog').first().waitFor()
        })
        await shot('chart-editor', async () => {
          await store(page, '/src/stores/chart-widgets-store.ts', 'useChartWidgetsStore.openEditor', 'tab-status')
          await page.getByRole('dialog').first().waitFor()
        })
        await shot('filter-people', async () => {
          await openFilterPicker(page, 'People')
          await page.waitForTimeout(0)
        }, { keepMouse: true })
        await shot('filter-dates', async () => {
          await openFilterPicker(page, 'Dates')
        }, { keepMouse: true })
        await shot('filter-menu', async () => {
          await page.getByRole('button', { name: /^Filter/ }).first().click()
        }, { keepMouse: true })
        await shot('palette', async () => {
          await page.keyboard.press('Control+k')
          await page.getByRole('listbox').waitFor()
        })
        await shot('palette-step', async () => {
          await page.keyboard.press('Control+k')
          const field = page.getByPlaceholder(/Find tasks, commands|Type to filter/)
          await field.fill('Theme')
          await page.getByRole('option', { name: /Theme/ }).first().click()
          await page.getByTestId('command-palette-crumb').waitFor()
        })
        await shot('quick-add', async () => {
          await ui(page, 'openQuickAdd')
          const input = page.getByPlaceholder('New task…')
          await input.waitFor()
          await input.pressSequentially('Call the vendor tomorrow #urgent @Pri')
          await page.waitForTimeout(300)
        })
        await shot('filtered-panel', async () => {
          await page.getByPlaceholder('Filter…').fill('billing')
          await ui(page, 'openFilterPanel')
          await page.waitForTimeout(300)
        })
        await shot('storage-pill', async () => {
          await page.getByTestId('storage-pill').click()
          await page.getByRole('dialog').first().waitFor()
        })
        for (const section of ['Database', 'Appearance', 'Tasks', 'People, statuses & tags', 'Keyboard shortcuts', 'About']) {
          await shot(`settings-${section.split(/[ ,]/)[0]!.toLowerCase()}`, async () => {
            await page.getByRole('button', { name: 'Settings', exact: true }).click()
            const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
            await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click()
            await dialog.getByRole('heading', { level: 2, name: section }).waitFor()
          })
        }
        await shot('checkin', async () => {
          await ui(page, 'openCheckinDialog', [1])
          await page.getByRole('dialog').first().waitFor()
          await page.waitForTimeout(300)
        })
        await shot('cell-options', async () => {
          await wsCell(page, 'cell-person').hover()
          await wsCell(page, 'cell-person').getByRole('button', { name: 'Cell options' }).click()
          await page.getByRole('menu').first().waitFor()
        }, { keepMouse: true })
        await shot('cell-layout', async () => {
          await wsCell(page, 'cell-person').hover()
          await wsCell(page, 'cell-person').getByRole('button', { name: 'Cell layout' }).click()
          await page.getByRole('menu', { name: 'Cell layout' }).waitFor()
        }, { keepMouse: true })
        await shot('tab-strip', async () => {
          await wsCell(page, 'cell-focus').hover()
        }, { keepMouse: true, clip: async () => wsCell(page, 'cell-focus') })
        await shot('top-bar', async () => {}, { clip: async () => page.locator('header').first() })
      } else {
        await shot('ws', async () => {})
        await shot('ws-scrolled', async () => {
          await page.mouse.move(size.width / 2, size.height / 2)
          await page.mouse.wheel(0, 900)
          await page.waitForTimeout(300)
        })
        await shot('filter-sheet', async () => {
          await ui(page, 'setFilterSheetOpen', true)
          await page.getByRole('dialog').first().waitFor()
          await page.waitForTimeout(300)
        })
        await shot('task-sheet', async () => {
          await ui(page, 'openEditPopup', HEAVY_TASK)
          await page.getByRole('dialog').first().waitFor()
          await page.waitForTimeout(300)
        })
        await shot('sync-sheet', async () => {
          await page.getByTestId('sync-status-button').click()
          await page.getByRole('dialog').first().waitFor()
          await page.waitForTimeout(300)
        })
        await shot('settings', async () => {
          await page.goto('/#/settings')
          await page.getByRole('heading').first().waitFor()
          await page.waitForTimeout(300)
        })
        await shot('quick-add', async () => {
          await ui(page, 'openQuickAdd')
          const input = page.getByPlaceholder('New task…')
          await input.waitFor()
          await input.pressSequentially('Call the vendor tomorrow #urgent @Pri')
          await page.waitForTimeout(300)
        })
      }
      await context.close()
      if (SWEEP) writeFileSync(join(dir, `sweep-${size.name}-${theme}.json`), JSON.stringify(sweep, null, 1))
      if (failed.length) console.log(`[type-shots ${size.name} ${theme}] skipped:\n  ${failed.join('\n  ')}`)
    })
  }
}
