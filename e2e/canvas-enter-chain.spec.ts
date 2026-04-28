import { expect, test } from '@playwright/test'
import {
  activeInsertInput,
  floatingNoteNodes,
  projectNode,
  seedCanvasWithProjects,
  selectTaskRowByTitle,
  taskRowByTitle,
  taskRowWrappers,
} from './fixtures/seed'

/**
 * Phase 1 baseline regression suite for the canvas Enter-chain (postmortem
 * `bug-fixes P6`, commit 479304e). Encodes the exact bug that took three
 * attempts so a regression fails loudly.
 *
 * MUST PASS against HEAD with the P6 defense-in-depth fix in place. If a
 * variant fails on green code, the fixture or test is wrong — fix it before
 * Phase 2 lands.
 *
 * All Enter-chain interactions start by selecting a task row and pressing
 * `Insert`, which dispatches `triggerInlineCreate` on the canvas's
 * `SortableTaskList`. The after-row InsertTrigger flips `editing=true` and
 * the input mounts with autoFocus + the P6 reclaim schedule. We never click
 * the InsertTrigger DOM directly because its hit-area is a 12 px `::after`
 * pseudo-element on a height-0 element — Playwright's actionability checks
 * fail on a 0-size box.
 */
test.describe('canvas Enter-chain (P1 baseline)', () => {
  test('chains Enter through three same-project tasks without losing focus', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    // Click the seed row to select it, then press Insert to open the
    // after-row InsertTrigger via the inline-create hotkey path.
    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    // First chained insert.
    await page.keyboard.type('first')
    await page.keyboard.press('Enter')

    // The same `placeholder^="New task..."` selector — but it's a different
    // input instance (the previous trigger unmounted, a new one mounted at
    // the new task's after-row position). Toolkit-side: P6's reclaim
    // schedule is supposed to land focus on this newly-mounted input.
    await expect(activeInsertInput(page)).toBeFocused()
    await expect(taskRowByTitle(page, 'first')).toBeVisible()

    // Second chained insert — no intermediate click. If focus had leaked
    // back to body, the leading `s` would still land inertly but the `n`
    // would fire the global "new floating note" hotkey, leaving us with
    // a stray FloatingNoteNode and a malformed task title.
    await page.keyboard.type('second')
    await page.keyboard.press('Enter')

    // Three task rows: seed, first, second.
    await expect(taskRowWrappers(page)).toHaveCount(3)
    await expect(taskRowByTitle(page, 'first')).toBeVisible()
    await expect(taskRowByTitle(page, 'second')).toBeVisible()

    // No body-key leakage. The bug we're guarding against: stray `n` keystrokes
    // landing on document.body fire the global hotkey and spawn a floating
    // note. After a clean Enter-chain the canvas has no floating notes.
    await expect(floatingNoteNodes(page)).toHaveCount(0)
  })

  test('chains Enter across projects via /project NLP', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [
        { name: 'P1', tasks: ['seed'] },
        { name: 'Otherproj', tasks: [] },
      ],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    // /Otherproj triggers project autocomplete; Tab accepts the suggestion
    // (collapses to "/Otherproj " in the input), then we type the title and
    // commit.
    await page.keyboard.type('/Otherproj')
    await page.keyboard.press('Tab')
    await page.keyboard.type('cross-task')
    await page.keyboard.press('Enter')

    // The task lands in Otherproj; P1 keeps the original seed.
    await expect(taskRowWrappers(page)).toHaveCount(2)
    await expect(projectNode(page, 'Otherproj').locator('[data-stl-row]'))
      .toHaveText(/cross-task/)
    await expect(projectNode(page, 'P1').locator('[data-stl-row]'))
      .toHaveText(/seed/)

    // Otherproj's after-row InsertTrigger materialises (the
    // `triggerInlineCreate → useEffect → setActiveInsertAfterId` chain ran
    // to completion).
    await expect(projectNode(page, 'Otherproj')
      .locator('input[placeholder^="New task..."]'))
      .toBeVisible()

    // Phase 5 (real-browser-testing): the imperative t50 handoff in
    // SortableTaskList lands focus on Otherproj's after-row input. Verified
    // by MCP trace 2026-04-26 — `mount` → `focusout` → `focusin` →
    // `t50[LANDED]` on the target. The Phase 3 imperative path makes the
    // target-focus assertion deterministic; HEAD's defense-in-depth used
    // to leave focus on the source's still-mounted input (the Phase 1
    // baseline relaxed to "*some* input is focused" because of that quirk).
    //
    // Source P1's InsertTrigger stays mounted with editing=true — that's
    // a separate UX quirk (`SortableTaskList.openTriggerAfterInsert`
    // doesn't reset the source's `activeInsertAfterId` on cross-project
    // commit). Out of scope for Phase 5 since closing it is a behavior
    // change, not defense-stripping. The body-key-leak signal is still
    // covered: focus is on Otherproj's input, so subsequent keystrokes
    // can't fire the global `n` floating-note hotkey.
    await expect(projectNode(page, 'Otherproj')
      .locator('input[placeholder^="New task..."]'))
      .toBeFocused()
    await expect(floatingNoteNodes(page)).toHaveCount(0)
  })

  test('Escape dismisses the trigger and returns focus to body', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    await page.keyboard.type('discard')
    await page.keyboard.press('Escape')

    // Trigger unmounts; nothing was committed; focus returns to body
    // (no loop-reclaim — the post-Escape `committedRef` blocks it).
    await expect(activeInsertInput(page)).toHaveCount(0)
    await expect(taskRowWrappers(page)).toHaveCount(1)
    await expect(floatingNoteNodes(page)).toHaveCount(0)
    expect(await page.evaluate(() => document.activeElement?.tagName ?? null)).not.toBe('INPUT')
  })

  test('empty Enter cancels via the onCancel path', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    // No characters typed — the trimmed title is empty, so handleCommit
    // routes through onCancel and the trigger closes without inserting.
    await page.keyboard.press('Enter')

    await expect(activeInsertInput(page)).toHaveCount(0)
    await expect(taskRowWrappers(page)).toHaveCount(1)
    await expect(floatingNoteNodes(page)).toHaveCount(0)
  })

  test('clicking a task row while typing commits the in-flight title and lands the click', async ({ page }) => {
    await seedCanvasWithProjects(page, {
      projects: [{ name: 'P1', tasks: ['seed'] }],
    })

    await selectTaskRowByTitle(page, 'seed')
    await page.keyboard.press('Insert')
    await expect(activeInsertInput(page)).toBeFocused()

    await page.keyboard.type('partial')

    // mousedown on the seed row fires `useClickOutside`'s capture-phase
    // listener → commits "partial" → re-render advances the chain. The
    // subsequent click event reaches the row and fires onSelect. The
    // important non-regression: no infinite focus toggling, no body-leak.
    await selectTaskRowByTitle(page, 'seed')

    await expect(taskRowByTitle(page, 'partial')).toBeVisible()
    await expect(taskRowWrappers(page)).toHaveCount(2)
    await expect(floatingNoteNodes(page)).toHaveCount(0)
  })
})
