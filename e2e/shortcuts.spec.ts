import { expect, test, type Page } from '@playwright/test'
import { drag, expectLayoutStep, expectLayoutStored, seedWorkspace, wsCell, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import { pointIn } from './fixtures/geometry'

/**
 * Shortcuts (2026-11-23): a tile per picked list, from any layout. Two
 * lists of two layouts are added from the widget; a tile shows its list
 * tab's icon, its badge capsule and its first titles; a click opens the
 * list in the widget popup over this layout; a drag reorders the tiles,
 * saved with the layout; and as the cell shrinks the titles go first, then
 * the tiles go to one line, then to rows.
 */

test.use({ viewport: { width: 1440, height: 900 } })

const SEED: WorkspaceSeed = {
  listDefinitions: [
    { name: 'Errands', layoutIdx: 0 },
    { name: 'Clients', layoutIdx: 1 },
  ],
  tasks: [
    { title: 'Call Acme', dueInDays: -1 },
    { title: 'Send the invoice' },
    { title: 'Renew the lease' },
    { title: 'Book the venue' },
  ],
  layouts: [
    {
      name: 'Home',
      columns: [
        { id: 'c1', weight: 2, rows: [wsRow({ id: 'k-errands', tabs: [{ id: 't-errands', kind: 'lens', listDefIdx: 0, icon: { kind: 'line', key: 'flag' } }] })] },
        { id: 'c2', weight: 1, rows: [wsRow({ id: 'k-sc', tabs: [{ id: 't-sc', kind: 'shortcuts' }] })] },
      ],
    },
    {
      name: 'Work',
      columns: [{ id: 'w1', rows: [wsRow({ id: 'k-clients', tabs: [{ id: 't-clients', kind: 'lens', listDefIdx: 1, icon: { kind: 'emoji', emoji: '💼' } }] })] }],
    },
  ],
}

const widget = (page: Page) => wsCell(page, 'k-sc').locator('[data-shortcuts]')
const tiles = (page: Page) => widget(page).locator('[data-shortcut-tile]')
const tile = (page: Page, name: string) => tiles(page).filter({ has: page.getByRole('button', { name: new RegExp(`^${name}: .*Open$`) }) })
const tileNames = (page: Page) => tiles(page).locator('[data-shortcut-name]').allTextContents()

async function addList(page: Page, name: string): Promise<void> {
  const add = widget(page).getByRole('button', { name: 'Add a list' })
  await add.click()
  await page.getByRole('menu', { name: 'Add a list' }).getByRole('menuitem', { name, exact: true }).click()
  await expectLayoutStep(page, `Added “${name}” to Shortcuts`)
}

test('two lists of two layouts: icon, capsule and titles; a click opens the list; a drag reorders, kept on reload', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(widget(page).getByText('No lists added.')).toBeVisible()
  // The menu: each layout's lists under its name, this layout first.
  await widget(page).getByRole('button', { name: 'Add a list' }).click()
  const menu = page.getByRole('menu', { name: 'Add a list' })
  await expect(menu.locator('[role="presentation"], [role="menuitem"]')).toHaveText(['Home', 'Errands', 'Work', 'Clients'])
  await page.keyboard.press('Escape')
  await addList(page, 'Errands')
  await addList(page, 'Clients')
  await expect.poll(() => tileNames(page)).toEqual(['Errands', 'Clients'])

  // The tile: its tab's icon, its capsule (one overdue), its count, its first titles; its layout in its tooltip.
  const clients = tile(page, 'Clients')
  await expect(clients.locator('[data-app-icon]')).toHaveCount(1)
  await expect(tile(page, 'Errands').locator('[data-app-icon="line"]')).toHaveCount(1)
  await expect(clients.locator('[data-shortcut-badge] [data-badge-part="due"]')).toHaveText('1')
  await expect(clients.locator('[data-shortcut-count]')).toHaveText('4')
  await expect(clients.locator('[data-peek-line]')).toHaveText(['Call Acme', 'Send the invoice', 'Renew the lease'])
  await expect(clients.getByRole('button', { name: /^Clients: .*Open$/ })).toHaveAttribute('data-tooltip', 'Clients · Work')

  // A click opens the list of the other layout in the popup, over this one.
  await clients.getByRole('button', { name: /^Clients: .*Open$/ }).click()
  const popup = page.getByTestId('widget-popup')
  await expect(popup).toHaveAttribute('aria-label', 'Clients')
  await expect(popup.getByText('Book the venue')).toBeVisible()
  await expect(page.locator('[data-layout-tab][aria-selected="true"]')).toHaveText('Home')
  await page.keyboard.press('Escape')
  await expect(popup).toHaveCount(0)

  // A drag puts Clients first: one undo step, and no popup opens.
  await drag(page, await pointIn(clients, 0.3, 0.2), await pointIn(tile(page, 'Errands'), 0.3, 0.2))
  await expect.poll(() => tileNames(page)).toEqual(['Clients', 'Errands'])
  await expectLayoutStep(page, 'Moved “Clients”')
  await expect(popup).toHaveCount(0)
  await page.reload()
  await expect.poll(() => tileNames(page)).toEqual(['Clients', 'Errands'])
})

test('as the cell shrinks the titles go first, then one line of tiles, then rows', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await addList(page, 'Errands')
  await addList(page, 'Clients')
  await expectLayoutStored(page)
  const face = () => widget(page).getAttribute('data-shortcuts-face')
  const peekLines = () => widget(page).locator('[data-peek-line]').count()
  await expect.poll(face).toBe('large')
  await expect.poll(peekLines).toBe(6)
  // A body about 400px wide: two tiles across, so the Add a list tile starts a second row.
  const wide = (await widget(page).boundingBox())?.width ?? 1
  const width = Math.round(1440 * 400 / wide)
  await page.setViewportSize({ width, height: 900 })
  await expect.poll(async () => Math.abs(((await widget(page).boundingBox())?.width ?? 0) - 400)).toBeLessThan(40)
  // Shorter and shorter, from a body about 320px tall (two rows of tiles): a large face with fewer titles comes before the compact one.
  const chrome = Math.round(900 - ((await widget(page).boundingBox())?.height ?? 0))
  let fewer = false
  let height = chrome + 320
  while ((await face()) === 'large' && height > chrome + 100) {
    height -= 4
    await page.setViewportSize({ width, height })
    await expect.poll(async () => Math.abs(((await widget(page).boundingBox())?.height ?? 0) - (height - chrome))).toBeLessThan(2)
    const lines = await peekLines()
    if ((await face()) === 'large' && lines < 6) fewer = true
  }
  expect(fewer).toBe(true)
  await expect.poll(face).toBe('compact')
  await expect(widget(page).locator('[data-peek-line]')).toHaveCount(0)
  await expect(tiles(page)).toHaveCount(2)
  // Narrow: a row per list.
  await page.setViewportSize({ width: 700, height: 900 })
  await expect.poll(face).toBe('rows')
  await expect.poll(() => tileNames(page)).toEqual(['Errands', 'Clients'])
})
