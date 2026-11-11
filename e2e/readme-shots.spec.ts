import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test, type Browser, type Locator, type Page } from '@playwright/test'
import { EDITOR_TASK, README_IDS, REVIEW_PERSON, readmeData } from './fixtures/readme-data'

/**
 * Not a regression: the README's screenshots (`docs/screenshots/`), over a
 * small purpose-made dataset (`fixtures/readme-data`), in the dark theme at
 * 2× pixels. Runs only with `README_SHOTS=1` (or `README_SHOTS=<folder>` to
 * write elsewhere):
 *
 *   README_SHOTS=1 npx playwright test e2e/readme-shots.spec.ts --workers=1 --timeout=600000
 *
 * Motion is reduced and the ambience is off except in the hero, where its
 * still sky shows over the top bar (it follows the time of day it is taken).
 */
const OUT_ENV = process.env.README_SHOTS
test.skip(!OUT_ENV, 'set README_SHOTS=1 to take the README screenshots')
test.use({ trace: 'off' })
test.setTimeout(15 * 60_000)

const OUT = OUT_ENV === '1' ? 'docs/screenshots' : (OUT_ENV ?? 'docs/screenshots')

/** What the Quick Add shot types: a tag, a due date, and a person still being typed for the autocomplete. */
const QUICK_ADD_TEXT = 'Send revised contract to legal #vendor /due fri @Pri'

async function call<T>(page: Page, path: string, fn: string, ...args: unknown[]): Promise<T> {
  return page.evaluate(async ({ path, fn, args }) => {
    const mod = (await import(/* @vite-ignore */ path)) as Record<string, unknown>
    const parts = fn.split('.')
    let target: unknown = mod
    for (const p of parts.slice(0, -1)) target = (target as Record<string, unknown>)[p]
    const holder = typeof (target as { getState?: unknown }).getState === 'function'
      ? (target as { getState: () => Record<string, unknown> }).getState()
      : target as Record<string, unknown>
    const f = holder[parts.at(-1)!] as (...a: unknown[]) => unknown
    return (await f(...args)) as never
  }, { path, fn, args }) as Promise<T>
}

const ui = (page: Page, fn: string, ...args: unknown[]) => call(page, '/src/stores/ui-store.ts', `useUIStore.${fn}`, ...args)
const settings = (page: Page, fn: string, ...args: unknown[]) => call(page, '/src/stores/settings-store.ts', `useSettingsStore.${fn}`, ...args)

