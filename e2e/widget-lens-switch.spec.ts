import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsRow, type WorkspaceSeed, expectLayoutStored } from './fixtures/workspace'

/**
 * One lens switch on every widget the top bar's filter reaches (G3, board
 * BD): the list's glasses with `−N` — in a cell shown at rest while the lens
 * hides tasks there, else only on the cell's hover and focus (UX cleanup 2A,
 * as restated) —, at the right end of the widget's
 * header before the cell's ⋯ — a Number's over its top-right corner, as
 * its label is inside its button — slashed once the widget ignores the
 * lens, saved at once (never an unsaved layout edit), its data following.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Ben Ortiz'],
  tasks: [
    { title: 'Aisha due', people: ['Aisha Rahman'], dueInDays: 1 },
    { title: 'Ben due', people: ['Ben Ortiz'], dueInDays: 2 },
    { title: 'Ben later', people: ['Ben Ortiz'], dueInDays: 3 },
  ],
  lenses: [
    { id: 'lens-aisha', name: 'Aisha', predicate: { personIds: [1] } },
    // Every task has one of them: the lens hides nothing anywhere here.
    { id: 'lens-both', name: 'Both', predicate: { personIds: [1, 2] } },
  ],
  layouts: [{
    name: 'Main',
    columns: [
      { id: 'c1', weight: 2, rows: [wsRow({ id: 'k1', tabs: [{ id: 'cal', kind: 'calendar' }] })] },
      {
        id: 'c2',
        weight: 1,
        rows: [
          wsRow({ id: 'k2', tabs: [{ id: 'num', kind: 'number', glance: { name: 'Open' } }] }),
          wsRow({ id: 'k3', tabs: [{ id: 'nm', kind: 'neglect' }, { id: 'pv', kind: 'pivot' }] }),
        ],
      },
    ],
  }],
}

async function pickLens(page: Page, name: string) {
  const control = page.locator('header').getByRole('button', { name: /^Lens:/ })
  await control.click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  await expect(control).toHaveAccessibleName(`Lens: ${name}`)
}

const calendar = (page: Page) => page.locator('[data-calendar-widget="cal"]')
const number = (page: Page) => page.locator('[data-glance-tab="num"]')

/** A switch as drawn: its opacity, and whether a press at its centre reaches it (or its wrapper). */
const drawnAt = (sw: Locator) => sw.evaluate((el) => {
  const r = el.getBoundingClientRect()
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
  // A floating switch's wrapper (its only child the switch) counts as the switch: it must not take the press either.
  const wrapper = el.parentElement != null && el.parentElement.childElementCount === 1 ? el.parentElement : null
  return { opacity: getComputedStyle(el).opacity, onSwitch: hit != null && (el.contains(hit) || hit === wrapper) }
})

test('the calendar’s switch ends its header; a click ignores the lens there and outlasts a reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(page.getByTestId('lens-switch')).toHaveCount(0)
  await pickLens(page, 'Aisha')
  const sw = calendar(page).getByTestId('lens-switch')
  // It hides tasks here: shown at rest with its −N.
  await expect(sw).toHaveText('−2')
  await expect(sw).toHaveAttribute('data-lens-hides', '2')
  await expect(sw).toHaveAttribute('aria-pressed', 'true')
  // The header's last control before the ⋯ (shown on hover).
  await calendar(page).getByTestId('calendar-range-label').hover()
  const more = (await page.locator('[data-ws-tab="cal"]').getByRole('button', { name: 'Cell options' }).boundingBox())!
  const sb = (await sw.boundingBox())!
  const view = (await calendar(page).getByRole('group', { name: 'Calendar view' }).boundingBox())!
  expect(view.x + view.width).toBeLessThanOrEqual(sb.x + 0.5)
  expect(sb.x + sb.width).toBeLessThanOrEqual(more.x + 0.5)
  await sw.click()
  await expect(sw).toHaveAttribute('aria-pressed', 'false')
  await expect(sw).not.toContainText('−')
  await expectLayoutStored(page)
  await page.reload()
  await expect(calendar(page).getByTestId('lens-switch')).toHaveAttribute('aria-pressed', 'false')
})

test('a Number’s switch sits over its top-right corner, left of the cell’s ⋯; its count follows it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Aisha')
  const count = number(page).getByTestId('number-count')
  await expect(count).toHaveText('1of 3')
  const sw = number(page).getByTestId('lens-switch')
  await expect(sw).toHaveAttribute('data-lens-hides', '2')
  await number(page).hover()
  const more = (await page.locator('[data-ws-cell="k2"]').getByRole('button', { name: 'Cell options' }).boundingBox())!
  const sb = (await sw.boundingBox())!
  expect(sb.x + sb.width).toBeLessThanOrEqual(more.x + 0.5)
  expect(Math.abs((sb.y + sb.height / 2) - (more.y + more.height / 2))).toBeLessThan(4)
  await sw.click()
  await expect(count).toHaveText('3')
  // Its ⋯ says the same.
  await page.locator('[data-ws-cell="k2"]').getByRole('button', { name: 'Cell options' }).click()
  await expect(page.getByRole('menuitemcheckbox', { name: 'Apply lens “Aisha” here' })).toHaveAttribute('aria-checked', 'false')
})

test('in a cell of several widgets the Neglect map’s switch floats over its corner, the Pivot’s ends its own header', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Aisha')
  const cell = page.locator('[data-ws-cell="k3"]')
  const floating = cell.locator('[data-neglect-map]').getByTestId('lens-switch')
  await expect(floating).toHaveAttribute('data-lens-hides', '2')
  // It hides tasks there: shown at rest over the corner, and it takes a press.
  await page.mouse.move(2, 2)
  await expect.poll(() => drawnAt(floating)).toEqual({ opacity: '1', onSwitch: true })
  await cell.getByRole('tab', { name: /Pivot/ }).click()
  const pivot = page.locator('[data-chart="pv"]')
  await expect(pivot.locator('[data-widget-top-line]').getByTestId('lens-switch')).toHaveAttribute('data-lens-hides', '2')
  await pivot.getByTestId('lens-switch').click()
  await expect(pivot.getByTestId('glance-section-count')).toHaveText('3 open')
})

test('a lens that hides nothing there: each widget’s switch kept in place, hidden at rest; the floating ones pass a press through to the widget', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Both')
  await page.mouse.move(2, 2)
  for (const sw of [calendar(page).getByTestId('lens-switch'), number(page).getByTestId('lens-switch'), page.locator('[data-neglect-map]').getByTestId('lens-switch')]) {
    await expect(sw).toHaveAttribute('data-lens-hides', '0')
    await expect(sw).toHaveAttribute('data-quiet', '')
    await expect.poll(() => drawnAt(sw)).toEqual({ opacity: '0', onSwitch: false })
  }
  // The cell hovered: the calendar's shows, and takes a press.
  await calendar(page).getByTestId('calendar-range-label').hover()
  await expect.poll(() => drawnAt(calendar(page).getByTestId('lens-switch'))).toEqual({ opacity: '1', onSwitch: true })
})
