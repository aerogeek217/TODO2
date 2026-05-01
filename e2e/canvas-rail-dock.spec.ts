import { expect, test, type Page } from '@playwright/test'
import {
  dragWidgetTo,
  floatingCalendarByIndex,
  floatingHorizonsByIndex,
  floatingNoteByIndex,
  floatingTaskboardByIndex,
  listInsetByIndex,
  railBySide,
  seedCanvas,
} from './fixtures/seed'

/**
 * Phase 6 canvas-coverage: float-widget → rail dock. Encodes the gesture
 * cluster from `float-dock-bugs-2026-04-25` (B1.empty + B1.collapsed-stub)
 * and `triage-2026-04-25 P5` (collapsed-rail stub registration).
 *
 * JSDOM is unauthoritative for this surface — the bug fixed at
 * `useFloatDragLifecycle.ts:249` (microtask-vs-render race on
 * `pointerRef.current`) only repros when React Flow runs its real drag
 * controller and `document.elementsFromPoint` walks a real DOM stack at
 * release coords. Both are non-functional under JSDOM.
 *
 * The drag itself rides Playwright's CDP-trusted `mouse.down`/`mouse.move`/
 * `mouse.up` so React Flow's drag detection fires; untrusted PointerEvents
 * synthesized via `dispatchEvent` do NOT trigger RF's drag controller (spike
 * confirmed via chrome-devtools MCP on 2026-04-26).
 */
