import { expect, test, type Locator, type Page } from '@playwright/test'
import { box } from './fixtures/geometry'
import { taskRowByTitle } from './fixtures/seed'
import { ADD_FILTER, openSettings, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Popovers stand off the page (D21): a popover over the page (level 1) and
 * one on a popover or in a dialog (level 2) take their level's surface and
 * shadow — the ring inside it — in both themes. Computed styles are compared
 * with the tokens resolved on the document (the level-2 twins read straight
 * from the root, so the swap under `[data-popover-level='2']` is what's
 * tested), and the surfaces with the design's values.
 *
 * A popover anchored to an element points a caret at it (`PopoverRoot`'s
 * `[data-popover-caret]`): its centre within the anchor's x-range, on the
 * popover's edge facing the anchor — below it, flipped above it, shifted to
 * end at the anchor near the right edge — in its level's surface; a menu at
 * the pointer has none. The trigger is ringed in the accent, its text in the
 * text accent, while its popover is open, and not once it closes.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  lenses: [{ id: 'l1', name: 'Has a person' }],
  listDefinitions: [{ name: 'Team', people: ['Ann'] }],
  tasks: [
    { title: 'Ann one', people: ['Ann'] },
    { title: 'Ann two', people: ['Ann'] },
    { title: 'Ann three', people: ['Ann'] },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

/** The design's surfaces (D21 board E). */
const SURFACE = {
  dark: { 1: 'rgb(42, 40, 37)', 2: 'rgb(53, 50, 48)' },
  light: { 1: 'rgb(255, 255, 255)', 2: 'rgb(255, 255, 255)' },
} as const

/** Half the caret's diagonal: how far its tip reaches from its centre. */
const CARET_REACH = 7.1

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** A level's tokens as computed values, resolved on a probe under the document root. */
async function tokens(page: Page, level: 1 | 2) {
  return page.evaluate((suffix) => {
    const probe = document.createElement('div')
    probe.style.backgroundColor = `var(--color-popover-bg${suffix})`
    probe.style.boxShadow = `var(--shadow-dropdown${suffix})`
    probe.style.color = 'var(--color-popover-text-muted)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const out = { background: cs.backgroundColor, shadow: cs.boxShadow, muted: cs.color }
    probe.remove()
    return out
  }, level === 2 ? '-2' : '')
}

async function look(el: Locator) {
  return el.evaluate((node) => {
    const cs = getComputedStyle(node)
    return { background: cs.backgroundColor, shadow: cs.boxShadow }
  })
}

async function expectLevel(page: Page, popover: Locator, level: 1 | 2, theme: 'dark' | 'light') {
  await expect(popover).toHaveAttribute('data-popover-level', String(level))
  const want = await tokens(page, level)
  expect(await look(popover)).toEqual({ background: want.background, shadow: want.shadow })
  expect(want.background).toBe(SURFACE[theme][level])
}

/**
 * The caret sits on `popover`'s edge facing `anchor` (centred 1px inside it,
 * its tip clear of the anchor), its centre within the anchor's x-range.
 * Returns its background.
 */
async function expectCaretAt(popover: Locator, anchor: Locator, side: 'top' | 'bottom'): Promise<string> {
  const caret = popover.locator('[data-popover-caret]')
  await expect(caret).toHaveCount(1)
  await expect(caret).toHaveAttribute('data-popover-caret', side)
  const c = await box(caret)
  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  const a = await box(anchor)
  const p = await box(popover)
  expect(cx).toBeGreaterThanOrEqual(a.x)
  expect(cx).toBeLessThanOrEqual(a.x + a.width)
  if (side === 'top') {
    expect(Math.abs(cy - (p.y + 1))).toBeLessThan(1)
    expect(cy - CARET_REACH).toBeGreaterThan(a.y + a.height)
  } else {
    expect(Math.abs(cy - (p.y + p.height - 1))).toBeLessThan(1)
    expect(cy + CARET_REACH).toBeLessThan(a.y)
  }
  return caret.evaluate((el) => getComputedStyle(el).backgroundColor)
}

/** The accent and the text accent as computed colours. */
async function accents(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.color = 'var(--color-accent-text)'
    probe.style.backgroundColor = 'var(--color-accent)'
    document.body.appendChild(probe)
    const cs = getComputedStyle(probe)
    const out = { accent: cs.backgroundColor, text: cs.color }
    probe.remove()
    return out
  })
}

/** The trigger is ringed in the accent with the text accent while `open`; not otherwise. */
async function expectRinged(page: Page, trigger: Locator, open: boolean) {
  const { accent, text } = await accents(page)
  const ring = `${accent} 0px 0px 0px 1px`
  const read = () => trigger.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { shadow: cs.boxShadow, color: cs.color }
  })
  if (open) {
    await expect.poll(async () => (await read()).shadow).toContain(ring)
    expect((await read()).color).toBe(text)
  } else {
    await expect.poll(async () => (await read()).shadow).not.toContain(ring)
  }
}

