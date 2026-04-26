import { expect, test } from '@playwright/test'
import {
  dragWidgetTo,
  emptySideCenter,
  floatingNoteByIndex,
  railBySide,
  railSlotDropTargets,
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
    // Seed a no-op list-def so `useDefaultRails`'s hydration gate
    // (`listDefinitionsLoaded`) opens and the rails store hydrates from
    // persisted state. The def isn't referenced by any slot — its only role
    // is to make `useListDefinitionStore.listDefinitions.length > 0`.
    await seedCanvas(page, {
      listDefinitions: [{ name: 'unused (gate-opener)' }],
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
    // installed a left rail with one notes slot. (`useDefaultRails`'s default
    // seed adds a right-side lens slot whenever list-defs are loaded — we
    // don't suppress it here, just scope the slot-count assertion to the
    // rail that's actually under test.)
    await expect(floatingNoteByIndex(page)).toHaveCount(0)
    const leftRail = railBySide(page, 'left')
    await expect(leftRail).toBeVisible()
    await expect(leftRail.locator('[data-rails-drop-id^="rails:slot:"]')).toHaveCount(1)
  })

  test('drops a floating note onto an occupied slot body and merges as a new tab', async ({ page }) => {
    // Seed: a left rail with one calendar slot (expanded), plus a floating
    // note. Using calendar for the seed slot makes the post-dock tab kinds
    // unambiguous (the dropped float adds a `notes` tab beside `calendar`).
    //
    // We intentionally use the expanded-slot body rather than a collapsed
    // stub: the collapsed stub (~28 px wide) is occluded by the empty-side
    // corner sub-zones, which clamp to a `min-width: 80px` hit-friendly floor
    // and stack at `z-index: 1000`. `elementsFromPoint` returns those first,
    // routing the dock to the top-start corner instead of the slot. The
    // expanded slot body avoids the overlap and tests the same
    // `dockFloatIntoSlot` code path the float-dock-bugs P1 fix landed for.
    await seedCanvas(page, {
      // Same gate-opener pattern as the empty-side test — a no-op list-def
      // unblocks `useDefaultRails`'s hydration so our seeded `canvasRails`
      // is honored instead of replaced by the default right-side seed.
      listDefinitions: [{ name: 'unused (gate-opener)' }],
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
})