test.describe('canvas float → rail dock (P6)', () => {
  test('drops a floating note onto an empty-side strip and docks as a new slot', async ({ page }) => {
    // Phase 6.5.1 split `useDefaultRails`'s hydration gate so persisted
    // rails honor settings without waiting on `listDefinitions` to load —
    // before that fix this test needed a no-op gate-opener def.
    await seedCanvas(page, {
      floatingNotes: [{ x: 320, y: 280, width: 280, height: 180 }],
    })

    await expect(floatingNoteByIndex(page)).toBeVisible()
    await expect(railBySide(page, 'left')).toHaveCount(0)

    // Float-drag the note onto the left empty-side strip. The strip is
    // invisible until DockOverlay renders mid-drag; we aim at viewport coords
    // known to fall inside the left-center sub-zone with the sidebar (~44 px
    // wide) and topbar (~73 px tall) accounted for. Empirically the strip
    // extends from x≈44 to x≈192 and y≈153 to ≈720; (100, 400) sits well
    // inside the center sub-zone (no corner claim).
    await dragWidgetTo(page, floatingNoteByIndex(page), { x: 100, y: 400 })

    // Float row deleted → its React Flow node unmounts; the dock reducer
    // installed a left rail with one notes slot. With no list-defs seeded
    // (post-6.5.1) `useDefaultRails`'s default seed does not fire either,
    // but the assertion scopes to the left rail anyway.
    await expect(floatingNoteByIndex(page)).toHaveCount(0)
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()
    await expect(leftRail.locator('[data-rails-drop-id^="rails:slot:"]')).toHaveCount(1)
  })

  test('drops a floating note onto an occupied slot body and merges as a new tab', async ({ page }) => {
    // Seed: a left rail with one calendar slot (expanded), plus a floating
    // note. Using calendar for the seed slot makes the post-dock tab kinds
    // unambiguous (the dropped float adds a `notes` tab beside `calendar`).
    // (The collapsed-stub variant of this gesture lives in the next test —
    // pre-6.5.2 it was occluded by the empty-side corner sub-zones and
    // could only be exercised against an expanded slot body.)
    await seedCanvas(page, {
      floatingNotes: [{ x: 600, y: 280, width: 280, height: 180 }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'seed-slot',
            tabs: [{ id: 'seed-tab', type: 'calendar' }],
            activeTabId: 'seed-tab',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await expect(floatingNoteByIndex(page)).toBeVisible()
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()

    // Aim the drag at the slot body's geometric center. `pointerToSplitZone`
    // resolves the center 50% × 50% region of a vertical-rail slot to
    // `'center'`, which `applyDockFloatIntoSlot` interprets as "append as
    // new tab" via `appendTabToSlot`.
    const slot = page.locator('[data-rails-drop-id="rails:slot:seed-slot"]')
    await expect(slot).toBeVisible()
    const slotBox = await slot.boundingBox()
    if (!slotBox) throw new Error('slot has no box')
    await dragWidgetTo(page, floatingNoteByIndex(page), {
      x: slotBox.x + slotBox.width / 2,
      y: slotBox.y + slotBox.height / 2,
    })

    // Float deleted; left rail still present; the existing slot now carries
    // both its seeded calendar tab and the docked notes tab.
    await expect(floatingNoteByIndex(page)).toHaveCount(0)
    await expect(leftRail).toBeVisible()
    // `settings.canvasRails` is persisted via `createDebouncedPersist`
    // (apply 150 ms, persist 500 ms) — wait past the persist window before
    // reading IDB so we observe the post-dock state, not the seeded state.
    await page.waitForTimeout(700)
    const railsState = await page.evaluate(async () => {
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const r = indexedDB.open('todo2')
        r.onsuccess = () => {
          const idb = r.result
          const tx = idb.transaction(['settings'], 'readonly')
          const get = tx.objectStore('settings').get('canvasRails')
          get.onsuccess = () => {
            const row = get.result as { value?: string } | undefined
            resolve(row?.value)
            idb.close()
          }
          get.onerror = () => { reject(get.error); idb.close() }
        }
        r.onerror = () => reject(r.error)
      })
      return value ? JSON.parse(value) : null
    })
    expect(railsState?.left?.slots?.length).toBe(1)
    expect(railsState?.left?.slots?.[0]?.tabs?.length).toBe(2)
    expect(railsState?.left?.slots?.[0]?.tabs?.map((t: { type: string }) => t.type).sort()).toEqual(['calendar', 'notes'])
  })

  test('drops a floating note onto a collapsed-rail slot stub and merges as a new tab (Phase 6.5.2)', async ({ page }) => {
    // Pre-6.5.2: the empty-side corner sub-zones clamped at `max(var(--…-size,
    // 0px), 80px)` and overshot a collapsed rail (28 px wide) by 52 px,
    // occluding its slot stubs from `document.elementsFromPoint`. A user
    // dragging a float onto the collapsed-rail stub got the corner-claim
    // outcome ("create perpendicular rail + claim corner") instead of the
    // slot-merge outcome ("dock as new tab on the existing slot").
    //
    // Post-fix: corner sub-zones size on `var(--…-size, 80px)` and
    // `RailsFrame.tsx` only emits the var when the rail exists, so the
    // 80 px fallback fires only on the perp-rail-absent case. With a
    // collapsed left rail the corner shrinks to exactly 28 px and the
    // stub is reachable below the corner's 60–80 px height band.
    await seedCanvas(page, {
      floatingNotes: [{ x: 600, y: 280, width: 280, height: 180 }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'collapsed-slot',
            tabs: [{ id: 'collapsed-tab', type: 'calendar' }],
            activeTabId: 'collapsed-tab',
          }],
        },
        right: null,
        top: null,
        bottom: null,
        collapsed: { left: true },
      },
    })

    await expect(floatingNoteByIndex(page)).toBeVisible()
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()

    // Target the slot stub's geometric center. Pre-6.5.2 the top_start corner
    // sub-zone clamped to 80 px wide × ~80 px tall and overshot the 28 px
    // collapsed rail, occluding the stub from `document.elementsFromPoint`.
    // Phase 6.5.2 added a resolver-side preference (slot > tab-strip >
    // empty-side) on top of the CSS narrowing fix, so even when the corner
    // overlay still covers the stub vertically the resolver picks the slot.
    const stub = page.locator('[data-rails-drop-id="rails:slot:collapsed-slot"]')
    await expect(stub).toBeVisible()
    const stubBox = await stub.boundingBox()
    if (!stubBox) throw new Error('stub has no box')
    await dragWidgetTo(page, floatingNoteByIndex(page), {
      x: stubBox.x + stubBox.width / 2,
      y: stubBox.y + stubBox.height / 2,
    })

    await expect(floatingNoteByIndex(page)).toHaveCount(0)
    await expect(leftRail).toBeVisible()
    await page.waitForTimeout(700)
    const railsState = await page.evaluate(async () => {
      const value = await new Promise<string | undefined>((resolve, reject) => {
        const r = indexedDB.open('todo2')
        r.onsuccess = () => {
          const idb = r.result
          const tx = idb.transaction(['settings'], 'readonly')
          const get = tx.objectStore('settings').get('canvasRails')
          get.onsuccess = () => {
            const row = get.result as { value?: string } | undefined
            resolve(row?.value)
            idb.close()
          }
          get.onerror = () => { reject(get.error); idb.close() }
        }
        r.onerror = () => reject(r.error)
      })
      return value ? JSON.parse(value) : null
    })
    // Slot-merge outcome: left rail still has exactly one slot with two tabs
    // (the seeded calendar + the docked notes). NOT the corner-claim outcome
    // (which would create a top rail + claim NW corner, leaving the left
    // rail's slot at one tab).
    expect(railsState?.left?.slots?.length).toBe(1)
    expect(railsState?.left?.slots?.[0]?.tabs?.length).toBe(2)
    expect(railsState?.left?.slots?.[0]?.tabs?.map((t: { type: string }) => t.type).sort()).toEqual(['calendar', 'notes'])
    expect(railsState?.top).toBeNull()
  })
})

