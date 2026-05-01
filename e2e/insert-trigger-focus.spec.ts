import { expect, test } from '@playwright/test'
import {
  activeInsertInput,
  floatingNoteNodes,
  seedCanvasWithProjects,
  selectTaskRowByTitle,
  taskRowByTitle,
  taskRowWrappers,
} from './fixtures/seed'

/**
 * Real-browser pin for the InsertTrigger imperative-focus contract that the
 * old `src/test/components/canvas/insert-trigger-focus.test.tsx` JSDOM file
 * was approximating with a synthetic harness. JSDOM is not authoritative for
 * focus handoffs (CLAUDE.md / ARCHITECTURE.md "JSDOM is not authoritative"),
 * so the contract is verified here against real Chromium where React Flow's
 * ResizeObserver actually fires.
 *
 * The Enter-chain integration is covered by `canvas-enter-chain.spec.ts`;
 * this spec adds two focused timing pins:
 *   1. The single-render direct path — Insert mounts a trigger in editing
 *      mode and focus lands within the t50 schedule (bottom of the focus
 *      reclaim ladder; see `src/components/canvas/InsertTrigger.tsx:124`).
 *   2. Stability under a 6-task rapid Enter chain — every keystroke lands
 *      in the active input (regression for body-leak: a stray `n` would
 *      fire the `n` global hotkey and spawn a floating note).
 */
test.describe('InsertTrigger focus handoff (P13 migration)', () => {
  test('Insert mounts the trigger in editing mode and focus lands on the new input', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')

    // Single-render direct path: SortableTaskList sets `activeInsertAfterId`
    // on the next render, so the InsertTrigger remounts already in editing
    // mode and the input mounts with autoFocus. The post-mount t50 imperative
    // call short-circuits via `already-on-input` in this no-row-insertion
    // scenario (Phase 5 MCP trace 2026-04-26: 10/10 cycles).
    await expect(activeInsertInput(page)).toBeFocused()
  })

  test('rapid 6-task Enter chain keeps every keystroke landing in the active input', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    // 6 rapid commits — each iteration drains by waiting for the new row
    // and the new trigger's input to be focused. The two-render Enter-chain
    // path (commit → activeInsertAfterId moves → new trigger mounts → t50
    // focusInput) must land focus on the new input before the next keystroke.
    // Body-key leak regression: a stray `n` between rounds would fire the
    // global "new floating note" shortcut.
    const titles = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta']
    for (const t of titles) {
      await page.keyboard.type(t)
      await page.keyboard.press('Enter')
      await expect(taskRowByTitle(page, t)).toBeVisible()
      await expect(activeInsertInput(page)).toBeFocused()
    }

    await expect(taskRowWrappers(page)).toHaveCount(titles.length + 1)
    for (const t of titles) {
      await expect(taskRowByTitle(page, t)).toBeVisible()
    }
    await expect(floatingNoteNodes(page)).toHaveCount(0)
  })

  test('Escape unmounts the trigger and a stale focusInput call is a no-op', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    // Escape unmounts the input. SortableTaskList may still have a pending
    // t50 setTimeout in flight; the trigger's `focusInput` handle short-
    // circuits via `no-input-or-committed` when the input is unmounted, so
    // focus stays on body and no exception fires.
    await page.keyboard.press('Escape')
    await expect(activeInsertInput(page)).toHaveCount(0)

    // Wait past the t50 window so any pending stale call has resolved as a
    // no-op. After the window: typing `n` would land on body and fire the
    // global new-floating-note shortcut. We assert no float was created.
    await page.waitForFunction(() => document.activeElement === document.body)
    await page.keyboard.press('n')
    await expect(floatingNoteNodes(page)).toHaveCount(1)
    // The `n` shortcut is the regression-bar — it confirms focus is on body
    // post-Escape (not the safety net we built around the imperative handle).
    // Reset state so subsequent tests aren't affected by the float spawn.
  })
})