/** Waits until nothing in the top bar or the workspace has moved for half a second. */
async function settled(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const w = window as unknown as { __rsLast?: string; __rsSince?: number }
    const els = Array.from(document.querySelectorAll('header *, [data-ws-cell], [role="dialog"] *')).slice(0, 600)
    const sig = els.map((el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}` }).join(';')
    const now = performance.now()
    if (sig !== w.__rsLast) { w.__rsLast = sig; w.__rsSince = now; return false }
    return now - (w.__rsSince ?? now) > 500
  }, null, { timeout: 90_000, polling: 100 })
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  })
}

/** Fresh page on the workspace with the dataset imported, dark theme, `ambience` on or off. */
async function open(page: Page, { ambience }: { ambience: boolean }): Promise<void> {
  await page.goto('/#/')
  // A browser just launched can take a while to draw its first frame: wait for one.
  await page.waitForFunction(() => new Promise((resolve) => requestAnimationFrame(() => resolve(true))), null, { timeout: 280_000 })
  await page.waitForFunction(() => (document.querySelector('#root')?.childElementCount ?? 0) > 0, null, { timeout: 60_000 })
  await page.waitForLoadState('networkidle')
  await page.evaluate(async (json) => {
    const files = (await import(/* @vite-ignore */ '/src/services/data-files.ts' as string)) as {
      readImportFile: (f: File) => Promise<{ ok: boolean; data?: unknown; error?: string }>
    }
    const restore = (await import(/* @vite-ignore */ '/src/data/restore.ts' as string)) as { restoreFromImportData: (d: unknown) => Promise<void> }
    const r = await files.readImportFile(new File([json], 'readme.json', { type: 'application/json' }))
    if (!r.ok) throw new Error(`import failed: ${r.error}`)
    await restore.restoreFromImportData(r.data)
  }, JSON.stringify(readmeData()))
  await page.reload()
  await page.locator('[data-ws-cell]').first().waitFor({ state: 'visible', timeout: 60_000 })
  await settings(page, 'setThemeMode', 'dark')
  await settings(page, 'setAmbience', { enabled: ambience })
  await page.reload()
  await page.locator('[data-todo-id]').first().waitFor({ state: 'visible', timeout: 120_000 })
  await page.mouse.move(2, 2)
  await settled(page)
}

async function layout(page: Page, name: string): Promise<void> {
  const tab = page.locator('[data-testid="layout-tab"]').filter({ hasText: name })
  if (await tab.getAttribute('aria-selected') !== 'true') await tab.click()
  await page.locator('[data-testid="layout-tab"][aria-selected="true"]').filter({ hasText: name }).waitFor()
  await page.mouse.move(2, 2)
  await settled(page)
}

const cell = (page: Page, id: string) => page.locator(`[data-ws-cell="${id}"]`)

/**
 * Screenshots the box around `targets`, `pad` CSS px larger on each side,
 * kept inside the viewport and below the top bar (whose bottom edge would
 * show as a stray line over a cell).
 */
async function shoot(page: Page, name: string, targets: Locator[], pad = 16): Promise<void> {
  const boxes = await Promise.all(targets.map(async (t) => {
    const b = await t.boundingBox()
    if (!b) throw new Error(`${name}: a target has no box`)
    return b
  }))
  const vp = page.viewportSize()!
  const bar = await page.locator('header').first().boundingBox()
  const top = bar ? bar.y + bar.height + 1 : 0
  const x0 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad)
  const y0 = Math.max(top, Math.min(...boxes.map((b) => b.y)) - pad)
  const x1 = Math.min(vp.width, Math.max(...boxes.map((b) => b.x + b.width)) + pad)
  const y1 = Math.min(vp.height, Math.max(...boxes.map((b) => b.y + b.height)) + pad)
  await page.screenshot({ path: join(OUT, `${name}.png`), clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, animations: 'disabled', caret: 'hide' })
}

test.describe.configure({ mode: 'serial' })

test.beforeAll(() => { mkdirSync(OUT, { recursive: true }) })

/**
 * A page of its own size: each shot picks the viewport that frames its subject.
 * PNGs stay at most 1800 px wide, so a 2× shot frames at most 900 CSS px.
 */
async function withPage(browser: Browser, width: number, height: number, scale: number, ambience: boolean, run: (page: Page) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: 'reduce' })
  try {
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    await open(page, { ambience })
    await run(page)
  } finally {
    await context.close()
  }
}

async function idOf(page: Page, store: 'todo' | 'person', name: string): Promise<number> {
  return page.evaluate(async ({ store, name }) => {
    if (store === 'todo') {
      const mod = (await import(/* @vite-ignore */ '/src/stores/todo-store.ts' as string)) as { useTodoStore: { getState: () => { todos: Array<{ id: number; title: string }> } } }
      return mod.useTodoStore.getState().todos.find((t) => t.title === name)?.id ?? 0
    }
    const mod = (await import(/* @vite-ignore */ '/src/stores/person-store.ts' as string)) as { usePersonStore: { getState: () => { people: Array<{ id: number; name: string }> } } }
    return mod.usePersonStore.getState().people.find((p) => p.name === name)?.id ?? 0
  }, { store, name })
}

// The hero: the whole window. 1280 × 760 at 1.4× keeps it under 1800 px wide.
test('workspace', async ({ browser }) => {
  await withPage(browser, 1280, 760, 1.4, true, async (page) => {
    await page.screenshot({ path: join(OUT, 'workspace.png'), animations: 'disabled', caret: 'hide' })
  })
})

test('list', async ({ browser }) => {
  await withPage(browser, 1150, 780, 2, false, async (page) => {
    await shoot(page, 'list', [cell(page, README_IDS.cells.list)], 4)
  })
})

// The task editor has no shot of its own: the review deck's card is the same layout.
test('review', async ({ browser }) => {
  await withPage(browser, 1080, 860, 1.65, false, async (page) => {
    await layout(page, 'Planning')
    const id = await idOf(page, 'person', REVIEW_PERSON)
    await page.evaluate(async ({ id, name }) => {
      const mod = (await import(/* @vite-ignore */ '/src/services/review.ts' as string)) as {
        openReview: (p: unknown) => boolean
        personReview: (p: { id: number; name: string }) => unknown
      }
      mod.openReview(mod.personReview({ id, name }))
    }, { id, name: REVIEW_PERSON })
    const deck = page.getByRole('dialog').first()
    await deck.waitFor()
    // Step to the task with notes, subtasks and updates (the queue opens on its first task).
    const row = deck.locator('[data-review-row]').filter({ hasText: EDITOR_TASK })
    await row.click()
    await row.and(page.locator('[aria-current="true"]')).waitFor()
    await page.mouse.move(2, 2)
    await settled(page)
    await shoot(page, 'review', [deck], 6)
  })
})

test('insights', async ({ browser }) => {
  await withPage(browser, 880, 720, 2, false, async (page) => {
    await layout(page, 'Planning')
    const C = README_IDS.cells
    await shoot(page, 'insights', [...C.planningNumbers.map((c) => cell(page, c)), cell(page, C.breakdown), cell(page, C.trend)], 4)
  })
})

test('quick add', async ({ browser }) => {
  await withPage(browser, 1280, 720, 2, false, async (page) => {
    await ui(page, 'openQuickAdd')
    const input = page.getByPlaceholder('New task…')
    await input.waitFor()
    await input.pressSequentially(QUICK_ADD_TEXT, { delay: 30 })
    await page.waitForTimeout(500)
    await settled(page)
    await shoot(page, 'quick-add', [page.getByRole('dialog', { name: 'Quick add task' }), page.getByRole('listbox').first()], 28)
  })
})