/**
 * Phase 6 per-kind dock coverage: the existing tests above exercise the
 * forward path (float → empty rail) for the `note` kind only. These extend
 * coverage to the other floating kinds — dragging a floating calendar /
 * taskboard / horizons / list-inset onto the empty left-side strip should
 * dock as a new slot containing one tab of the matching type. Each test
 * mirrors the "drops a floating note onto an empty-side strip" structure;
 * we deliberately only re-cover the empty-side path because slot-body and
 * collapsed-stub variants share the same `applyDockFloatIntoSlot` reducer
 * — kind-agnostic — and re-asserting them per kind would just add CI time
 * without catching new failure modes.
 */
test.describe('canvas float → rail empty-side dock per kind (P6)', () => {
  test('floating calendar docks as a new calendar slot', async ({ page }) => {
    await seedCanvas(page, {
      floatingCalendars: [{ x: 320, y: 280, width: 280, height: 240 }],
    })
    await expect(floatingCalendarByIndex(page)).toBeVisible()
    await expect(railBySide(page, 'left')).toHaveCount(0)

    await dragWidgetTo(page, floatingCalendarByIndex(page), { x: 100, y: 400 })

    // Dock outcome — float deleted, left rail with one slot containing the
    // matching kind. Using DOM assertions (not IDB) because `useDefaultRails`'s
    // hydration gate stays closed when the test seeds no list definitions
    // (the second effect waits on `listDefinitionsLoaded`); without a
    // hydrated store, `setCanvasRails` never fires through the persist
    // subscriber. The in-memory rails store still reflects the dock, and
    // that's what renders the rail in the DOM.
    await expect(floatingCalendarByIndex(page)).toHaveCount(0)
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()
    await expect(leftRail.locator('[data-rails-drop-id^="rails:slot:"]')).toHaveCount(1)
    // Calendar-specific signal: the docked slot renders calendar-strip chrome.
    await expect(leftRail.getByRole('button', { name: 'Previous week' })).toBeVisible()
  })

  test('floating taskboard docks as a new taskboard slot', async ({ page }) => {
    await seedCanvas(page, {
      floatingTaskboards: [{ x: 320, y: 280, width: 280, height: 240 }],
    })
    await expect(floatingTaskboardByIndex(page)).toBeVisible()
    await expect(railBySide(page, 'left')).toHaveCount(0)

    await dragWidgetTo(page, floatingTaskboardByIndex(page), { x: 100, y: 400 })

    await expect(floatingTaskboardByIndex(page)).toHaveCount(0)
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()
    await expect(leftRail.locator('[data-rails-drop-id^="rails:slot:"]')).toHaveCount(1)
  })

  test('floating horizons docks as a new horizons slot', async ({ page }) => {
    await seedCanvas(page, {
      floatingHorizons: [{ x: 320, y: 280, width: 280, height: 240 }],
    })
    await expect(floatingHorizonsByIndex(page)).toBeVisible()
    await expect(railBySide(page, 'left')).toHaveCount(0)

    await dragWidgetTo(page, floatingHorizonsByIndex(page), { x: 100, y: 400 })

    await expect(floatingHorizonsByIndex(page)).toHaveCount(0)
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()
    await expect(leftRail.locator('[data-rails-drop-id^="rails:slot:"]')).toHaveCount(1)
  })

  test('floating list-inset docks as a new lens slot with the def threaded', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'Inset list' }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 280, width: 280, height: 240 }],
    })
    await expect(listInsetByIndex(page)).toBeVisible()
    await expect(railBySide(page, 'left')).toHaveCount(0)

    await dragWidgetTo(page, listInsetByIndex(page), { x: 100, y: 400 })

    await expect(listInsetByIndex(page)).toHaveCount(0)
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()
    await expect(leftRail.locator('[data-rails-drop-id^="rails:slot:"]')).toHaveCount(1)
    // Lens-specific signal: the docked slot's title renders the source def's
    // name. This asserts the `slotFromFloat` reducer threaded the lens
    // `listDefinitionId` onto the new tab — without it the title would
    // fall through to the bare 'List' label. Title text is reachable via
    // a substring match against the rail-scoped DOM.
    await expect(leftRail).toContainText('Inset list')
  })
})