for (const theme of ['dark', 'light'] as const) {
  test.describe(`${theme} theme`, () => {
    test.use({ viewport: { width: 1400, height: 900 } })

    test.beforeEach(async ({ page }) => {
      await seedWorkspace(page, SEED)
      await setTheme(page, theme)
    })

    test('over the list: + Filter’s menu and a chip’s picker are level 1, each with a caret under its ringed trigger; the menu’s muted text the popover muted', async ({ page }) => {
      const row = wsListWidget(page, 't1').getByTestId('list-filter-row')
      const addFilter = row.getByRole('button', { name: ADD_FILTER })
      await expectRinged(page, addFilter, false)
      await addFilter.click()
      const menu = page.getByRole('menu', { name: 'Add a filter' })
      await expectLevel(page, menu, 1, theme)
      expect(await expectCaretAt(menu, addFilter, 'top')).toBe(SURFACE[theme][1])
      await expectRinged(page, addFilter, true)
      const heading = menu.getByText('Add a filter to this list')
      expect(await heading.evaluate((el) => getComputedStyle(el).color)).toBe((await tokens(page, 1)).muted)
      await page.keyboard.press('Escape')
      await expect(menu).toHaveCount(0)
      await expectRinged(page, addFilter, false)

      const chip = row.getByTestId('list-filter-chip')
      await chip.click()
      const picker = page.getByTestId('list-filter-picker')
      await expectLevel(page, picker, 1, theme)
      await expectCaretAt(picker, chip, 'top')
      await expectRinged(page, chip, true)
    })

    test('a picker from Edit list is level 2, its caret in the level-2 surface; Edit list itself level 1', async ({ page }) => {
      await wsListWidget(page, 't1').getByTestId('list-summary').click()
      const editList = page.getByTestId('edit-list')
      await expectLevel(page, editList, 1, theme)
      const chip = editList.getByTestId('list-filter-chip')
      await chip.click()
      const picker = page.getByTestId('list-filter-picker')
      await expectLevel(page, picker, 2, theme)
      expect(await expectCaretAt(picker, chip, 'top')).toBe(SURFACE[theme][2])
      await expectRinged(page, chip, true)
    })

    test('a menu in Settings is level 2', async ({ page }) => {
      const settings = await openSettings(page, 'Tasks')
      await settings.getByTestId('lens-list').getByRole('button', { name: /^Has a person/ }).click()
      await settings.getByRole('button', { name: ADD_FILTER }).first().click()
      await expectLevel(page, page.getByRole('menu', { name: 'Add a filter' }), 2, theme)
    })

    test('the top bar’s filter button and the lens name: a caret under each, ringed while open', async ({ page }) => {
      const people = page.getByRole('button', { name: 'People filter' })
      // The ring goes round the button's frame (the button and, while on, its ×).
      const frame = people.locator('..')
      await people.click()
      const picker = page.locator('[data-popover-level]').filter({ hasText: 'Select all' })
      await expectCaretAt(picker, frame, 'top')
      await expectRinged(page, frame, true)
      await page.keyboard.press('Escape')
      await expectRinged(page, frame, false)

      // No lens: the control neutral, the name ringed while its picker is open.
      const none = page.getByRole('button', { name: 'Lens: none' })
      await none.click()
      const lensMenu = page.getByRole('menu', { name: 'Lens' })
      await expectCaretAt(lensMenu, none, 'top')
      await expectRinged(page, none, true)
      // A lens on (the control lit): closed, no ring; open, the ring reads on it.
      await lensMenu.getByRole('menuitemradio', { name: /Has a person/ }).click()
      const lit = page.getByRole('button', { name: 'Lens: Has a person' })
      await expectRinged(page, lit, false)
      await lit.click()
      await expectRinged(page, lit, true)
    })
  })
}

test.describe('carets on a row’s note popover', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  /** Three columns, the list in the rightmost: its rows' notes icons sit near the window's right edge. */
  async function seedRightColumnList(page: Page, tasks: NonNullable<WorkspaceSeed['tasks']>) {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Tasks' }],
      tasks,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'c1', cells: [{ id: 'n1', tabs: [{ id: 'notes1', kind: 'notes' }] }] },
          { id: 'c2', cells: [{ id: 'n2', tabs: [{ id: 'cal', kind: 'calendar' }] }] },
          { id: 'c3', cells: [{ id: 'cell', tabs: [{ id: 'tasks', kind: 'lens', listDefIdx: 0 }] }] },
        ],
      }],
    })
    await wsListWidget(page, 'tasks').waitFor({ state: 'visible' })
  }

  test('near the right edge: shifted left to end at the icon, the caret still under the icon; the icon ringed', async ({ page }) => {
    const title = 'Prepare the quarterly vendor review notes'
    await seedRightColumnList(page, [{ title, notes: 'Vendor notes' }])
    const icon = taskRowByTitle(page, title).getByRole('button', { name: 'Edit progress and notes' })
    await icon.click()
    const popover = page.getByRole('dialog', { name: 'Progress and notes' })
    await expect(popover).toBeVisible()
    // Start-aligned at the icon it would have crossed the right edge: it sits left of it.
    expect((await box(popover)).x).toBeLessThan((await box(icon)).x)
    await expectCaretAt(popover, icon, 'top')
    await expectRinged(page, icon, true)
  })

  test('near the bottom: flipped above the icon, the caret on its bottom edge', async ({ page }) => {
    const fillers = Array.from({ length: 30 }, (_, n) => ({ title: `Filler task ${n + 1}` }))
    await seedRightColumnList(page, [...fillers, { title: 'Last with notes', notes: 'Bottom notes' }])
    const row = taskRowByTitle(page, 'Last with notes')
    await row.scrollIntoViewIfNeeded()
    const icon = row.getByRole('button', { name: 'Edit progress and notes' })
    await icon.click()
    const popover = page.getByRole('dialog', { name: 'Progress and notes' })
    await expect.poll(async () => (await box(popover)).y + (await box(popover)).height - (await box(icon)).y).toBeLessThanOrEqual(0)
    await expectCaretAt(popover, icon, 'bottom')
  })

  test('a menu opened at the pointer has no caret', async ({ page }) => {
    await seedRightColumnList(page, [{ title: 'Right-clicked' }])
    await taskRowByTitle(page, 'Right-clicked').click({ button: 'right' })
    const menu = page.getByRole('menu').first()
    await expect(menu).toBeVisible()
    await expect(menu.locator('[data-popover-caret]')).toHaveCount(0)
  })
})
