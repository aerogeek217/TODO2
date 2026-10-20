import { expect, test, type Page } from '@playwright/test'
import {
  drag, layoutTab, layoutTabNames, openLayoutTab, openLayoutTabMenu, readListDefinitions, seedWorkspace, wsShape, wsTab,
  type WorkspaceSeed, type WsLayoutSeed,
} from './fixtures/workspace'
import { box, pointIn } from './fixtures/geometry'
import { readStore } from './fixtures/db'

/**
 * The layouts as tabs in the top bar: drag to reorder (saved at once, one
 * undo step, the picker shows the same order), Move left / right from a
 * tab's menu, New layout's name prompt (the layout is stored at once),
 * switching tabs with unsaved changes, Delete from a tab's menu, and the
 * measured fold — the filters fold first, then the tabs into the picker —
 * with nothing leaving the 40px bar.
 */

const layout = (name: string, tabId: string): WsLayoutSeed => ({
  name,
  columns: [{ id: `col-${tabId}`, cells: [{ id: `cell-${tabId}`, tabs: [{ id: tabId, kind: 'notes' }, { id: `${tabId}-cal`, kind: 'calendar' }] }] }],
})

const three: WorkspaceSeed = { layouts: [layout('Main', 'm'), layout('Second', 's'), layout('Third', 't')] }

/** The stored layouts' names in their order. */
async function storedOrder(page: Page): Promise<string[]> {
  const rows = await readStore<{ name: string; sortOrder: number; id: number }>(page, 'layouts')
  return rows.sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((r) => r.name)
}

test('dragging a tab reorders the layouts, saved at once (no unsaved dot); Undo puts it back; the picker shows the same order', async ({ page }) => {
  await seedWorkspace(page, three)
  expect(await layoutTabNames(page)).toEqual(['Main', 'Second', 'Third'])
  const from = await pointIn(layoutTab(page, 'Third'), 0.5, 0.5)
  const main = await box(layoutTab(page, 'Main'))
  await drag(page, from, { x: main.x + 4, y: main.y + main.height / 2 })
  await expect.poll(() => layoutTabNames(page)).toEqual(['Third', 'Main', 'Second'])
  // Not a layout change: Main is still open and saved.
  await expect(openLayoutTab(page)).toHaveText('Main')
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await expect.poll(() => storedOrder(page)).toEqual(['Third', 'Main', 'Second'])

  await expect(page.getByText('Moved layout “Third”')).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Second', 'Third'])
  await expect.poll(() => storedOrder(page)).toEqual(['Main', 'Second', 'Third'])

  // Again, then a reload keeps it; the folded picker lists the same order.
  await drag(page, await pointIn(layoutTab(page, 'Third'), 0.5, 0.5), { x: main.x + 4, y: main.y + main.height / 2 })
  await expect.poll(() => storedOrder(page)).toEqual(['Third', 'Main', 'Second'])
  await page.reload()
  await expect.poll(() => layoutTabNames(page)).toEqual(['Third', 'Main', 'Second'])
  // A window too narrow for the tabs (the picker then).
  await page.setViewportSize({ width: 700, height: 800 })
  await page.getByTestId('layout-picker').click()
  await expect(page.getByRole('menuitemradio')).toHaveText(['Third', 'Main', 'Second'])
})

test('a click on a tab after a drag still switches layouts', async ({ page }) => {
  await seedWorkspace(page, three)
  const second = await box(layoutTab(page, 'Second'))
  await drag(page, await pointIn(layoutTab(page, 'Main'), 0.5, 0.5), { x: second.x + second.width - 4, y: second.y + second.height / 2 })
  await expect.poll(() => layoutTabNames(page)).toEqual(['Second', 'Main', 'Third'])
  await expect(openLayoutTab(page)).toHaveText('Main')
  await layoutTab(page, 'Third').click()
  await expect(openLayoutTab(page)).toHaveText('Third')
  await expect.poll(() => wsShape(page)).toEqual([[['t', 't-cal']]])
})

