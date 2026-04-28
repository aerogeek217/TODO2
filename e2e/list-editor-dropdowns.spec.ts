import { expect, test, type Page } from '@playwright/test'
import { listInsetByIndex, seedCanvas } from './fixtures/seed'

/**
 * triage-2026-04-27-batch2 P3 — list editor modal regressions.
 *
 * Item 2 (z-index): the discard-changes confirm fired by the list editor's
 * dirty guard used to render at `--z-dialog` (1001), which sat below the
 * editor itself at `--z-dialog-overlay` (1002) — the confirm appeared
 * "behind" the editor and the UI looked frozen. Post-fix, BulkConfirmDialog
 * routes through `--z-dialog-nested` (1003) and lands on top.
 *
 * Item 3 (dropdown flip): the Sort / Group `IconSelect` dropdowns inside
 * `ListEditorBody` used a `position: absolute; top: calc(100% + 4px)` menu
 * inside the dialog body, which has `overflow: auto`. Near the viewport
 * bottom the menu was clipped + scroll-required. Post-fix, the menu portals
 * to `document.body` and `usePopoverAnchor` flips bottom→top when there's
 * no room below.
 *
 * JSDOM is not authoritative for either: the z-index regression is a real
 * stacking-context interaction, and `usePopoverAnchor`'s flip math reads
 * `getBoundingClientRect()` against `window.innerHeight` which only resolves
 * meaningfully under a real viewport.
 */

async function openListEditor(page: Page): Promise<void> {
  const inset = listInsetByIndex(page)
  await expect(inset).toBeVisible()
  // WidgetHeader's title-caret carries `aria-label="Change List"`
  // (KIND_LABEL.lens === 'List').
  const titleButton = inset.locator('button[aria-haspopup="menu"][aria-label="Change List"]').first()
  await titleButton.click()
  const menu = page.locator('[role="menu"][aria-label="Change widget"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Edit list' }).click()
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: /Edit list:/ })).toBeVisible()
}

interface PanelGeom { left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * Locate the portaled IconSelect listbox by walking up from a known option's
 * label to the `document.body` direct child wrapping it (mirrors the helper
 * in `runtime-filter-picker.spec.ts`). Returns `null` if no matching
 * portaled panel exists.
 */
async function findIconSelectPanel(page: Page, optionLabel: string): Promise<PanelGeom | null> {
  return await page.evaluate((target) => {
    const listboxes = Array.from(document.body.querySelectorAll<HTMLElement>('[role="listbox"]'))
    for (const lb of listboxes) {
      if (!lb.textContent?.includes(target)) continue
      let el: HTMLElement | null = lb
      while (el && el.parentElement && el.parentElement !== document.body) {
        el = el.parentElement
      }
      if (!el) continue
      // Portaled panels carry inline `position: fixed` from usePopoverAnchor.
      if (el.style.position !== 'fixed') continue
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return null
  }, optionLabel)
}

test.describe('list editor modal — dropdown flip (item 3)', () => {
  test('Sort dropdown stays inside viewport when panel would clip the bottom', async ({ page }) => {
    // Viewport short enough that the Sort menu (~226 px tall in Chromium)
    // exceeds the room below the trigger. usePopoverAnchor flips above when
    // there's room there, otherwise clamps the panel to fit; either way the
    // user always sees the full panel (the regression item 3 covered).
    await page.setViewportSize({ width: 1024, height: 480 })
    await seedCanvas(page, {
      listDefinitions: [{ name: 'Flip target' }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 }],
    })

    await openListEditor(page)

    const sortTrigger = page.getByRole('button', { name: 'Sort tasks by' })
    await expect(sortTrigger).toBeVisible()

    await sortTrigger.click()

    // 'Effective date' is in LIST_EDITOR_SORT_VALUES. Waiting for it confirms
    // the menu mounted + measured (usePopoverAnchor's compute fires once on
    // panel attach; the rendered option is the "panel mounted" signal).
    const optionMatch = page.locator('[role="option"]').filter({ hasText: 'Effective date' })
    await expect(optionMatch).toBeVisible()

    const panel = await findIconSelectPanel(page, 'Effective date')
    expect(panel).not.toBeNull()
    if (!panel) return

    const vh = await page.evaluate(() => window.innerHeight)
    const vw = await page.evaluate(() => window.innerWidth)

    // Inside viewport (8 px margin per usePopoverAnchor's VIEWPORT_MARGIN_PX).
    // Pre-fix the menu lived inside the dialog body (`overflow: auto`) and
    // overflowed past the viewport with no scroll affordance.
    expect(panel.top).toBeGreaterThanOrEqual(8)
    expect(panel.bottom).toBeLessThanOrEqual(vh - 8)
    expect(panel.left).toBeGreaterThanOrEqual(8)
    expect(panel.right).toBeLessThanOrEqual(vw - 8)
  })

  test('Sort dropdown is portaled out of the dialog body', async ({ page }) => {
    // Pre-fix the menu lived inside the dialog's `body { overflow: auto }`
    // wrapper, so a tall option list got clipped. Asserting the panel's
    // ancestor chain proves it now portals to document.body.
    await seedCanvas(page, {
      listDefinitions: [{ name: 'Portal target' }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 }],
    })

    await openListEditor(page)
    await page.getByRole('button', { name: 'Sort tasks by' }).click()
    await expect(page.locator('[role="option"]').filter({ hasText: 'Effective date' })).toBeVisible()

    const portaled = await page.evaluate(() => {
      const lb = document.body.querySelector<HTMLElement>('[role="listbox"]')
      if (!lb) return false
      // Walk up to the body. If the listbox is portaled, the chain hits
      // document.body without crossing the dialog wrapper.
      let el: HTMLElement | null = lb
      while (el && el !== document.body) {
        if (el.getAttribute('role') === 'dialog') return false
        el = el.parentElement
      }
      return el === document.body
    })
    expect(portaled).toBe(true)
  })
})

