import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, openLayoutAction, seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'

/**
 * The Dashboard tab menu and Customize dialog in a real browser: reordering
 * (grip drag and the keyboard lift) and hiding apply behind the dialog and
 * make the layout unsaved; the Hot flyout edits the app-wide rule (the Hot
 * tile follows, the layout stays saved); Copy summary writes the clipboard;
 * the gear → Add a list adds a tile whose dialog opens the list as a
 * tab (the dashboard itself has no add-a-list-tile button).
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  people: ['Alice Chen'],
  listDefinitions: [
    { name: 'Alice’s list', people: ['Alice Chen'] },
    { name: 'Everything' },
  ],
  tasks: [
    { title: 'Fix checkout outage', urgent: true, important: true, people: ['Alice Chen'] },
    { title: 'Plan the offsite', focus: true },
    { title: 'Call the plumber', urgent: true },
    { title: 'Vendor contract', important: true, people: ['Alice Chen'] },
  ],
  layouts: [{
    name: 'Dash',
    columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard' }] }] }],
  }],
}

const dash = (page: Page) => page.locator('[data-dashboard="dash"]')
const tileIds = (page: Page) => dash(page).locator('[data-dash-tile]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.dashTile))
const sectionIds = (page: Page) => dash(page).locator('[data-dash-section]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.dashSection))
const tileCount = (page: Page, id: string) => dash(page).locator(`[data-dash-tile="${id}"]`).getByTestId('dash-tile-count')
const customize = (page: Page) => page.getByRole('dialog', { name: 'Customize dashboard' })
const saveButton = (page: Page) => page.getByTestId('layout-save')

async function openTabMenu(page: Page): Promise<Locator> {
  await wsTab(page, 'dash').click({ button: 'right' })
  const menu = page.getByRole('menu', { name: 'Change widget' })
  await expect(menu).toBeVisible()
  return menu
}

async function openCustomize(page: Page): Promise<Locator> {
  const menu = await openTabMenu(page)
  await menu.getByRole('menuitem', { name: 'Customize dashboard…' }).click()
  await expect(customize(page)).toBeVisible()
  return customize(page)
}

/**
 * dnd-kit's live-region announcement (`Customize`'s `announcements`). A
 * keyboard move only lands once the previous one has rendered: the keyboard
 * sensor computes the next row from the last rendered `over`, so an arrow
 * press that arrives first targets the same row again — and an arrow press
 * right after the lift, before the lifted row and the rows are measured
 * (`sortableKeyboardCoordinates` has no `collisionRect` yet), does nothing.
 * So every lift waits for its first "is at position" announcement and every
 * move for its own before the next key.
 */
const announced = (page: Page, text: string) => expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: text })).toHaveCount(1)

/** A trusted-mouse drag of a row's grip onto another row (past the activation distance, in steps). */
async function dragGrip(page: Page, grip: Locator, onto: Locator, below: boolean) {
  const from = await pointIn(grip)
  const to = await pointIn(onto, 0.5, below ? 0.8 : 0.2)
  await drag(page, from, { x: from.x, y: to.y }, {
    // Lifted (past the activation distance) before it travels.
    lifted: () => expect(grip).toHaveAttribute('aria-pressed', 'true'),
  })
}

test('reordering and hiding in Customize show behind the dialog and make the layout unsaved', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  expect(await tileIds(page)).toEqual(['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue'])

  const dialog = await openCustomize(page)
  const tiles = dialog.getByRole('list', { name: 'Tiles' })

  // Pointer: drag Focus's grip above Open.
  await dragGrip(page, tiles.getByRole('button', { name: 'Move Focus' }), tiles.locator('[data-customize-row="tile:open"]'), false)
  await expect.poll(() => tileIds(page)).toEqual(['focus', 'open', 'hot', 'urgent', 'overdue', 'followupDue'])
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')

  // Keyboard: lift People's grip, move it up two, drop.
  const sections = dialog.getByRole('list', { name: 'Sections' })
  const peopleGrip = sections.getByRole('button', { name: 'Move People' })
  await peopleGrip.focus()
  await page.keyboard.press('Space')
  await expect(peopleGrip).toHaveAttribute('aria-pressed', 'true')
  await announced(page, 'People is at position 6 of 10.')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'People is at position 5 of 10.')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'People is at position 4 of 10.')
  await page.keyboard.press('Space')
  await expect(peopleGrip).not.toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => sectionIds(page)).toEqual(['hot', 'followup', 'next7', 'people', 'trend', 'status'])

  // Esc during a keyboard move cancels the move, not the dialog.
  await page.keyboard.press('Space')
  await expect(peopleGrip).toHaveAttribute('aria-pressed', 'true')
  await announced(page, 'People is at position 4 of 10.')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'People is at position 3 of 10.')
  await page.keyboard.press('Escape')
  await announced(page, 'Moving People was cancelled.')
  await expect(dialog).toBeVisible()
  await expect.poll(() => sectionIds(page)).toEqual(['hot', 'followup', 'next7', 'people', 'trend', 'status'])

  // Hide a tile and a section; show an extra tile.
  await tiles.getByRole('checkbox', { name: 'Overdue' }).uncheck()
  await sections.getByRole('checkbox', { name: 'Status' }).uncheck()
  await tiles.getByRole('checkbox', { name: 'Due today' }).check()
  await expect.poll(() => tileIds(page)).toEqual(['focus', 'open', 'hot', 'urgent', 'followupDue', 'dueToday'])
  await expect.poll(() => sectionIds(page)).toEqual(['hot', 'followup', 'next7', 'people', 'trend'])

  // An option: the trend range.
  await dialog.getByRole('button', { name: 'Range: 14 days' }).click()
  await page.getByRole('menuitemradio', { name: '4 weeks' }).click()
  await expect(dash(page).locator('[data-dash-section="trend"]')).toContainText('Last 4 weeks')

  // Esc closes; changes stay. Discard is the undo.
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  expect(await tileIds(page)).toEqual(['focus', 'open', 'hot', 'urgent', 'followupDue', 'dueToday'])
  await openLayoutAction(page, 'Discard changes')
  await expect.poll(() => tileIds(page)).toEqual(['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue'])
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
})

