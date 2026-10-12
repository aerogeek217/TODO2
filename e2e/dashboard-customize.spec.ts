import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, wsCell, wsTab, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The Dashboard tab menu and Customize dialog in a real browser: reordering
 * (grip drag and the keyboard lift) and hiding apply behind the dialog and
 * make the layout unsaved; the Hot flyout edits the app-wide rule (the Hot
 * tile follows, the layout stays saved); Copy summary writes the clipboard;
 * "+ Add list tile" → Add a saved list adds a tile whose dialog opens the
 * list as a tab.
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
 * press that arrives first targets the same row again. Each move waits for
 * its announcement before the next key.
 */
const announced = (page: Page, text: string) => expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: text })).toHaveCount(1)

/** A trusted-mouse drag of a row's grip onto another row (past the activation distance, in steps). */
async function dragGrip(page: Page, grip: Locator, onto: Locator, below: boolean) {
  const from = await grip.boundingBox()
  const to = await onto.boundingBox()
  if (!from || !to) throw new Error('no box')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + 8, { steps: 4 })
  // Lifted (past the activation distance) before it travels.
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  const y = below ? to.y + to.height * 0.8 : to.y + to.height * 0.2
  await page.mouse.move(from.x + from.width / 2, y, { steps: 12 })
  await page.mouse.up()
}

test('reordering and hiding in Customize show behind the dialog and make the layout unsaved', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
  expect(await tileIds(page)).toEqual(['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'])

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
  await announced(page, 'People is at position 6 of 6.')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'People is at position 5 of 6.')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'People is at position 4 of 6.')
  await page.keyboard.press('Space')
  await expect(peopleGrip).not.toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => sectionIds(page)).toEqual(['hot', 'followup', 'next7', 'people', 'trend', 'status'])

  // Esc during a keyboard move cancels the move, not the dialog.
  await page.keyboard.press('Space')
  await expect(peopleGrip).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'People is at position 3 of 6.')
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
  await page.getByRole('button', { name: 'Layout: Dash' }).click()
  await page.getByRole('menuitem', { name: 'Discard changes' }).click()
  await expect.poll(() => tileIds(page)).toEqual(['open', 'hot', 'urgent', 'overdue', 'followupDue', 'focus'])
  await expect(saveButton(page)).toHaveAccessibleName('Layout saved')
})

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
    .toBe('Open 4 · Hot 2 · Urgent 2 · Overdue 0 · Follow-up due 0 · Focus 1\nAlice’s list 2')
  const html = await page.evaluate(async () => {
    const items = await navigator.clipboard.read()
    const blob = await items[0]!.getType('text/html')
    return blob.text()
  })
  expect(html).toContain('<b>Hot</b> 2')
})

test('“+ Add list tile” → Add a saved list adds a tile; its dialog opens the list as a tab', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(dash(page).locator('[data-dash-list-tile]')).toHaveCount(0)

  await dash(page).getByRole('button', { name: 'Add list tile' }).click()
  const dialog = customize(page)
  const add = dialog.getByRole('button', { name: 'Add a saved list' })
  await expect(add).toBeFocused()
  await add.click()
  const lists = page.getByRole('menu', { name: 'Saved lists' })
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
