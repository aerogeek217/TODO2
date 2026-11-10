import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, withSpareLayouts, wsListWidget, type WorkspaceSeed, wsRow } from './fixtures/workspace'
import {
  clearAllFilters, completedChip, filterChip, filterField, filterMenu, filterMenuButton, filterMenuRow, openFilterMenu, openFilterPicker,
  setShowCompleted,
} from './fixtures/filters'

/**
 * The app shell in a real browser: one top bar (New task, the layout tabs,
 * the screen-filter tray, the storage pill, the Settings gear), the Settings
 * modal, and the Filter button with its menu and chips. The unsaved-layout case (Settings
 * never prompts) lives in `workspace-layout.spec.ts`, the layout tabs and
 * the measured fold in `layout-tabs.spec.ts`; the storage pill's
 * warning states in `storage-pill.spec.ts`.
 */

const team: WorkspaceSeed = {
  people: ['Alice', 'Bob'],
  tags: ['q4'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Alice task', people: ['Alice'] },
    { title: 'Bob task', people: ['Bob'], tags: ['q4'] },
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] })] }] },
  ],
}

const tray = (page: Page) => page.getByRole('group', { name: 'Screen filters — apply to every widget' })
const rows = (page: Page) => wsListWidget(page, 't1').locator('[data-todo-id]')