test('Customize also opens from the cell ⋯ menu and from the dashboard’s gear (hover or keyboard focus)', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(dash(page)).toBeVisible()
  await wsCell(page, 'k1').hover()
  await wsCell(page, 'k1').getByRole('button', { name: 'Cell options' }).click()
  const menu = page.getByRole('menu', { name: 'Cell options' })
  await expect(menu.getByRole('menuitem').first()).toHaveText('Customize dashboard…')
  await menu.getByRole('menuitem', { name: 'Customize dashboard…' }).click()
  await expect(customize(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(customize(page)).toHaveCount(0)

  const gear = dash(page).getByRole('button', { name: 'Customize dashboard' })
  await page.mouse.move(0, 0)
  await expect(gear).toHaveCSS('opacity', '0')
  await dash(page).locator('[data-dash-tile]').first().hover()
  await expect(gear).toHaveCSS('opacity', '1')
  await gear.click()
  await expect(customize(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(gear).toBeFocused()
  await page.mouse.move(0, 0)
  // Keyboard focus shows it too.
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(gear).toBeFocused()
  await expect(gear).toHaveCSS('opacity', '1')
})

/** The boxes of every tile, list tile and section that intersect the gear's box. */
async function coveredByGear(page: Page): Promise<string[]> {
  const gear = await box(dash(page).getByRole('button', { name: 'Customize dashboard' }))
  const targets = dash(page).locator('[data-dash-tile], [data-dash-list-tile], [data-dash-section]')
  const boxes = await targets.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect()
    const h = el as HTMLElement
    return { id: h.dataset.dashTile ?? h.dataset.dashListTile ?? h.dataset.dashSection ?? h.textContent ?? '', x: r.x, y: r.y, w: r.width, h: r.height }
  }))
  return boxes
    .filter((b) => b.x < gear.x + gear.width && gear.x < b.x + b.w && b.y < gear.y + gear.height && gear.y < b.y + b.h)
    .map((b) => b.id)
}