/**
 * P13 migration: dock-overlay CSS-var math (was
 * `src/test/components/canvas/rails/dock-overlay.test.tsx`). RailsFrame's
 * inline-style `--{side}-size` CSS custom properties feed
 * `DockOverlay.module.css`'s corner-sub-zone widths via `var(--{side}-size,
 * 80px)`. The frame emits a `--{side}-size` only when the rail exists, so the
 * 80 px fallback fires only on the perp-rail-absent case (corner-claim still
 * hit-targettable) while a present rail (collapsed at COLLAPSED_RAIL_PX or
 * expanded) sizes the corner sub-zone to the rail exactly. JSDOM is not
 * authoritative for inline-style readback under hashed CSS modules; verifying
 * in real Chromium pins the contract end-to-end.
 */
async function readFrameSizes(page: Page): Promise<{
  left: string | null; right: string | null; top: string | null; bottom: string | null
}> {
  return await page.evaluate(() => {
    // RailsFrame's outermost div carries the `--{side}-size` properties as
    // inline-style. When no rail exists, the frame mounts but with no inline
    // custom properties — fall back to all-null.
    const candidates = document.querySelectorAll<HTMLElement>('div[style*="--"]')
    for (const el of candidates) {
      const left = el.style.getPropertyValue('--left-size')
      const right = el.style.getPropertyValue('--right-size')
      const top = el.style.getPropertyValue('--top-size')
      const bottom = el.style.getPropertyValue('--bottom-size')
      if (left || right || top || bottom) {
        return {
          left: left || null,
          right: right || null,
          top: top || null,
          bottom: bottom || null,
        }
      }
    }
    return { left: null, right: null, top: null, bottom: null }
  })
}

