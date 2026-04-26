import { expect, test } from '@playwright/test'
import {
  dragWidgetTo,
  floatingNoteByIndex,
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