test('the gear opens Settings over the workspace; Esc closes it; it reopens on the last section, after a reload too', async ({ page }) => {
  await seedWorkspace(page, team)
  await expect(page.getByRole('button', { name: /theme/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  // The first time, it opens on Appearance.
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Appearance')
  await expect(settings.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)

  // Database: Import / Export first (exporting is the common errand).
  await settings.getByRole('button', { name: 'Database', exact: true }).click()
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  await expect(settings.getByRole('heading', { level: 3 }).first()).toHaveText('Import / Export')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-ws-area]')).toBeVisible()

  // Reopens on the last section viewed; G then S opens it too.
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  await settings.getByRole('button', { name: 'About', exact: true }).click()
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toBeHidden()

  // After a reload too.
  await page.reload()
  await expect(page.locator('[data-ws-area]')).toBeVisible()
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('About')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
})

test('an editor opened from Settings stacks over it and owns Esc', async ({ page }) => {
  await seedWorkspace(page, team)
  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage people…' }).click()
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeVisible()
})

test('the filter tray turns red while a screen filter is on; the filter shows as a chip', async ({ page }) => {
  await seedWorkspace(page, team)
  const restShadow = await tray(page).evaluate((el) => getComputedStyle(el).boxShadow)
  // At rest: the field and the Filter button, no chip.
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter')
  await expect(filterChip(page, 'People')).toHaveCount(0)

  await openFilterPicker(page, 'People')
  await page.getByRole('option', { name: 'Alice' }).click()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(filterMenu(page)).toHaveCount(0)
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')
  await expect(filterChip(page, 'People')).toHaveAccessibleName('People filter: Alice')
  await expect(rows(page)).toHaveCount(1)
  expect(await tray(page).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(restShadow)

  // The chip reopens its picker beside it.
  await filterChip(page, 'People').click()
  await expect(page.getByRole('option', { name: 'Alice' })).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')

  // The × clears just that filter, and the chip goes.
  await tray(page).getByRole('button', { name: 'Clear people filter' }).click()
  await expect(tray(page)).not.toHaveAttribute('data-filtered')
  await expect(filterChip(page, 'People')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(2)
})

test('the Filter menu’s Clear all filters clears every screen filter at once; the funnel no longer clears', async ({ page }) => {
  await seedWorkspace(page, team)
  const search = filterField(page)
  const button = filterMenuButton(page)
  // The Filter button follows the field.
  const buttonBox = await button.boundingBox()
  const searchBox = await search.boundingBox()
  expect(buttonBox && searchBox && searchBox.x + searchBox.width <= buttonBox.x).toBe(true)
  await expect(tray(page).getByRole('button', { name: 'Clear all filters' })).toHaveCount(0)
  // No Clear all in the menu while nothing is on.
  await openFilterMenu(page)
  await expect(filterMenu(page).getByRole('button', { name: 'Clear all filters' })).toHaveCount(0)

  await filterMenuRow(page, 'People').click()
  await page.getByRole('option', { name: 'Alice' }).click()
  await page.keyboard.press('Escape')
  await filterMenu(page).getByRole('button', { name: 'Show completed' }).click()
  await page.keyboard.press('Escape')
  await search.fill('a')
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')
  await expect(completedChip(page)).toHaveText('Completed')
  await expect(tray(page).getByText('Clear all', { exact: true })).toHaveCount(0)

  await search.evaluate((el) => (el as HTMLInputElement).blur())
  await clearAllFilters(page)
  await expect(tray(page)).not.toHaveAttribute('data-filtered')
  await expect(search).toHaveValue('')
  await expect(completedChip(page)).toHaveCount(0)
  await expect(rows(page)).toHaveCount(2)
  await expect(button).toBeFocused()
})

test('F opens the Filter menu on its first row; Tab stays in it; Esc gives the focus back', async ({ page }) => {
  await seedWorkspace(page, team)
  await expect(filterMenuButton(page)).toBeVisible()
  await page.keyboard.press('f')
  await expect(filterMenu(page)).toBeVisible()
  await expect(filterMenuButton(page)).toHaveAttribute('aria-expanded', 'true')
  await expect(filterMenuRow(page, 'Priority')).toBeFocused()
  // Tab wraps inside the menu.
  await page.keyboard.press('Shift+Tab')
  await expect(filterMenu(page).getByRole('button', { name: 'Show completed' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(filterMenuRow(page, 'Priority')).toBeFocused()
  // Enter on a row opens its picker beside the menu; Esc closes it, the focus back on the row.
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(filterMenuRow(page, 'People')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('option', { name: 'Alice' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option', { name: 'Alice' })).toHaveCount(0)
  await expect(filterMenuRow(page, 'People')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(filterMenu(page)).toHaveCount(0)
  await expect(filterMenuButton(page)).toBeFocused()

  // The palette's Open Filter Menu does the same.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Find tasks, commands/).fill('>open filter menu')
  await page.keyboard.press('Enter')
  await expect(filterMenu(page)).toBeVisible()
  await expect(filterMenuRow(page, 'Priority')).toBeFocused()
})

test('in a narrow bar the chips fold into the Filter button, which counts them; its menu still sets and clears a filter', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 })
  await seedWorkspace(page, withSpareLayouts(team))
  const box = await page.locator('header').boundingBox()
  expect(box?.height).toBe(40)

  const menu = await openFilterMenu(page)
  await expect(menu).toContainText('Screen filters · apply to every widget')
  await filterMenuRow(page, 'Tags').click()
  await page.getByRole('option', { name: 'q4' }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect(menu.getByRole('button', { name: 'Tags filter: q4' })).toBeVisible()
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter, 1 active')
  await expect(filterChip(page, 'Tags')).toHaveCount(0)
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')

  await menu.getByRole('button', { name: 'Clear tags filter' }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect(filterMenuButton(page)).toHaveAccessibleName('Filter')
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('the storage pill’s popover opens Settings on Database, at File storage', async ({ page }) => {
  await seedWorkspace(page, team)
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'local')
  await expect(pill).toHaveText('Local only')
  await pill.click()
  const popover = page.getByRole('dialog', { name: 'Stored in this browser only' })
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: 'Set up file storage…' }).click()
  await expect(popover).toBeHidden()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  await expect(settings.getByRole('heading', { level: 3 })).toHaveText(['Import / Export', 'File storage', 'Backups', 'Data integrity'])
  await expect(settings.getByRole('heading', { level: 3, name: 'File storage' })).toBeInViewport()
  await expect(settings.getByRole('button', { name: 'Attach to File' })).toBeInViewport()
  // The old "stored locally" strip is gone.
  await expect(page.getByText('Your data is stored locally')).toHaveCount(0)
})

test('without file sync, the pill’s Import / Export… opens Database scrolled to that part', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Window.prototype as unknown as Record<string, unknown>).showOpenFilePicker
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker
  })
  await seedWorkspace(page, team)
  await page.getByTestId('storage-pill').click()
  await page.getByRole('button', { name: 'Import / Export…' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  const part = settings.getByRole('heading', { level: 3, name: 'Import / Export' })
  await expect(part).toBeInViewport()
  // The nav marks it as the part in view.
  await expect(settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Import / Export' }))
    .toHaveAttribute('aria-current', 'location')
  // The content scrolled to it: as far as it goes (Database may fit, not scrolling at all), or until the part is at the top.
  const scroll = await part.evaluate((h) => {
    const content = h.closest('section[aria-labelledby]')?.parentElement?.closest('section') as HTMLElement
    return {
      top: content.scrollTop,
      max: content.scrollHeight - content.clientHeight,
      offset: h.getBoundingClientRect().top - content.getBoundingClientRect().top,
    }
  })
  expect(scroll.top >= scroll.max - 1 || scroll.offset < 40).toBe(true)
})

test('at 1280px the bar fits with a filter on: the Filter button and its chips, New task the + alone', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await seedWorkspace(page, { ...team, statuses: ['Waiting'] })
  await expect(filterMenuButton(page)).toHaveText('Filter')
  // No filter button per field any more: they are the menu's rows.
  await expect(tray(page).getByRole('button', { name: / filter$/ })).toHaveCount(0)
  const newTask = page.getByRole('button', { name: 'New task' })
  await expect(newTask).toHaveText('')
  await expect(newTask).toHaveAttribute('title', 'New task (Ctrl+Space)')
  await setShowCompleted(page, true)
  await expect(completedChip(page)).toHaveText('Completed')
  await expect(page.getByPlaceholder('Filter…')).toBeVisible()
  await expect(page.locator('header kbd')).toHaveCount(0)
  const fit = await page.locator('header').evaluate((bar) => {
    const box = bar.getBoundingClientRect()
    const parts = [...bar.querySelectorAll('button, input')].map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0)
    return {
      height: box.height,
      overflow: bar.scrollWidth - bar.clientWidth,
      outside: parts.filter((r) => r.right > box.right + 0.5 || r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5).length,
    }
  })
  expect(fit).toEqual({ height: 40, overflow: 0, outside: 0 })
})

test('New task opens quick add', async ({ page }) => {
  await seedWorkspace(page, team)
  await page.getByRole('button', { name: 'New task' }).click()
  await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
})