test.describe('RailsFrame --{side}-size CSS vars (DockOverlay corner sizing contract)', () => {
  test('omits every --{side}-size when no rail exists (corner sub-zones use 80px fallback)', async ({ page }) => {
    await seedCanvas(page, {})
    expect(await readFrameSizes(page)).toEqual({ left: null, right: null, top: null, bottom: null })
  })

  test('emits --left-size with the expanded rail width when the rail exists', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'L' }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-A',
            tabs: [{ id: 'tab-A', type: 'lens', listDefIdx: 0 }],
            activeTabId: 'tab-A',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })
    const sizes = await readFrameSizes(page)
    expect(sizes.left).toBe('340px') // DEFAULT_VERTICAL_RAIL_WIDTH
    expect(sizes.right).toBeNull()
  })

  test('emits --left-size as COLLAPSED_RAIL_PX when the rail is collapsed (no overshoot)', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'L' }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-A',
            tabs: [{ id: 'tab-A', type: 'lens', listDefIdx: 0 }],
            activeTabId: 'tab-A',
          }],
        },
        right: null,
        top: null,
        bottom: null,
        collapsed: { left: true },
      },
    })
    const sizes = await readFrameSizes(page)
    expect(sizes.left).toBe('28px') // COLLAPSED_RAIL_PX
  })

  test('emits each --{side}-size independently (a present top + absent left does not leak --left-size)', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: null,
        right: null,
        top: {
          orientation: 'horizontal',
          slots: [{
            id: 'slot-T',
            tabs: [{ id: 'tab-T', type: 'notes' }],
            activeTabId: 'tab-T',
          }],
        },
        bottom: null,
      },
    })
    const sizes = await readFrameSizes(page)
    expect(sizes.top).not.toBeNull()
    expect(sizes.left).toBeNull()
    expect(sizes.right).toBeNull()
    expect(sizes.bottom).toBeNull()
  })
})

/**
 * P13 migration: rail-dnd-pointer corner-hit cases (was
 * `src/test/components/canvas/rails/rail-dnd-pointer.test.tsx:184-262` — eight
 * cases pinning that when the perpendicular rail is absent, the empty-side
 * strip's corner sub-zone retains a non-zero hit target via the CSS floor
 * `var(--{perp}-size, 80px)`. The harness mirrored this with a JS
 * `cornerSize` shim in `rectForEmptySideSubzone`; this migration verifies the
 * actual CSS contract end-to-end by dragging a real slot to a real corner
 * sub-zone and reading the post-drop rails state from IDB.
 *
 * Verification reads `settings.canvasRails` from IDB (with
 * `expect.poll` to absorb the 500 ms persist debounce) since `corners` is a
 * pure state field with no DOM signal. The store-mutation cases stay in
 * vitest at `rail-dnd-pointer.test.tsx`; only the corner-hit subset migrates.
 */
async function readRailsFromIDB(page: Page): Promise<{
  left: { slots: Array<{ id: string }> } | null
  right: { slots: Array<{ id: string }> } | null
  top: { slots: Array<{ id: string }> } | null
  bottom: { slots: Array<{ id: string }> } | null
  corners?: Record<string, 'h' | 'v'>
} | null> {
  return await page.evaluate(async () => {
    const value = await new Promise<string | undefined>((resolve, reject) => {
      const r = indexedDB.open('todo2')
      r.onsuccess = () => {
        const idb = r.result
        const tx = idb.transaction(['settings'], 'readonly')
        const get = tx.objectStore('settings').get('canvasRails')
        get.onsuccess = () => {
          const row = get.result as { value?: string } | undefined
          resolve(row?.value)
          idb.close()
        }
        get.onerror = () => { reject(get.error); idb.close() }
      }
      r.onerror = () => reject(r.error)
    })
    return value ? JSON.parse(value) : null
  })
}

