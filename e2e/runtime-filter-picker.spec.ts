import { expect, test, type Page } from '@playwright/test'
import { listInsetByIndex, seedCanvas } from './fixtures/seed'

/**
 * Phase 6 picker coverage: encodes the three RuntimeFilterPicker regressions
 * triage-2026-04-25 P3 (T2: portaled panel + viewport flip),
 * triage-2026-04-25 P? (T4: `/list` mount under a wrap that used to clip),
 * and triage-2026-04-25 P1 (T5: last-chip removal must clear in-memory filter).
 *
 * JSDOM is unauthoritative — the picker's portaled panel positioning rides
 * `usePopoverAnchor`'s `getBoundingClientRect` reads of the trigger element
 * and the viewport, which only resolve correctly under a real DOM. T5's
 * regression specifically needs Dexie's spread-merge semantics to round-trip
 * through `useListInsetStore.update` so an explicit `undefined` overwrites
 * a stale array — JSDOM IDB shims don't reproduce that.
 */

const VIEWPORT_HEIGHT = 800
const VIEWPORT_WIDTH = 1280

interface PanelGeom { left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * Finds the portaled `RuntimeFilterPicker` panel by walking up from a known
 * option button (one with `name` text) to the `document.body` direct child
 * that wraps it. The panel sets `position: fixed` inline + portals to body,
 * which uniquely identifies it among other portaled overlays in tests.
 */
async function findPanelRect(page: Page, optionName: string): Promise<PanelGeom | null> {
  return await page.evaluate((target) => {
    const buttons = Array.from(document.body.querySelectorAll('button[type="button"]'))
    for (const btn of buttons) {
      if (!btn.textContent?.includes(target)) continue
      let el: HTMLElement | null = btn as HTMLElement
      // Climb to the direct child of <body>.
      while (el && el.parentElement && el.parentElement !== document.body) {
        el = el.parentElement
      }
      if (!el) continue
      if (el.style.position !== 'fixed') continue
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return null
  }, optionName)
}

test.describe('RuntimeFilterPicker — viewport overflow (T2)', () => {
  test('panel flips above input when input is near viewport bottom', async ({ page }) => {
    // Position the list-inset so its runtime-filter input lands in the
    // lower 1/4 of the viewport. The default `bottom-start` placement would
    // overflow the bottom edge → `usePopoverAnchor`'s flip math should land
    // the panel above the input instead.
    //
    // Pixel math: viewport offset is `{x:50, y:50, zoom:1}` until the user
    // pans (it does not on initial mount). Inset at flow (320, 600) lands at
    // pixel (370, 650). WidgetHeader occupies ≈30 px → picker row top ≈ 680.
    // Input row sits at the picker-row baseline, so the input rect's
    // `bottom` is around y = 700-720; with the panel default-bottom-start,
    // panelTop = inputBottom + 4, panelTop + panelHeight clearly exceeds
    // VIEWPORT_HEIGHT (800) → flip fires.
    await seedCanvas(page, {
      people: [{ name: 'Ada' }, { name: 'Bob' }],
      listDefinitions: [{
        name: 'Person picker',
        membership: { kind: 'custom', predicate: emptyPredicate() },
        runtimeFilter: { field: 'person' },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 600, width: 320, height: 180 }],
    })

    const inset = listInsetByIndex(page)
    await expect(inset).toBeVisible()

    const input = page.locator('input[aria-label="Filter tasks by person"]')
    await expect(input).toBeVisible()
    // Open + close + reopen — the picker's option list grows from 0 to 2 rows
    // as person-store hydrates, but `usePopoverAnchor`'s compute fires only
    // on initial panel attach. Reopening after the people have loaded gives
    // compute a panelHeight that matches the rendered panel, so the
    // flip/clamp arithmetic uses the right size. (This is not strictly part
    // of the T2 regression but keeps the test deterministic on Chromium.)
    await input.click()
    await page.getByRole('button', { name: 'Ada' }).waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(50)
    await input.click()

    // Wait for the panel to mount + measure (`usePopoverAnchor` does a
    // double-pass: first render with INITIAL_STYLE, then a layout effect
    // commits real coords). Asserting on a present option button is the
    // simplest "panel mounted" signal.
    const adaOption = page.getByRole('button', { name: 'Ada' })
    await expect(adaOption).toBeVisible()

    const panelRect = await findPanelRect(page, 'Ada')
    expect(panelRect).not.toBeNull()
    if (!panelRect) return

    const vh = await page.evaluate(() => window.innerHeight)
    const vw = await page.evaluate(() => window.innerWidth)
    const inputBox = await input.boundingBox()
    expect(inputBox).not.toBeNull()
    if (!inputBox) return

    // Inside viewport (8 px margin per usePopoverAnchor).
    expect(panelRect.top).toBeGreaterThanOrEqual(8)
    expect(panelRect.bottom).toBeLessThanOrEqual(vh - 8)
    expect(panelRect.left).toBeGreaterThanOrEqual(8)
    expect(panelRect.right).toBeLessThanOrEqual(vw - 8)

    // Flip happened: panel is above the input rect.
    expect(panelRect.bottom).toBeLessThanOrEqual(inputBox.y + 1)
  })
})

test.describe('RuntimeFilterPicker — /list mount (T4)', () => {
  test('panel mounts and is visible when picker opens on /list', async ({ page }) => {
    // Seed: a favorited list def with a runtime filter on person + a person.
    // The favorites chip is the load path on /list; clicking it fires
    // `applyDefinition`, which sets `runtimeFilterSpec` → picker renders.
    await seedCanvas(page, {
      people: [{ name: 'Ada' }],
      listDefinitions: [{
        name: 'List view picker',
        favorited: true,
        membership: { kind: 'custom', predicate: emptyPredicate() },
        runtimeFilter: { field: 'person' },
      }],
    })

    // App.tsx mounts a HashRouter, so route paths live under the URL hash.
    // page.goto('/list') only changes the browser path and leaves the app
    // sitting on `#/` — switch the hash explicitly so ListView mounts.
    await page.goto('/#/list')
    // Click the favorite chip to load the def.
    await page.getByRole('button', { name: 'List view picker' }).click()

    const input = page.locator('input[aria-label="Filter tasks by person"]')
    await expect(input).toBeVisible()
    await input.click()

    // Panel mounts (option button visible) and panel rect is non-zero.
    const adaOption = page.getByRole('button', { name: 'Ada' })
    await expect(adaOption).toBeVisible()

    const panelRect = await findPanelRect(page, 'Ada')
    expect(panelRect).not.toBeNull()
    if (!panelRect) return
    expect(panelRect.width).toBeGreaterThan(0)
    expect(panelRect.height).toBeGreaterThan(0)
    // Pre-fix the wrap had `overflow: hidden`, which clipped the (then-inline)
    // panel; post-fix the panel portals to body so the rect is fully inside
    // the viewport regardless of the wrap.
    expect(panelRect.left).toBeGreaterThanOrEqual(8)
    expect(panelRect.right).toBeLessThanOrEqual(VIEWPORT_WIDTH - 8)
    expect(panelRect.top).toBeGreaterThanOrEqual(8)
    expect(panelRect.bottom).toBeLessThanOrEqual(VIEWPORT_HEIGHT - 8)
  })
})

test.describe('RuntimeFilterPicker — clear-last-chip (T5)', () => {
  test('picking a person then clearing the chip clears the persisted filter', async ({ page }) => {
    // Pre-fix: clearing the last chip relied on dropping a key from the
    // inset row, but `useListInsetStore.update` spread-merges so the prior
    // value survived. Post-fix the caller passes `undefined` explicitly to
    // overwrite the array. The regression repros only when both the picker
    // emits the empty state AND the store's IDB write retains the prior id —
    // both need a real DOM + Dexie to surface end-to-end.
    await seedCanvas(page, {
      people: [{ name: 'Ada' }],
      listDefinitions: [{
        name: 'Clear chip',
        membership: { kind: 'custom', predicate: emptyPredicate() },
        runtimeFilter: { field: 'person' },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 }],
    })

    const inset = listInsetByIndex(page)
    await expect(inset).toBeVisible()

    const input = page.locator('input[aria-label="Filter tasks by person"]')
    await expect(input).toBeVisible()
    await input.click()
    await page.getByRole('button', { name: 'Ada' }).click()

    // Chip mounted (the input wrapper now contains a chip with the picked
    // name + a × button). Verify a chip exists by querying for the
    // `Remove Ada` accessibility label.
    const removeChip = page.getByRole('button', { name: 'Remove Ada' })
    await expect(removeChip).toBeVisible()

    // Confirm the persisted shape carries the pick before we clear it.
    const beforeClear = await readInsetRuntimeFilter(page)
    expect(beforeClear).not.toBeUndefined()
    expect(Array.isArray(beforeClear)).toBe(true)
    expect((beforeClear as number[]).length).toBe(1)

    // Click the chip's × to clear the last (only) chip.
    await removeChip.click()

    // Chip removed from the DOM.
    await expect(page.getByRole('button', { name: 'Remove Ada' })).toHaveCount(0)

    // Persisted state cleared. Pre-fix this stayed as `[adaId]` because the
    // store's spread-merge preserved the prior key when the patch omitted
    // it; post-fix the caller passes `undefined` explicitly and Dexie strips
    // the field on `put`.
    await page.waitForTimeout(150)
    const afterClear = await readInsetRuntimeFilter(page)
    expect(afterClear).toBeUndefined()
  })
})

/** Reads `listInsets[0].runtimeFilterValue` from IDB. Returns `undefined` if the field is absent. */
async function readInsetRuntimeFilter(page: Page): Promise<number[] | undefined> {
  return await page.evaluate(async () => {
    return await new Promise<number[] | undefined>((resolve, reject) => {
      const r = indexedDB.open('todo2')
      r.onsuccess = () => {
        const idb = r.result
        const tx = idb.transaction(['listInsets'], 'readonly')
        const all = tx.objectStore('listInsets').getAll()
        all.onsuccess = () => {
          const row = (all.result as Array<{ runtimeFilterValue?: number[] }>)[0]
          resolve(row?.runtimeFilterValue)
          idb.close()
        }
        all.onerror = () => { reject(all.error); idb.close() }
      }
      r.onerror = () => reject(r.error)
    })
  })
}

/** Mirrors `emptyPredicate()` from `src/stores/list-definition-store.ts`. The
 *  test seed writes this directly to Dexie, so the shape must match the type. */
function emptyPredicate(): Record<string, unknown> {
  return {
    showCompleted: false,
    showHiddenStatuses: false,
    personIds: null,
    personFilterMode: 'include-orgs',
    orgIds: null,
    orgFilterMode: 'include-people',
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'date',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasScheduled: null,
    hasDeadline: null,
    tags: null,
  }
}