test('Move left / right from a tab’s menu, by keyboard; each is one undo step', async ({ page }) => {
  await seedWorkspace(page, three)
  await layoutTab(page, 'Main').focus()
  await page.keyboard.press('ArrowRight')
  await expect(layoutTab(page, 'Second')).toBeFocused()
  await page.keyboard.press('Shift+F10')
  const menu = page.getByRole('menu', { name: 'Layout Second' })
  await expect(menu.getByRole('menuitem', { name: 'Move left' })).toBeEnabled()
  await expect(menu.getByRole('menuitem', { name: 'Save changes' })).toHaveCount(0)
  await menu.getByRole('menuitem', { name: 'Move right' }).click()
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Third', 'Second'])
  await expect.poll(() => storedOrder(page)).toEqual(['Main', 'Third', 'Second'])
  // At the end: Move right is off.
  const again = await openLayoutTabMenu(page, 'Second')
  await expect(again.getByRole('menuitem', { name: 'Move right' })).toBeDisabled()
  await again.getByRole('menuitem', { name: 'Move left' }).click()
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Second', 'Third'])
  // Undo (Ctrl+Z) takes the last move back.
  await page.locator('[data-ws-area]').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Third', 'Second'])
  // The open layout's menu leads with its own actions.
  const open = await openLayoutTabMenu(page)
  await expect(open.getByRole('menuitem')).toHaveText(['Save changes', 'Save as new layout…', 'Discard changes', 'Rename…', 'Move left', 'Move right', 'Delete layout…'])
  await expect(open.getByRole('menuitem', { name: 'Move left' })).toBeDisabled()
})

test('New layout (the tabs’ +) asks a name; the empty layout is stored at once and opens as a tab', async ({ page }) => {
  await seedWorkspace(page, three)
  await page.getByRole('button', { name: 'New layout', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'New layout' })
  await expect(dialog.getByLabel('Name')).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Create layout' })).toBeDisabled()
  await dialog.getByLabel('Name').fill('Planning')
  await dialog.getByRole('button', { name: 'Create layout' }).click()
  await expect(dialog).toBeHidden()
  await expect(openLayoutTab(page)).toHaveText('Planning')
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Second', 'Third', 'Planning'])
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')
  await expect(page.getByText('This layout is empty')).toBeVisible()
  await expect.poll(() => storedOrder(page)).toEqual(['Main', 'Second', 'Third', 'Planning'])
  await page.reload()
  await expect(openLayoutTab(page)).toHaveText('Planning')
})

test('New layout with unsaved changes: the name first, then Save / Discard / Cancel; Cancel creates nothing', async ({ page }) => {
  await seedWorkspace(page, three)
  await wsTab(page, 'm-cal').click()
  await wsTab(page, 'm-cal').getByRole('button', { name: 'Close Calendar' }).click()
  await expect(openLayoutTab(page).getByRole('img', { name: 'unsaved changes' })).toBeVisible()

  await page.getByRole('button', { name: 'New layout', exact: true }).click()
  await page.getByRole('dialog', { name: 'New layout' }).getByLabel('Name').fill('Planning')
  await page.getByRole('dialog', { name: 'New layout' }).getByRole('button', { name: 'Create layout' }).click()
  const prompt = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
  await expect(prompt).toContainText('You’re starting a new layout “Planning”.')
  await prompt.getByRole('button', { name: /Cancel/ }).click()
  await expect(openLayoutTab(page)).toHaveText('Main')
  expect(await layoutTabNames(page)).toEqual(['Main', 'Second', 'Third'])

  await page.getByRole('button', { name: 'New layout', exact: true }).click()
  await page.getByRole('dialog', { name: 'New layout' }).getByLabel('Name').fill('Planning')
  await page.getByRole('dialog', { name: 'New layout' }).getByRole('button', { name: 'Create layout' }).click()
  await prompt.getByRole('button', { name: 'Save layout' }).click()
  await expect(openLayoutTab(page)).toHaveText('Planning')
  await layoutTab(page, 'Main').click()
  await expect.poll(() => wsShape(page)).toEqual([[['m']]])
})

test('switching tabs with unsaved changes asks Save / Discard / Cancel', async ({ page }) => {
  await seedWorkspace(page, three)
  await wsTab(page, 'm-cal').click()
  await wsTab(page, 'm-cal').getByRole('button', { name: 'Close Calendar' }).click()
  await layoutTab(page, 'Second').click()
  const prompt = page.getByRole('dialog', { name: 'Save changes to layout “Main”?' })
  await expect(prompt).toContainText('You’re switching to “Second”.')
  await prompt.getByRole('button', { name: /Cancel/ }).click()
  await expect(openLayoutTab(page)).toHaveText('Main')

  await layoutTab(page, 'Second').click()
  await prompt.getByRole('button', { name: 'Discard' }).click()
  await expect(openLayoutTab(page)).toHaveText('Second')
  await layoutTab(page, 'Main').click()
  await expect.poll(() => wsShape(page)).toEqual([[['m', 'm-cal']]])
})