async function dragSlotHandleToCorner(
  page: Page,
  slotId: string,
  corner: { side: 'left' | 'right' | 'top' | 'bottom'; claim: 'start' | 'end' },
): Promise<void> {
  // Drag a slot's reorder handle (TabStrip's `aria-label="Reorder slot: <kind>"`
  // button) to a specific corner sub-zone. The DockOverlay renders its
  // empty-side strips only mid-drag (`RailsFrame.tsx:96` gates on
  // `railsDragging || floatDragActive`), so the gesture is a 3-phase
  // pointer trajectory:
  //   1. mousedown on the slot handle
  //   2. nudge past dnd-kit's 5 px PointerSensor activation distance — once
  //      `useRailsDragMonitor.onDragStart` fires, `draggingSlot` flips
  //      non-null, and DockOverlay mounts the strips
  //   3. wait for the corner sub-zone to attach, then move to its center
  //      and release
  const handle = page
    .locator(`[data-slot-id="${slotId}"]`)
    .locator('[aria-label^="Reorder slot:"]').first()
  const handleBox = await handle.boundingBox()
  if (!handleBox) throw new Error(`dragSlotHandleToCorner: handle for ${slotId} has no box`)
  const startX = handleBox.x + handleBox.width / 2
  const startY = handleBox.y + handleBox.height / 2

  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX + 6, startY + 6, { steps: 2 })

  const subZoneId = `rails:empty-side:${corner.side}:${corner.claim}`
  const subZone = page.locator(`[data-rails-drop-id="${subZoneId}"]`)
  await subZone.waitFor({ state: 'attached', timeout: 5000 })
  // Hold the pointer at the activation-nudge spot for one rAF so the strip
  // sub-zones finish layout (the DockOverlay sub-zones size on
  // `var(--{perp}-size, 80px)` which depends on whether the perpendicular
  // rail is rendered; a too-eager bounding box read can return a pre-layout
  // rect on a particular tick).
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => r())))
  const subZoneBox = await subZone.boundingBox()
  if (!subZoneBox) throw new Error(`dragSlotHandleToCorner: sub-zone ${subZoneId} has no box`)

  // Each frame corner has two overlapping sub-zones (top:start ↔ left:start
  // at NW, etc.). dnd-kit picks the deeper-in-DOM hit, and `RailsFrame`
  // iterates `emptySides` in the fixed order [left, right, top, bottom] —
  // so top/bottom strips render AFTER left/right. To target a left or right
  // corner sub-zone deterministically, the pointer must land INSIDE the
  // target sub-zone but OUTSIDE the overlapping top/bottom corner. The
  // overlap is the perpendicular strip's corner-cell region:
  //   top:start has `width: var(--left-size, 80px)`
  //   bottom:start has `width: var(--left-size, 80px)`
  //   etc.
  // So a left:start drop must aim past the right edge of top:start. The
  // strip-side aim below targets the inner edge of the side strip (the
  // "depth" axis) — far from the corner pixel that the perpendicular strip
  // also claims.
  const inset = 12
  let targetX: number
  let targetY: number
  if (corner.side === 'top' || corner.side === 'bottom') {
    // Top/bottom strips render LAST among the empty sides this test exercises
    // (the seed always puts the source on the perpendicular axis, so left/
    // right strips are also rendered, but top/bottom are later in DOM and
    // win at the shared corner pixel). Inset along the strip width is fine.
    targetX = corner.claim === 'start' ? subZoneBox.x + inset : subZoneBox.x + subZoneBox.width - inset
    targetY = corner.side === 'top' ? subZoneBox.y + inset : subZoneBox.y + subZoneBox.height - inset
  } else {
    // left/right corners: aim inset along the STRIP'S DEPTH (i.e., toward
    // the canvas center) so the pointer is past the perpendicular top/
    // bottom corner sub-zone's outer edge. The perpendicular sub-zone has
    // `width: var(--left-size, 80px)` (fallback 80px because the side rail
    // is absent in these tests), so inset along depth ≥ 80 lands clear.
    targetX = corner.side === 'left' ? subZoneBox.x + subZoneBox.width - inset : subZoneBox.x + inset
    targetY = corner.claim === 'start' ? subZoneBox.y + inset : subZoneBox.y + subZoneBox.height - inset
  }
  await page.mouse.move(targetX, targetY, { steps: 24 })
  await page.mouse.up()
}

async function expectRailsCorners(page: Page, corners: Record<string, 'h' | 'v'>): Promise<void> {
  await expect.poll(async () => (await readRailsFromIDB(page))?.corners).toEqual(corners)
}

