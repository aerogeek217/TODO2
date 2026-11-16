import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsRow } from './fixtures/workspace'
import { taskRowByTitle } from './fixtures/seed'

/**
 * One tooltip everywhere (flair P9): every hover text is the app's tooltip
 * (`role="tooltip"`, `TooltipHost` reading `data-tooltip`), none the
 * browser's native `title` — a top-bar button with its shortcut, a layout
 * tab, a calendar entry, a list's group · sort summary.
 */

const SEED = {
  listDefinitions: [{ name: 'Tasks' }],
  tasks: [{ title: 'Send the agenda', dueInDays: 0 }, { title: 'Plan the offsite' }],
  layouts: [
    {
      name: 'Main',
      columns: [
        { id: 'colA', rows: [wsRow({ id: 'a1', tabs: [{ id: 'listTab', kind: 'lens', listDefIdx: 0 }] })] },
        { id: 'colB', rows: [wsRow({ id: 'b1', tabs: [{ id: 'calTab', kind: 'calendar', titles: true }] })] },
      ],
    },
    { name: 'Planning', columns: [] },
  ],
}

/** Hovers `target` and expects the app's tooltip to say `text`. */
async function expectTooltip(page: Page, target: Locator, text: string | RegExp) {
  await page.mouse.move(0, 300)
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await target.hover()
  await expect(page.getByRole('tooltip')).toHaveText(text)
  await expect(target).toHaveAttribute('aria-describedby', /.+/)
}

/** Every widget kind on one layout, a task of each kind of date and marker. */
const EVERY_KIND = {
  people: ['Ada Lovelace'],
  tags: ['Project: Atlas'],
  listDefinitions: [{ name: 'Tasks' }],
  tasks: [
    { title: 'Ship the beta', focus: true, dueInDays: 2, tags: ['Project: Atlas'], people: ['Ada Lovelace'] },
    { title: 'Renew the domain', dueInDays: -1, modifiedInDays: -40, tags: ['Project: Atlas'] },
    { title: 'Pay the invoice', dueInDays: 0 },
    { title: 'Closed already', completedInDays: -1 },
  ],
  layouts: [{
    name: 'Everything',
    columns: [
      { id: 'c1', rows: [
        wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }] }),
        wsRow({ id: 'k2', tabs: [{ id: 'cal', kind: 'calendar', titles: true }] }),
        wsRow({ id: 'k3', tabs: [{ id: 'notes', kind: 'notes' }, { id: 'review', kind: 'review' }] }),
      ] },
      { id: 'c2', rows: [
        { cells: [
          { id: 'k4', tabs: [{ id: 'n1', kind: 'number', glance: { metric: 'open' } }, { id: 'n2', kind: 'number', glance: { metric: 'overdue' } }] },
        ] },
        wsRow({ id: 'k5', tabs: [{ id: 'bd', kind: 'breakdown', glance: { name: 'People', splitBy: 'people' } }] }),
        wsRow({ id: 'k6', tabs: [{ id: 'pv', kind: 'pivot' }, { id: 'tr', kind: 'trend' }] }),
      ] },
      { id: 'c3', rows: [
        wsRow({ id: 'k7', tabs: [{ id: 'pulse', kind: 'pulse', tagNames: ['Project: Atlas'] }] }),
        wsRow({ id: 'k8', tabs: [{ id: 'map', kind: 'neglect' }] }),
      ] },
    ],
  }],
}

/** Elements with a native title, by a short description (an iframe's `title` is its name: allowed). */
const nativeTitles = (page: Page) => page.locator('[title]:not(iframe)').evaluateAll((els) => els.map((e) => e.outerHTML.slice(0, 120)))

test('no element has a native title: every widget kind, the task editor, Settings', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 })
  await seedWorkspace(page, EVERY_KIND)
  await expect(page.locator('[data-cal-entry]').first()).toBeVisible()
  expect(await nativeTitles(page)).toEqual([])
  // The pivot and trend behind their tabs, the review.
  for (const tab of ['tr', 'review']) {
    await page.locator(`[data-ws-tab="${tab}"]`).click()
    expect(await nativeTitles(page)).toEqual([])
  }
  await taskRowByTitle(page, 'Ship the beta').locator('span[data-task-title="Ship the beta"]').dblclick()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await nativeTitles(page)).toEqual([])
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('dialog', { name: /Settings/ })).toBeVisible()
  expect(await nativeTitles(page)).toEqual([])
})

test('the app’s tooltip on a top-bar button (with its shortcut), a layout tab, a calendar entry and a list’s summary', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 800 })
  await seedWorkspace(page, SEED)
  await expectTooltip(page, page.getByRole('button', { name: 'Settings' }), /^Settings.*S$/)
  await expectTooltip(page, page.getByTestId('layout-tab').filter({ hasText: 'Planning' }), 'Planning')
  await expectTooltip(page, page.locator('[data-cal-entry]').first(), /Send the agenda/)
  await expectTooltip(page, page.getByTestId('list-summary'), 'Edit list “Tasks”')
  // A press closes it.
  await page.mouse.down()
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await page.mouse.up()
})
