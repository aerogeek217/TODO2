import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedTaskList } from './fixtures/workspace'

/**
 * List editor modal regressions (Settings › Lists' Edit list dialog).
 *
 * Z-index: the discard-changes confirm fired by the list editor's
 * dirty guard used to render at `--z-dialog` (1001), which sat below the
 * editor itself at `--z-dialog-overlay` (1002) — the confirm appeared
 * "behind" the editor and the UI looked frozen. BulkConfirmDialog routes
 * through `--z-dialog-nested` (1003) and lands on top.
 *
 * Filter pickers: the editor's filter chips open their pickers through
 * `usePopoverAnchor + createPortal`, so a picker near the viewport bottom
 * escapes the dialog body's `overflow: auto` and flips / clamps into view.
 *
 * JSDOM is not authoritative for either: the z-index regression is a real
 * stacking-context interaction, and `usePopoverAnchor`'s flip math reads
 * `getBoundingClientRect()` against `window.innerHeight` which only resolves
 * meaningfully under a real viewport.
 */

/** Opens the list editor dialog from Settings › Lists (the list row's ⚙). */
async function openListEditor(page: Page): Promise<void> {
  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage lists…' }).click()
  await page.getByRole('dialog', { name: 'Lists', exact: true }).getByTitle('Edit list').first().click()
  await expect(page.getByRole('dialog', { name: /Edit list:/ })).toBeVisible()
}

interface PanelGeom { left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * Locate a portaled filter picker panel: the `document.body` child with
 * `position: fixed` whose text contains `marker` (`'Also tasks with no due date'` only
 * renders inside the date picker). `null` if no portaled panel exists.
 */
async function findFilterChipPanel(page: Page, marker: string): Promise<PanelGeom | null> {
  return await page.evaluate((target) => {
    const candidates = Array.from(document.body.children) as HTMLElement[]
    for (const el of candidates) {
      if (/Edit list:/.test(el.getAttribute('aria-label') ?? '')) continue
      if (window.getComputedStyle(el).position !== 'fixed') continue
      if (!el.textContent?.includes(target)) continue
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return null
  }, marker)
}

/** Opens the editor's date filter picker: + Filter → Dates. */
async function openDatePicker(page: Page): Promise<void> {
  const editor = page.getByRole('dialog', { name: /Edit list:/ })
  await editor.getByRole('button', { name: 'Filter', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Dates' }).click()
  await expect(page.getByRole('dialog', { name: 'Date filters' })).toBeVisible()
}

test.describe('list editor modal — filter picker placement', () => {
  test('Date dropdown stays inside viewport when panel would clip the bottom', async ({ page }) => {
    // A picker inside the dialog body's `overflow: auto` would be clipped
    // near the bottom; portaled, it escapes the dialog and flips up when
    // there's no room below.
    await page.setViewportSize({ width: 1024, height: 480 })
    await seedTaskList(page, { list: { name: 'Date flip target' } })

    await openListEditor(page)
    await openDatePicker(page)

    const panel = await findFilterChipPanel(page, 'Also tasks with no due date')
    expect(panel).not.toBeNull()
    if (!panel) return

    const vh = await page.evaluate(() => window.innerHeight)
    const vw = await page.evaluate(() => window.innerWidth)

    // Inside the viewport (8 px margin per usePopoverAnchor's
    // VIEWPORT_MARGIN_PX). Pre-fix the panel hung off the bottom of the
    // dialog body and only the top half was reachable without scrolling.
    expect(panel.top).toBeGreaterThanOrEqual(8)
    expect(panel.bottom).toBeLessThanOrEqual(vh - 8)
    expect(panel.left).toBeGreaterThanOrEqual(8)
    expect(panel.right).toBeLessThanOrEqual(vw - 8)
  })

  test('Date dropdown is portaled out of the dialog body', async ({ page }) => {
    // Pre-fix the panel lived inside the dialog's `body { overflow: auto }`
    // wrapper, so a tall option list got clipped. Asserting the panel's
    // ancestor chain proves it now portals to document.body.
    await seedTaskList(page, { list: { name: 'Date portal target' } })

    await openListEditor(page)
    await openDatePicker(page)

    const portaled = await page.evaluate(() => {
      // The panel can be any direct child of document.body whose subtree
      // contains the sentinel label and which is positioned via inline
      // `position: fixed` (the usePopoverAnchor signature).
      const candidates = Array.from(document.body.children) as HTMLElement[]
      for (const el of candidates) {
        if (/Edit list:/.test(el.getAttribute('aria-label') ?? '')) continue
        if (window.getComputedStyle(el).position !== 'fixed') continue
        if (!el.textContent?.includes('Also tasks with no due date')) continue
        // Walk up: a portaled panel reaches document.body without crossing
        // the dialog wrapper.
        let cur: HTMLElement | null = el
        while (cur && cur !== document.body) {
          if (/Edit list:/.test(cur.getAttribute('aria-label') ?? '')) return false
          cur = cur.parentElement
        }
        return cur === document.body
      }
      return false
    })
    expect(portaled).toBe(true)
  })
})

test.describe('list editor modal — nested confirm z-index', () => {
  test('discard-changes confirm renders above the editor', async ({ page }) => {
    await seedTaskList(page, { list: { name: 'Discard probe' } })

    await openListEditor(page)

    // Make the draft dirty by editing the name field — `defsEqual` flips,
    // and the close handler routes through `showBulkConfirmation`.
    const nameInput = page.getByPlaceholder('List name')
    await expect(nameInput).toBeVisible()
    await nameInput.fill('Discard probe edited')

    // Click the editor's Cancel — fires `handleClose` → guardDirty →
    // showBulkConfirmation('custom', …, { title: 'Discard changes?' }).
    await page.getByRole('dialog', { name: /Edit list:/ }).getByRole('button', { name: /^Cancel/ }).click()

    const confirmDialog = page.getByRole('dialog').filter({ hasText: 'Discard changes?' })
    await expect(confirmDialog).toBeVisible()

    // Assert the confirm renders above the list editor by computed z-index.
    const stack = await page.evaluate(() => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]'))
      return dialogs.map((d) => ({
        label: d.getAttribute('aria-label') ?? d.getAttribute('aria-labelledby') ?? '',
        text: d.textContent?.slice(0, 40) ?? '',
        zIndex: parseInt(window.getComputedStyle(d).zIndex || '0', 10),
      }))
    })
    const editor = stack.find((d) => /Edit list:/.test(d.label))
    const confirm = stack.find((d) => /Discard changes\?/.test(d.text))
    expect(editor).toBeTruthy()
    expect(confirm).toBeTruthy()
    if (!editor || !confirm) return
    expect(confirm.zIndex).toBeGreaterThan(editor.zIndex)
  })
})