for (const { name, width, layout } of [
  { name: 'the grid', width: 1440, layout: 'grid' },
  { name: 'one column (below 1100px)', width: 1000, layout: 'column' },
]) {
  test(`the gear never covers a tile, list tile or section — ${name}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await seedWorkspace(page, SEED)
    await expect(dash(page)).toHaveAttribute('data-layout', layout)
    const gear = dash(page).getByRole('button', { name: 'Customize dashboard' })
    await dash(page).locator('[data-dash-tile]').last().hover()
    await expect(gear).toHaveCSS('opacity', '1')
    expect(await coveredByGear(page)).toEqual([])

    // The tile nearest the gear still takes the click while the gear shows.
    const tiles = dash(page).locator('[data-dash-tile]')
    const nearest = await tiles.evaluateAll((els) => {
      const rs = els.map((el) => el.getBoundingClientRect())
      return rs.reduce((best, r, i) => (r.top < (rs[best]?.top ?? Infinity) - 1 || (Math.abs(r.top - (rs[best]?.top ?? 0)) <= 1 && r.right > (rs[best]?.right ?? 0)) ? i : best), 0)
    })
    await tiles.nth(nearest).getByTestId('dash-tile-count').click()
    await expect(page.locator('[data-task-dialog]')).toBeVisible()
    await page.keyboard.press('Escape')

    // With the tiles hidden, the next row (the list tiles strip) keeps the slot free instead.
    const dialog = await openCustomize(page)
    const checked = dialog.getByRole('list', { name: 'Tiles' }).getByRole('checkbox', { checked: true })
    while (await checked.count() > 0) await checked.first().uncheck()
    await expect(dash(page).locator('[data-dash-tile]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(customize(page)).toHaveCount(0)
    await dash(page).hover({ position: { x: 200, y: 200 } })
    await expect(gear).toHaveCSS('opacity', '1')
    expect(await coveredByGear(page)).toEqual([])
  })
}

test('the Hot flyout edits the app-wide rule: the Hot tile follows, the layout stays saved', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(tileCount(page, 'hot')).toHaveText('2')

  const menu = await openTabMenu(page)
  const hotIs = menu.getByRole('menuitem', { name: /Hot is/ })
  await expect(hotIs).toContainText('U+I or Focus')
  await hotIs.click()
  const flyout = page.getByRole('dialog', { name: 'Hot rule' })
  await expect(flyout).toBeVisible()
  await expect(flyout).toContainText('2 hot now')
  // Beside the menu, not over it.
  const menuBox = await menu.boundingBox()
  const flyoutBox = await flyout.boundingBox()
  expect(flyoutBox!.x).toBeGreaterThanOrEqual(menuBox!.x + menuBox!.width - 1)
  expect(Math.round(flyoutBox!.width)).toBe(316)

  // Line 1 without Important: Urgent OR Focus.
  await flyout.getByRole('group', { name: 'Hot rule line 1' }).getByRole('button', { name: /Important/ }).click()
  await expect(flyout).toContainText('3 hot now')
  await expect(tileCount(page, 'hot')).toHaveText('3')
  await expect(hotIs).toContainText('Urgent or Focus')
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')

  // Esc closes the flyout, then the menu.
  await page.keyboard.press('Escape')
  await expect(flyout).toHaveCount(0)
  await expect(menu).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
})

test('Copy summary writes the dashboard’s counts to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await seedWorkspace(page, { ...SEED, layouts: [{ name: 'Dash', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard', dashboard: { listTileIdxs: [0] } }] }] }] }] })
  await expect(tileCount(page, 'open')).toHaveText('4')

  const menu = await openTabMenu(page)
  await menu.getByRole('menuitem', { name: 'Copy summary' }).click()
  await expect(menu).toHaveCount(0)
  // (The OS clipboard may store the line break as CRLF.)
  await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n')))
    .toBe('Open 4 · Hot 2 · Focus 1 · Urgent 2 · Overdue 0 · Follow-up due 0\nAlice’s list 2')
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const blob = await items[0]!.getType('text/html')
    return blob.text()
  })
  expect(html).toContain('<b>Hot</b> 2')
})

test('the gear → Add a list adds a tile; its dialog opens the list as a tab', async ({ page }) => {
  // The layout's lists are the ones its tabs show: Alice's list in a second column.
  await seedWorkspace(page, {
    ...SEED,
    layouts: [{
      name: 'Dash',
      columns: [
        { id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 'dash', kind: 'dashboard' }] }] },
        { id: 'c2', cells: [{ id: 'k2', tabs: [{ id: 'alice', kind: 'lens', listDefIdx: 0 }] }] },
      ],
    }],
  })
  await expect(dash(page).locator('[data-dash-list-tile]')).toHaveCount(0)
  // No list tiles: no strip, and no button to add one there.
  await expect(dash(page).locator('[aria-label="List tiles"]')).toHaveCount(0)
  await expect(dash(page).getByRole('button', { name: /Add list tile/ })).toHaveCount(0)

  await dash(page).locator('[data-dash-tile]').first().hover()
  await dash(page).getByRole('button', { name: 'Customize dashboard' }).click()
  const dialog = customize(page)
  await dialog.getByRole('button', { name: 'Add a list' }).click()
  const lists = page.getByRole('menu', { name: 'Lists' })
  await lists.getByRole('menuitem', { name: /Alice’s list/ }).click()
  await expect(dialog.getByRole('list', { name: 'List tiles' })).toContainText('Alice’s list')
  // Behind the dialog, at once.
  await expect(dash(page).locator('[data-dash-list-tile]').getByTestId('dash-list-count')).toHaveText('2')
  await expect(saveButton(page)).toHaveAccessibleName('Save layout (unsaved changes)')
  await dialog.getByRole('button', { name: 'Done' }).click()
  await expect(dialog).toHaveCount(0)

  await dash(page).locator('[data-dash-list-tile]').click()
  const taskDialog = page.locator('[data-task-dialog]')
  await expect(taskDialog.getByRole('heading')).toHaveText('Alice’s list')
  await taskDialog.getByRole('button', { name: 'Open as tab' }).click()
  await expect(taskDialog).toHaveCount(0)
  const tabs = wsCell(page, 'k1').getByRole('tab')
  await expect(tabs).toHaveCount(2)
  await expect(tabs.nth(1)).toContainText('Alice’s list')
  await expect(tabs.nth(1)).toHaveAttribute('aria-selected', 'true')
})