/**
 * Locate the FilterChipBar dropdown panel by walking up from a known
 * label inside it (`'Has scheduled'` for the Date dropdown is unique
 * enough — it only renders inside `DateRangeDropdown`'s panel) to the
 * `document.body` direct child wrapping it. Returns `null` if no
 * portaled panel exists or the panel sits inside the dialog (the
 * pre-fix shape).
 */
async function findFilterChipPanel(page: Page, marker: string): Promise<PanelGeom | null> {
  return await page.evaluate((target) => {
    const candidates = Array.from(document.body.children) as HTMLElement[]
    for (const el of candidates) {
      if (el.getAttribute('role') === 'dialog') continue
      if (window.getComputedStyle(el).position !== 'fixed') continue
      if (!el.textContent?.includes(target)) continue
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }
    }
    return null
  }, marker)
}

test.describe('list editor modal — FilterChipBar dropdown flip (item 10)', () => {
  test('Date dropdown stays inside viewport when panel would clip the bottom', async ({ page }) => {
    // Triage-2026-04-27-batch2 P10: P3 only migrated `IconSelect` (Sort /
    // Group). The FilterChipBar dropdowns rendered by `<ListFilterEditor>`
    // (Date here; Project / People / Org / Tags / Status when those entities
    // exist) used `position: absolute; top: calc(100% + 4px)` inside the
    // dialog body's `overflow: auto` and got clipped near the bottom — user
    // had to scroll inside the modal to reach the rest of the panel. After
    // the migration to `usePopoverAnchor + createPortal`, the panel escapes
    // the dialog and flips up when there's no room below.
    await page.setViewportSize({ width: 1024, height: 480 })
    await seedCanvas(page, {
      listDefinitions: [{
        name: 'Date flip target',
        // ListEditorBody renders <ListFilterEditor> only for `custom`
        // membership. `predicate: {}` is intentionally minimal —
        // FilterChipBar's `useMemo({ ...DEFAULT_PREDICATE, ...rawPredicate })`
        // fills in the rest at render time so we don't need to mirror the
        // full TodoPredicate shape in this fixture.
        membership: { kind: 'custom', predicate: {} },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 }],
    })

    await openListEditor(page)

    // The Date trigger is the chip with the chevron caret in its accessible
    // name. The inner field-selector buttons that show "Effective Date" /
    // "Scheduled" / etc. only appear *after* the panel opens.
    // Scope to the editor dialog — the page-level TopBar also renders a
    // "Date ▾" filter chip, so an unscoped locator matches twice.
    const editor = page.getByRole('dialog', { name: /Edit list:/ })
    const dateTrigger = editor.getByRole('button', { name: /Date\s*▾/ })
    await expect(dateTrigger).toBeVisible()
    await dateTrigger.click()

    // 'Has scheduled' is rendered by the TriStateRow inside the date panel.
    // Waiting for it confirms the panel mounted + measured.
    await expect(page.getByText('Has scheduled')).toBeVisible()

    const panel = await findFilterChipPanel(page, 'Has scheduled')
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
    await seedCanvas(page, {
      listDefinitions: [{
        name: 'Date portal target',
        membership: { kind: 'custom', predicate: {} },
      }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 }],
    })

    await openListEditor(page)
    const editor = page.getByRole('dialog', { name: /Edit list:/ })
    await editor.getByRole('button', { name: /Date\s*▾/ }).click()
    await expect(page.getByText('Has scheduled')).toBeVisible()

    const portaled = await page.evaluate(() => {
      // The panel can be any direct child of document.body whose subtree
      // contains the sentinel label and which is positioned via inline
      // `position: fixed` (the usePopoverAnchor signature).
      const candidates = Array.from(document.body.children) as HTMLElement[]
      for (const el of candidates) {
        if (el.getAttribute('role') === 'dialog') continue
        if (window.getComputedStyle(el).position !== 'fixed') continue
        if (!el.textContent?.includes('Has scheduled')) continue
        // Walk up: a portaled panel reaches document.body without crossing
        // the dialog wrapper. (Trivially true here since `el` itself is
        // already a body child, but keeps the assertion symmetric with
        // the IconSelect spec above.)
        let cur: HTMLElement | null = el
        while (cur && cur !== document.body) {
          if (cur.getAttribute('role') === 'dialog') return false
          cur = cur.parentElement
        }
        return cur === document.body
      }
      return false
    })
    expect(portaled).toBe(true)
  })
})

test.describe('list editor modal — nested confirm z-index (item 2)', () => {
  test('discard-changes confirm renders above the editor', async ({ page }) => {
    await seedCanvas(page, {
      listDefinitions: [{ name: 'Discard probe' }],
      listInsets: [{ listDefIdx: 0, x: 320, y: 200, width: 320, height: 240 }],
    })

    await openListEditor(page)

    // Make the draft dirty by editing the name field — `defsEqual` flips,
    // and the close handler routes through `showBulkConfirmation`.
    const nameInput = page.getByPlaceholder('List name')
    await expect(nameInput).toBeVisible()
    await nameInput.fill('Discard probe edited')

    // Click the editor's Cancel — fires `handleClose` → guardDirty →
    // showBulkConfirmation('custom', …, { title: 'Discard changes?' }).
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()

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
