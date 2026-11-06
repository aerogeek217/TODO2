import { expect, test, type Page } from '@playwright/test'
import { box, pointIn } from './fixtures/geometry'
import { rowTitles } from './fixtures/seed'
import { drag, openSettings, seedWorkspace, wsCell, wsListWidget, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * Or groups in a real browser: a task must match every chip and every
 * group, and one filter of a group is enough. On a list's filter line a
 * chip's picker makes a group (Another filter (OR) › a field › a value), the
 * line reads it with "or", Save keeps it across a reload, and the group's
 * panel removes it. A lens with a group (Settings › Lenses) hides what none
 * of its filters keeps — its row says so in words and the counter follows.
 * An Eisenhower pane with a group reads it in its subtitle, and a drop the
 * group refuses names the group. The phone's Edit list sheet makes one too.
 */

const SEED: WorkspaceSeed = {
  people: ['Ann', 'Bob'],
  statuses: ['Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Hot one', urgent: true, important: true, focus: true },
    { title: 'Ann task', people: ['Ann'] },
    { title: 'Bob task', people: ['Bob'] },
    { title: 'Calm task' },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
}

const ALL = ['Hot one', 'Ann task', 'Bob task', 'Calm task']
const titles = (page: Page) => rowTitles(wsListWidget(page, 't1'))

test.describe('desktop', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  test('the filter line: Another filter (OR) makes a group; the line reads "or"; Save keeps it; Remove group brings the rows back', async ({ page }) => {
    await seedWorkspace(page, SEED)
    const widget = wsListWidget(page, 't1')
    await expect.poll(() => titles(page)).toEqual(ALL)

    // + Filter › Priority › Focus.
    await widget.getByRole('button', { name: 'Filter', exact: true }).click()
    await page.getByRole('menu', { name: 'Add a filter' }).getByRole('menuitem', { name: 'Priority' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Focus' }).click()
    await expect.poll(() => titles(page)).toEqual(['Hot one'])
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('list-filter-picker')).toHaveCount(0)

    // The chip's picker: Another filter (OR) › People › Ann.
    await widget.getByTestId('list-filter-chip').click()
    await page.getByTestId('list-filter-picker').getByRole('button', { name: /Another filter \(OR\)/ }).click()
    await page.getByTestId('or-group-panel').getByRole('button', { name: 'People' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Ann' }).click()
    await expect.poll(() => titles(page)).toEqual(['Hot one', 'Ann task'])
    await page.keyboard.press('Escape')
    const group = widget.getByTestId('or-group')
    await expect(group).toHaveText(/Priority\s*Focus\s*or\s*People\s*Ann/)
    await expect(group.getByTestId('list-filter-chip')).toHaveCount(2)

    // Saved, it is kept across a reload.
    await widget.getByTestId('save-list').click()
    await expect(widget.getByTestId('save-list')).toHaveCount(0)
    await page.reload()
    await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
    await expect.poll(() => titles(page)).toEqual(['Hot one', 'Ann task'])
    await expect(group).toHaveText(/Priority\s*Focus\s*or\s*People\s*Ann/)

    // The group's panel (its "or"): Remove group, with its 2 filters.
    await group.getByRole('button', { name: 'Group' }).click()
    const panel = page.getByRole('dialog', { name: 'Group' })
    await expect(panel.getByRole('button', { name: /Remove group/ })).toContainText('with its 2 filters')
    await panel.getByRole('button', { name: /Remove group/ }).click()
    await expect(group).toHaveCount(0)
    await expect.poll(() => titles(page)).toEqual(ALL)
  })

  test('a lens with a group hides what none of its filters keeps; its row reads the group; the counter follows', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      lenses: [{ id: 'lens-focus', name: 'Triage', predicate: { markers: [{ values: ['focus'] }] } }],
    })
    const tray = page.locator('header').getByRole('group', { name: 'Screen filters — apply to every widget' })
    await page.locator('header').getByRole('button', { name: /^Lens:/ }).click()
    await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Triage/ }).click()
    await expect.poll(() => titles(page)).toEqual(['Hot one'])
    const counter = tray.getByRole('button', { name: /tasks shown(, .+)?\. Show them$/ })
    await expect(counter).toHaveAccessibleName('1 of 4 open tasks shown. Show them')

    const settings = await openSettings(page, 'Tasks')
    const lenses = settings.getByTestId('lens-list')
    await lenses.getByRole('button', { name: /^Triage/ }).click()
    const editor = settings.getByTestId('lens-filter')
    await editor.getByTestId('list-filter-chip').click()
    await page.getByTestId('list-filter-picker').getByRole('button', { name: /Another filter \(OR\)/ }).click()
    await page.getByTestId('or-group-panel').getByRole('button', { name: 'People' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Ann' }).click()
    await expect(editor.getByTestId('or-group')).toHaveText(/Priority\s*Focus\s*or\s*People\s*Ann/)
    await expect(settings.getByTestId('lens-keeps')).toContainText('Keeps 2 of 4 open tasks')
    await expect(lenses.getByRole('button', { name: /^Triage/ })).toContainText('Priority Focus or People Ann')
    // Unsaved until Save: the top bar keeps the saved lens.
    await expect(counter).toHaveAccessibleName('1 of 4 open tasks shown. Show them')
    await settings.getByRole('button', { name: 'Save lens Triage' }).click()
    await expect(settings.getByTestId('save-lens')).toHaveCount(0)
    await settings.getByRole('button', { name: 'Close settings' }).click()

    await expect.poll(() => titles(page)).toEqual(['Hot one', 'Ann task'])
    await expect(counter).toHaveAccessibleName('2 of 4 open tasks shown. Show them')
  })

  test('an Eisenhower pane with a group: the subtitle reads it, and a drop it refuses names the group', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      layouts: [{
        name: 'Main',
        columns: [
          { id: 'colA', cells: [{ id: 'a1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] },
          { id: 'colB', weight: 2, cells: [{ id: 'b1', tabs: [{ id: 'eisTab', kind: 'eisenhower' }] }] },
        ],
      }],
    })
    const quadrant = (q: string) => page.locator('[data-eisenhower="eisTab"]').locator(`[data-eis-quadrant="${q}"]`)
    await wsTab(page, 'eisTab').click({ button: 'right' })
    await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitem', { name: 'Customize panes…' }).click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    const card = settings.locator('[data-pane-card="do"]')
    // The pane's chip opens its picker as a popover; Another filter (OR) › Status › Waiting.
    await card.getByTestId('list-filter-chip').filter({ hasText: 'Important' }).click()
    await page.getByTestId('list-filter-picker').getByRole('button', { name: /Another filter \(OR\)/ }).click()
    await page.getByTestId('or-group-panel').getByRole('button', { name: 'Status' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Waiting' }).click()
    await expect(card.getByTestId('or-group')).toHaveText(/Priority\s*Important\s*or\s*Status\s*Waiting/)
    await settings.getByRole('button', { name: 'Close settings' }).click()
    await expect(settings).toHaveCount(0)

    await expect(quadrant('do').getByTestId('eisenhower-pane-subtitle')).toHaveText('Urgent · Important or Waiting')
    // The group writes nothing: a task none of its filters keeps is refused, naming the group.
    const from = wsCell(page, 'a1').locator('[data-row-key]').filter({ hasText: 'Calm task' })
    const a = await box(from)
    await drag(page, { x: a.x + 12, y: a.y + a.height / 2 }, await pointIn(quadrant('do'), 0.5, 0.6), {
      during: async () => {
        await expect(quadrant('do')).toHaveAttribute('data-drop-state', 'refused')
        const tip = page.getByTestId('eisenhower-refusal')
        await expect(tip).toContainText('Can’t move to Do')
        await expect(tip).toContainText('Calm task doesn’t match any filter in its group (Priority Important or Status Waiting).')
      },
    })
    await expect(page.getByTestId('eisenhower-refusal')).toHaveCount(0)
  })
})

test.describe('a group of one, and long groups', () => {
  test.use({ viewport: { width: 1600, height: 900 } })

  const LONG = 'a really long piece of search text that keeps on going well past the width of any editor'
  const longGroup = { personIds: null, statusIds: null, searchText: LONG, dates: {}, markers: [{ values: ['urgent'] }, { values: ['important'] }, { values: ['focus'], not: true }], tags: null }

  /** Nothing of a stack's or groups runs past its plate, and no plate past its block. */
  async function expectNoSpill(page: Page) {
    const stack = page.getByTestId('filter-stack').filter({ has: page.getByTestId('or-group') }).first()
    await expect(stack).toBeVisible()
    const spill = await stack.evaluate((host) => {
      const right = host.getBoundingClientRect().right
      return [...host.querySelectorAll('[data-testid="or-group"]')].flatMap((plate) => {
        const edge = plate.getBoundingClientRect().right
        const past = [...plate.querySelectorAll('[data-testid="list-filter-chip"], button')]
          .filter((el) => el.getBoundingClientRect().right > edge + 0.5).length
        return [edge > right + 0.5 ? 1 : 0, past, plate.scrollWidth - plate.clientWidth]
      })
    })
    expect(spill.every((n) => n <= 0)).toBe(true)
  }

  test('a long group stays inside Edit list, a lens and an Eisenhower pane, its text wrapping', async ({ page }) => {
    await seedWorkspace(page, {
      ...SEED,
      listDefinitions: [{ name: 'Team', predicate: { orGroups: [longGroup] } }],
      lenses: [{ id: 'lens-long', name: 'Long', predicate: { orGroups: [longGroup] } }],
      eisenhower: { panes: { do: { filter: { orGroups: [longGroup] } } } },
    })
    await wsTab(page, 't1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit list…' }).click()
    await expectNoSpill(page)
    await page.keyboard.press('Escape')

    const settings = await openSettings(page, 'Tasks')
    await settings.getByTestId('lens-list').getByRole('button', { name: /^Long/ }).click()
    await expectNoSpill(page)
    await settings.getByTestId('lens-list').getByRole('button', { name: /^Long/ }).click()
    const pane = settings.locator('[data-pane-card="do"]')
    await pane.scrollIntoViewIfNeeded()
    await expect(pane.getByTestId('or-group')).toBeVisible()
    const [paneRight, plateRight] = await Promise.all([
      pane.evaluate((el) => el.getBoundingClientRect().right),
      pane.getByTestId('or-group').evaluate((el) => el.getBoundingClientRect().right),
    ])
    expect(plateRight).toBeLessThanOrEqual(paneRight)
  })

  test('× leaves one item: the group goes and the item stays, in its place; the list stays as it was on opening', async ({ page }) => {
    const grouped = { personIds: null, statusIds: null, searchText: 'task', dates: {}, markers: [{ values: ['focus'] }], tags: null }
    await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', predicate: { orGroups: [grouped] } }] })
    const widget = wsListWidget(page, 't1')
    const save = page.getByRole('button', { name: 'Save list' })
    await wsTab(page, 't1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit list…' }).click()
    // Opening writes nothing: a stored group of two is left alone.
    await expect(save).toBeDisabled()
    await page.keyboard.press('Escape')

    await widget.getByTestId('or-group').getByTestId('list-filter-chip').filter({ hasText: 'Text' }).getByRole('button', { name: 'Remove filter' }).click()
    await expect(widget.getByTestId('or-group')).toHaveCount(0)
    await expect(widget.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Focus/)
    await expect.poll(() => titles(page)).toEqual(['Hot one'])
  })

  test('emptied in its picker: the group waits while the picker is open and goes when it closes', async ({ page }) => {
    const grouped = { personIds: null, statusIds: null, searchText: 'task', dates: {}, markers: [{ values: ['focus'] }], tags: null }
    await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', predicate: { orGroups: [grouped] } }] })
    const widget = wsListWidget(page, 't1')
    await widget.getByTestId('list-filter-chip').filter({ hasText: 'Text' }).click()
    const field = page.getByTestId('list-filter-picker').getByRole('textbox')
    await field.fill('')
    await expect(widget.getByTestId('or-group')).toHaveCount(1)
    await field.fill('Ann')
    await expect(widget.getByTestId('or-group').getByTestId('list-filter-chip')).toHaveCount(2)
    await field.fill('')
    await page.keyboard.press('Escape')
    await expect(widget.getByTestId('or-group')).toHaveCount(0)
    await expect(widget.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Focus/)
  })

  test('a stored group of one reads as its chip, and the list isn\'t unsaved for it', async ({ page }) => {
    const single = { personIds: null, statusIds: null, searchText: '', dates: {}, markers: [{ values: ['focus'] }], tags: null }
    await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', predicate: { orGroups: [single] } }] })
    const widget = wsListWidget(page, 't1')
    await expect(widget.getByTestId('or-group')).toHaveCount(0)
    await expect(widget.getByTestId('list-filter-chip')).toHaveText(/Priority\s*Focus/)
    await wsTab(page, 't1').click({ button: 'right' })
    await page.getByRole('menuitem', { name: 'Edit list…' }).click()
    await expect(page.getByRole('button', { name: 'Save list' })).toBeDisabled()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('the Edit list sheet makes a group from a chip; the list behind follows', async ({ page }) => {
    await seedWorkspace(page, { ...SEED, listDefinitions: [{ name: 'Team', predicate: { markers: [{ values: ['focus'] }] } }] })
    const shown = async () => (await wsCell(page, 'k1').locator('[data-todo-id]').allTextContents())
      .map((text) => ALL.find((title) => text.includes(title)) ?? text)
    await expect.poll(shown).toEqual(['Hot one'])
    await wsTab(page, 't1').dispatchEvent('contextmenu')
    await page.getByRole('menu', { name: 'List' }).getByRole('menuitem', { name: 'Edit list…' }).click()
    const sheet = page.getByRole('dialog', { name: 'Edit list Team' })
    await expect(sheet).toBeVisible()
    await sheet.getByTestId('list-filter-chip').click()
    await page.getByTestId('list-filter-picker').getByRole('button', { name: /Another filter \(OR\)/ }).click()
    await page.getByTestId('or-group-panel').getByRole('button', { name: 'People' }).click()
    await page.getByTestId('list-filter-picker').getByRole('option', { name: 'Ann' }).click()
    await expect(sheet.getByTestId('or-group')).toHaveText(/Priority\s*Focus\s*or\s*People\s*Ann/)
    await expect.poll(shown).toEqual(['Hot one', 'Ann task'])
  })
})