test.describe('rails empty-side corner hit-floor (perpendicular rail absent)', () => {
  test('claim=start on top resolves to top_start when left rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'L' }],
      canvasRails: {
        left: null,
        right: {
          orientation: 'vertical',
          slots: [{ id: 'slot-R', tabs: [{ id: 'tab-R', type: 'lens', listDefIdx: 0 }], activeTabId: 'tab-R' }],
        },
        top: null,
        bottom: null,
      },
    })

    await dragSlotHandleToCorner(page, 'slot-R', { side: 'top', claim: 'start' })
    await expectRailsCorners(page, { nw: 'h' })
  })

  test('claim=end on top resolves to top_end when right rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'L' }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{ id: 'slot-L', tabs: [{ id: 'tab-L', type: 'lens', listDefIdx: 0 }], activeTabId: 'tab-L' }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await dragSlotHandleToCorner(page, 'slot-L', { side: 'top', claim: 'end' })
    await expectRailsCorners(page, { ne: 'h' })
  })

  test('claim=start on bottom resolves to bottom_start when left rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'L' }],
      canvasRails: {
        left: null,
        right: {
          orientation: 'vertical',
          slots: [{ id: 'slot-R', tabs: [{ id: 'tab-R', type: 'lens', listDefIdx: 0 }], activeTabId: 'tab-R' }],
        },
        top: null,
        bottom: null,
      },
    })

    await dragSlotHandleToCorner(page, 'slot-R', { side: 'bottom', claim: 'start' })
    await expectRailsCorners(page, { sw: 'h' })
  })

  test('claim=end on bottom resolves to bottom_end when right rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'L' }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{ id: 'slot-L', tabs: [{ id: 'tab-L', type: 'lens', listDefIdx: 0 }], activeTabId: 'tab-L' }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await dragSlotHandleToCorner(page, 'slot-L', { side: 'bottom', claim: 'end' })
    await expectRailsCorners(page, { se: 'h' })
  })

  test('claim=start on left resolves to left_start when top rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: null,
        right: null,
        top: null,
        bottom: { orientation: 'horizontal', slots: [{ id: 'slot-B', tabs: [{ id: 'tab-B', type: 'notes' }], activeTabId: 'tab-B' }] },
      },
    })

    await dragSlotHandleToCorner(page, 'slot-B', { side: 'left', claim: 'start' })
    // start claimed → nw='v' (default → cleared). end pinched → sw='h' stored.
    await expectRailsCorners(page, { sw: 'h' })
  })

  test('claim=end on left resolves to left_end when bottom rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: null,
        right: null,
        top: { orientation: 'horizontal', slots: [{ id: 'slot-T', tabs: [{ id: 'tab-T', type: 'notes' }], activeTabId: 'tab-T' }] },
        bottom: null,
      },
    })

    await dragSlotHandleToCorner(page, 'slot-T', { side: 'left', claim: 'end' })
    // end claimed → sw='v' (default → cleared). start pinched → nw='h' stored.
    await expectRailsCorners(page, { nw: 'h' })
  })

  test('claim=start on right resolves to right_start when top rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: null,
        right: null,
        top: null,
        bottom: { orientation: 'horizontal', slots: [{ id: 'slot-B', tabs: [{ id: 'tab-B', type: 'notes' }], activeTabId: 'tab-B' }] },
      },
    })

    await dragSlotHandleToCorner(page, 'slot-B', { side: 'right', claim: 'start' })
    // start claimed → ne='v' (default → cleared). end pinched → se='h' stored.
    await expectRailsCorners(page, { se: 'h' })
  })

  test('claim=end on right resolves to right_end when bottom rail is absent', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: null,
        right: null,
        top: { orientation: 'horizontal', slots: [{ id: 'slot-T', tabs: [{ id: 'tab-T', type: 'notes' }], activeTabId: 'tab-T' }] },
        bottom: null,
      },
    })

    await dragSlotHandleToCorner(page, 'slot-T', { side: 'right', claim: 'end' })
    // end claimed → se='v' (default → cleared). start pinched → ne='h' stored.
    await expectRailsCorners(page, { ne: 'h' })
  })
})
