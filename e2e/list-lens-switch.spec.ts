import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A list's switch for the top bar's lens (the standard switch, G3): while
 * the lens hides tasks in the list, its top line ends with the glasses,
 * after the count and group · sort, just before the cell's ⋯. Following the
 * lens it is quiet (UX cleanup 2A): hidden until the cell is hovered or
 * holds the focus — its room kept, no press taken while hidden — and without
 * its `−N` (the tooltip says it). A click turns the lens off for this list
 * alone (slashed glasses, always shown, every task back), saved at once: it
 * outlasts a reload and never makes the list unsaved. The count shows only
 * while the screen filter or the lens narrows the list.
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Marcus Chen'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Write the review', people: ['Aisha Rahman'] },
    { title: 'Plan the offsite', people: ['Marcus Chen'] },
    { title: 'Call the vendor', people: ['Aisha Rahman'] },
  ],
  lenses: [{ id: 'lens-aisha', name: 'Aisha', predicate: { personIds: [1] } }],
  layouts: [
    { name: 'Default', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
  ],
}

const line = (page: Page) => page.getByTestId('list-filter-row')
const lensSwitch = (page: Page) => line(page).getByTestId('lens-switch')
const count = (page: Page) => line(page).getByTestId('list-count')
const rows = (page: Page) => page.locator('[data-todo-id]')

async function pickLens(page: Page, name: string) {
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  await expect(control).toHaveAccessibleName(`Lens: ${name}`)
}

/** The switch as drawn: its opacity, and whether a press at its centre reaches it. */
async function drawn(sw: Locator): Promise<{ opacity: string; takesPress: boolean }> {
  return sw.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return { opacity: getComputedStyle(el).opacity, takesPress: hit != null && el.contains(hit) }
  })
}

/** Moves the pointer off the workspace (onto the top bar's left end). */
async function pointerAway(page: Page) {
  await page.mouse.move(2, 2)
}

test('quiet while it follows the lens: shown on the cell’s hover, at the line’s end before the ⋯; off for this list it always shows and stays off after a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(rows(page)).toHaveCount(3)
  // No lens and no screen filter: nothing narrows the list — no count, no switch; alone in its cell, no tab (D26 AA1).
  await expect(count(page)).toHaveCount(0)
  await expect(lensSwitch(page)).toHaveCount(0)
  await expect(page.locator('[data-ws-table]').getByRole('tab')).toHaveCount(0)

  await pickLens(page, 'Aisha')
  await expect(rows(page)).toHaveCount(2)
  await expect(count(page)).toHaveText('2 of 3')
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'true')
  // The glasses alone: what it hides is in its tooltip.
  await expect(lensSwitch(page)).toHaveText('')
  await expect(lensSwitch(page)).toHaveAttribute('data-lens-hides', '1')

  // At rest: hidden, its room kept, and a press there doesn't reach it.
  await pointerAway(page)
  const atRest = await box(lensSwitch(page))
  expect(atRest.width).toBeGreaterThan(0)
  await expect.poll(() => drawn(lensSwitch(page))).toEqual({ opacity: '0', takesPress: false })
  // The cell hovered: shown, in the same place.
  await line(page).hover()
  await expect.poll(() => drawn(lensSwitch(page))).toEqual({ opacity: '1', takesPress: true })
  expect(await box(lensSwitch(page))).toEqual(atRest)

  // Left to right: the count, group · sort, the switch, then the cell's ⋯ (shown on hover).
  const s = await box(lensSwitch(page))
  const c = await box(count(page))
  const summary = await box(line(page).getByTestId('list-summary'))
  const more = await box(line(page).getByRole('button', { name: 'Cell options' }))
  expect(c.x + c.width).toBeLessThanOrEqual(summary.x + 0.5)
  expect(summary.x + summary.width).toBeLessThanOrEqual(s.x + 0.5)
  expect(s.x + s.width).toBeLessThanOrEqual(more.x + 0.5)
  expect(Math.abs((s.y + s.height / 2) - (c.y + c.height / 2))).toBeLessThan(2)
  await lensSwitch(page).hover()
  await expect(page.getByRole('tooltip')).toContainText('“Aisha” hides 1 here')

  await lensSwitch(page).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(lensSwitch(page)).not.toContainText('−')
  // Nothing narrows it now: no count.
  await expect(count(page)).toHaveCount(0)
  // Ignoring the lens is the exception it flags: shown at rest.
  await pointerAway(page)
  await expect.poll(() => drawn(lensSwitch(page))).toEqual({ opacity: '1', takesPress: true })
  // Saved at once, not a list edit: no Revert · Save.
  await expect(line(page).getByRole('button', { name: /^Save/ })).toHaveCount(0)

  await page.reload()
  await expect(rows(page)).toHaveCount(3)
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await lensSwitch(page).click()
  await expect(rows(page)).toHaveCount(2)
})

test('hidden at rest, the switch is still a tab stop: the keyboard focus shows it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Aisha')
  await pointerAway(page)
  await expect.poll(() => drawn(lensSwitch(page))).toEqual({ opacity: '0', takesPress: false })
  // The group · sort summary just before it, then Tab.
  await line(page).getByTestId('list-summary').focus()
  await page.keyboard.press('Tab')
  await expect(lensSwitch(page)).toBeFocused()
  await expect.poll(async () => (await drawn(lensSwitch(page))).opacity).toBe('1')
  await page.keyboard.press('Enter')
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(rows(page)).toHaveCount(3)
})

test('applying a lens that hides nothing here keeps the switch under the focus, its name fixed', async ({ page }) => {
  // Aisha's list ignores the Aisha lens: applied, it would hide nothing here.
  await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', people: ['Aisha Rahman'], ignoreLens: true }] })
  await pickLens(page, 'Aisha')
  await expect(rows(page)).toHaveCount(2)
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(lensSwitch(page)).toHaveAccessibleName('Apply the lens “Aisha” here')
  await lensSwitch(page).focus()
  await page.keyboard.press('Enter')
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(lensSwitch(page)).toHaveAttribute('data-lens-hides', '0')
  await expect(lensSwitch(page)).toHaveAccessibleName('Apply the lens “Aisha” here')
  await expect(lensSwitch(page)).toBeFocused()
  // And back off from the keyboard.
  await page.keyboard.press('Enter')
  await expect(lensSwitch(page)).toHaveAttribute('aria-pressed', 'false')
  await expect(lensSwitch(page)).toBeFocused()
})

test('with the filter line hidden, its top line ends with the switch after its count, and its menu turns the lens off here', async ({ page }) => {
  await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', showFilterLine: false }] })
  await pickLens(page, 'Aisha')
  // Alone in its cell: its slim top line stands for the tab (D26 AA1).
  const t1 = page.locator('[data-ws-tab="t1"]')
  await expect(t1).toHaveAttribute('data-testid', 'list-name-line')
  await expect(t1.getByTestId('lens-switch')).toHaveAttribute('data-lens-hides', '1')
  await expect(t1).toContainText('2 of 3')
  await t1.getByTestId('top-line-name').click({ button: 'right' })
  await page.getByRole('menuitemcheckbox', { name: 'Apply lens “Aisha” here' }).click()
  await expect(rows(page)).toHaveCount(3)
  await expect(t1.getByTestId('lens-switch')).toHaveAttribute('aria-pressed', 'false')
  await expect(t1).not.toContainText('of 3')
})