test('Delete from a tab’s menu names the layout-only lists that go with it', async ({ page }) => {
  await seedWorkspace(page, {
    ...three,
    listDefinitions: [{ name: 'Saved' }, { name: 'Second’s own', layoutIdx: 1 }, { name: 'Second’s other', layoutIdx: 1 }],
  })
  const menu = await openLayoutTabMenu(page, 'Second')
  await menu.getByRole('menuitem', { name: 'Delete layout…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete layout “Second”?' })
  await expect(dialog).toContainText('The layout and its 2 layout-only lists are removed.')
  await dialog.getByRole('button', { name: 'Delete layout' }).click()
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Third'])
  // Not the open one: Main stays open.
  await expect(openLayoutTab(page)).toHaveText('Main')
  await expect.poll(async () => (await readListDefinitions(page)).map((d) => d.name)).not.toContain('Second’s own')

  // Rename from a tab's menu too.
  const third = await openLayoutTabMenu(page, 'Third')
  await third.getByRole('menuitem', { name: 'Rename…' }).click()
  await page.getByRole('dialog', { name: 'Rename layout' }).getByLabel('Name').fill('Weekly')
  await page.getByRole('dialog', { name: 'Rename layout' }).getByRole('button', { name: 'Rename' }).click()
  await expect.poll(() => layoutTabNames(page)).toEqual(['Main', 'Weekly'])
})

test('the folded picker: drag a layout to reorder it', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 800 })
  await seedWorkspace(page, three)
  await page.getByTestId('layout-picker').click()
  const item = (name: string) => page.getByRole('menuitemradio', { name, exact: true })
  const main = await box(item('Main'))
  await drag(page, await pointIn(item('Third'), 0.5, 0.5), { x: main.x + main.width / 2, y: main.y + 2 })
  await expect(page.getByRole('menuitemradio')).toHaveText(['Third', 'Main', 'Second'])
  // The menu stayed open and nothing switched.
  await expect(page.getByTestId('layout-picker')).toHaveAccessibleName('Layout: Main')
  await expect.poll(() => storedOrder(page)).toEqual(['Third', 'Main', 'Second'])
})

/** The bar's state at the current width: folded parts, and whether everything is inside the 40px bar. */
async function barState(page: Page) {
  return page.evaluate(() => {
    const bar = document.querySelector('header')!
    const r = bar.getBoundingClientRect()
    const parts = Array.from(bar.querySelectorAll<HTMLElement>('button, [role="tab"], input'))
      .filter((el) => el.offsetParent !== null)
      .map((el) => el.getBoundingClientRect())
    const sorted = Array.from(bar.children).map((c) => c.getBoundingClientRect()).filter((c) => c.width > 0)
    const overlap = sorted.some((c, i) => i > 0 && c.left < sorted[i - 1]!.right - 0.5)
    return {
      height: r.height,
      overflows: bar.scrollWidth > bar.clientWidth || parts.some((p) => p.right > r.right + 0.5 || p.bottom > r.bottom + 0.5 || p.top < r.top - 0.5),
      overlap,
      filtersFolded: document.querySelector('[aria-label="People filter"]') == null,
      tabsFolded: document.querySelector('[data-testid="layout-picker"]') != null,
    }
  })
}

test('the fold, measured: the filters fold first, then the layout tabs; nothing leaves or overlaps the 40px bar', async ({ page }) => {
  await seedWorkspace(page, {
    people: ['Alice'],
    tags: ['q4'],
    statuses: ['Waiting'],
    layouts: [layout('Main', 'm'), layout('Weekly planning', 's'), layout('Projects review', 't'), layout('Inbox', 'i')],
  })
  // Folded parts per width: [filters, tabs] — the filters fold first.
  const expected: Array<[number, [boolean, boolean]]> = [[1600, [false, false]], [1280, [true, false]], [1024, [true, true]], [900, [true, true]]]
  for (const [width, folded] of expected) {
    await page.setViewportSize({ width, height: 800 })
    await expect.poll(async () => {
      const s = await barState(page)
      return [s.filtersFolded, s.tabsFolded, s.overflows]
    }, { message: `at ${width}px` }).toEqual([...folded, false])
    expect(await barState(page), `at ${width}px`).toMatchObject({ height: 40, overflows: false, overlap: false })
  }
  // And back: wide again, everything unfolds.
  await page.setViewportSize({ width: 1600, height: 800 })
  await expect.poll(async () => (await barState(page)).tabsFolded).toBe(false)
  expect(await barState(page)).toMatchObject({ filtersFolded: false, overflows: false })
})
