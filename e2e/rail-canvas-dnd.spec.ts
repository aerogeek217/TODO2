import { expect, test, type Page } from '@playwright/test'
import {
  dragTabTo,
  floatingCalendarByIndex,
  floatingHorizonsByIndex,
  floatingNoteByIndex,
  floatingTaskboardByIndex,
  listInsetByIndex,
  railBySide,
  seedCanvas,
  tabPillByDataId,
} from './fixtures/seed'

/**
 * Phase 6 canvas-coverage: rail tab pill → canvas pop-out (the T1A regression
 * triage-2026-04-25 P5 fixed). Encodes one test per slot kind so a future
 * regression in `useRailsDragMonitor`'s `zone.kind === 'canvas'` branch
 * (`src/hooks/use-rails-drag-monitor.ts:108-167`) fails loudly per kind.
 *
 * JSDOM is unauthoritative — the canvas drop zone (`data-rails-drop-id="rails:canvas"`,
 * `CanvasView.tsx:822`) is full-viewport `pointer-events: none` and dnd-kit's
 * geometry-based collision detection only resolves correctly under a real DOM
 * with real `getBoundingClientRect`. The drag itself rides Playwright's
 * trusted CDP `mouse.down`/`mouse.move`/`mouse.up` so the dnd-kit
 * `PointerSensor`'s 5 px activation threshold fires; untrusted PointerEvents
 * synthesized via `dispatchEvent` do NOT trigger sensor activation.
 *
 * Coverage strategy: each test seeds a single 2-tab slot (the under-test kind
 * paired with a partner kind so `TabStrip` renders) and drags the
 * under-test tab to canvas center, asserting (a) the matching floating-node
 * React Flow class appears, (b) the source slot collapses to 1 tab so its
 * partner is unaffected.
 */

const CANVAS_DROP_X = 640
const CANVAS_DROP_Y = 420

async function waitForRailHydration(page: Page) {
  // The rail mounts once `canvas-rails-store` hydrates from settings.canvasRails.
  // Without this wait, the tab-pill `getBoundingClientRect` resolves to 0×0 and
  // `dragTabTo` throws "pill has no bounding box".
  await railBySide(page, 'left').waitFor({ state: 'visible' })
}

test.describe('rail tab → canvas pop-out (T1A inverse path)', () => {
  test('notes tab pops out as a floatingNote', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-notes',
            tabs: [
              { id: 'tab-notes', type: 'notes' },
              { id: 'tab-cal', type: 'calendar' },
            ],
            activeTabId: 'tab-notes',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await waitForRailHydration(page)
    await expect(floatingNoteByIndex(page)).toHaveCount(0)
    await dragTabTo(page, tabPillByDataId(page, 'tab-notes'), { x: CANVAS_DROP_X, y: CANVAS_DROP_Y })

    await expect(floatingNoteByIndex(page)).toBeVisible()
    // Source slot remains, partner tab survives, the under-test tab is gone.
    await expect(tabPillByDataId(page, 'tab-notes')).toHaveCount(0)
    await expect(tabPillByDataId(page, 'tab-cal')).toBeVisible()
  })

  test('calendar tab pops out as a floatingCalendar', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-cal',
            tabs: [
              { id: 'tab-cal', type: 'calendar' },
              { id: 'tab-notes', type: 'notes' },
            ],
            activeTabId: 'tab-cal',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await waitForRailHydration(page)
    await expect(floatingCalendarByIndex(page)).toHaveCount(0)
    await dragTabTo(page, tabPillByDataId(page, 'tab-cal'), { x: CANVAS_DROP_X, y: CANVAS_DROP_Y })

    await expect(floatingCalendarByIndex(page)).toBeVisible()
    await expect(tabPillByDataId(page, 'tab-cal')).toHaveCount(0)
    await expect(tabPillByDataId(page, 'tab-notes')).toBeVisible()
  })

  test('taskboard tab pops out as a floating taskboard', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-tb',
            tabs: [
              { id: 'tab-tb', type: 'taskboard' },
              { id: 'tab-notes', type: 'notes' },
            ],
            activeTabId: 'tab-tb',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await waitForRailHydration(page)
    await expect(floatingTaskboardByIndex(page)).toHaveCount(0)
    await dragTabTo(page, tabPillByDataId(page, 'tab-tb'), { x: CANVAS_DROP_X, y: CANVAS_DROP_Y })

    await expect(floatingTaskboardByIndex(page)).toBeVisible()
    await expect(tabPillByDataId(page, 'tab-tb')).toHaveCount(0)
    await expect(tabPillByDataId(page, 'tab-notes')).toBeVisible()
  })

  test('horizons tab pops out as a floatingHorizons', async ({ page }) => {
    await seedCanvas(page, {
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-hz',
            tabs: [
              { id: 'tab-hz', type: 'horizons' },
              { id: 'tab-notes', type: 'notes' },
            ],
            activeTabId: 'tab-hz',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await waitForRailHydration(page)
    await expect(floatingHorizonsByIndex(page)).toHaveCount(0)
    await dragTabTo(page, tabPillByDataId(page, 'tab-hz'), { x: CANVAS_DROP_X, y: CANVAS_DROP_Y })

    await expect(floatingHorizonsByIndex(page)).toBeVisible()
    await expect(tabPillByDataId(page, 'tab-hz')).toHaveCount(0)
    await expect(tabPillByDataId(page, 'tab-notes')).toBeVisible()
  })

  test('lens tab pops out as a listInset', async ({ page }) => {
    // lens needs a real listDefinitionId — `popTabAtPosition` short-circuits
    // (returns false) when the tab.listDefinitionId is null, leaving the tab
    // attached to the rail. The seed's rail walker resolves listDefIdx → the
    // post-insert def id so the pop-out actually fires.
    await seedCanvas(page, {
      listDefinitions: [{ name: 'Lens source' }],
      canvasRails: {
        left: {
          orientation: 'vertical',
          slots: [{
            id: 'slot-lens',
            tabs: [
              { id: 'tab-lens', type: 'lens', listDefIdx: 0 },
              { id: 'tab-notes', type: 'notes' },
            ],
            activeTabId: 'tab-lens',
          }],
        },
        right: null,
        top: null,
        bottom: null,
      },
    })

    await waitForRailHydration(page)
    await expect(listInsetByIndex(page)).toHaveCount(0)
    await dragTabTo(page, tabPillByDataId(page, 'tab-lens'), { x: CANVAS_DROP_X, y: CANVAS_DROP_Y })

    await expect(listInsetByIndex(page)).toBeVisible()
    await expect(tabPillByDataId(page, 'tab-lens')).toHaveCount(0)
    await expect(tabPillByDataId(page, 'tab-notes')).toBeVisible()
  })
})
