import { expect, test, type Locator, type Page } from '@playwright/test'
import { drag, openSettings, seedWorkspace, type WorkspaceSeed, wsRow } from './fixtures/workspace'

/**
 * cr25 P2: Settings › Tasks › Lenses reorders by a row's grip — dragged
 * with the mouse or moved from the keyboard (Space, the arrows, Space; Esc
 * cancels the drag and Settings stays open). The order is saved at once and
 * is the top bar picker's; an open lens drags open.
 */

const SEED: WorkspaceSeed = {
  tasks: [{ title: 'Plan' }],
  lenses: [
    { id: 'lens-a', name: 'Alpha', predicate: {} },
    { id: 'lens-b', name: 'Beta', predicate: {} },
    { id: 'lens-c', name: 'Gamma', predicate: {} },
  ],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'notes' }] })] }] }],
}

/** What the drag's live region says (dnd-kit's). */
const announced = (page: Page, text: string) => expect(page.locator('[id^="DndLiveRegion"]').filter({ hasText: text })).toHaveCount(1)

test.use({ viewport: { width: 1440, height: 900 } })

async function openLenses(page: Page): Promise<Locator> {
  const settings = await openSettings(page, 'Tasks')
  const list = settings.getByTestId('lens-list')
  await list.scrollIntoViewIfNeeded()
  return list
}

/** The lens rows' ids, top to bottom. */
function rowOrder(list: Locator): Promise<string[]> {
  return list.locator('[data-lens-id]').evaluateAll((els) => els.map((el) => (el as HTMLElement).dataset.lensId ?? ''))
}

/** The top bar picker's lens names, top to bottom (No lens first). */
async function pickerOrder(page: Page): Promise<string[]> {
  await page.locator('header').getByRole('button', { name: /^Lens:/ }).click()
  const menu = page.getByRole('menu', { name: 'Lens' })
  const names = await menu.getByRole('menuitemradio').evaluateAll((els) =>
    els.map((el) => ['No lens', 'Alpha', 'Beta', 'Gamma'].find((n) => el.textContent?.startsWith(n)) ?? '?'))
  await page.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)
  return names
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('not laid out')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

test('dragging a grip moves the lens — saved at once, the picker’s order, kept on reload; an open lens drags open', async ({ page }) => {
  await seedWorkspace(page, SEED)
  let list = await openLenses(page)
  expect(await rowOrder(list)).toEqual(['lens-a', 'lens-b', 'lens-c'])

  // Gamma to the top.
  const top = await list.locator('[data-lens-id="lens-a"]').boundingBox()
  await drag(page, await centre(list.getByRole('button', { name: 'Move Gamma' })), { x: top!.x + 40, y: top!.y + 4 })
  await expect.poll(() => rowOrder(list)).toEqual(['lens-c', 'lens-a', 'lens-b'])

  // Alpha, open, to the bottom: it stays open.
  await list.getByRole('button', { name: /^Alpha/, expanded: false }).click()
  await expect(list.getByTestId('lens-keeps')).toBeVisible()
  const last = await list.locator('[data-lens-id="lens-b"]').boundingBox()
  await drag(page, await centre(list.getByRole('button', { name: 'Move Alpha' })), { x: last!.x + 40, y: last!.y + last!.height - 4 })
  await expect.poll(() => rowOrder(list)).toEqual(['lens-c', 'lens-b', 'lens-a'])
  await expect(list.getByRole('button', { name: /^Alpha/, expanded: true })).toBeVisible()
  await expect(list.getByTestId('lens-keeps')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toHaveCount(0)
  expect(await pickerOrder(page)).toEqual(['No lens', 'Gamma', 'Beta', 'Alpha'])

  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  expect(await pickerOrder(page)).toEqual(['No lens', 'Gamma', 'Beta', 'Alpha'])
  list = await openLenses(page)
  expect(await rowOrder(list)).toEqual(['lens-c', 'lens-b', 'lens-a'])
})

test('from the keyboard: Space, an arrow, Space moves a lens; Esc cancels the drag and leaves Settings open', async ({ page }) => {
  await seedWorkspace(page, SEED)
  const list = await openLenses(page)
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })

  const grip = list.getByRole('button', { name: 'Move Alpha' })
  await grip.focus()
  await page.keyboard.press('Space')
  await expect(grip).toHaveAttribute('aria-pressed', 'true')
  await announced(page, 'Alpha is at position 1 of 3.')
  await page.keyboard.press('ArrowDown')
  await announced(page, 'Alpha is at position 2 of 3.')
  await page.keyboard.press('Space')
  await expect(grip).not.toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => rowOrder(list)).toEqual(['lens-b', 'lens-a', 'lens-c'])

  // Held, then Esc: back in place, Settings still open.
  const gamma = list.getByRole('button', { name: 'Move Gamma' })
  await gamma.focus()
  await page.keyboard.press('Space')
  await expect(gamma).toHaveAttribute('aria-pressed', 'true')
  await announced(page, 'Gamma is at position 3 of 3.')
  await page.keyboard.press('ArrowUp')
  await announced(page, 'Gamma is at position 2 of 3.')
  await page.keyboard.press('Escape')
  await announced(page, 'Moving Gamma was cancelled.')
  await expect(settings).toBeVisible()
  await expect.poll(() => rowOrder(list)).toEqual(['lens-b', 'lens-a', 'lens-c'])

  // Esc again, nothing held: Settings closes.
  await page.keyboard.press('Escape')
  await expect(settings).toHaveCount(0)
  expect(await pickerOrder(page)).toEqual(['No lens', 'Beta', 'Alpha', 'Gamma'])
})
