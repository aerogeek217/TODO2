import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The top bar's screen filter: the tray (the field, the Filter button, the
 * chips of the filters that are on, the counter), the Filter menu (Priority,
 * Tags, People, Dates, Status, then Show completed and, while a filter is
 * on, Clear all filters) and the stores behind it.
 */

export type FilterField = 'Priority' | 'Tags' | 'People' | 'Dates' | 'Status'

/** The top bar's filter tray. */
export function filterTray(page: Page): Locator {
  return page.locator('header [data-filter-row]')
}

/** The top bar's field (`Filter tasks`). */
export function filterField(page: Page): Locator {
  return filterTray(page).getByRole('textbox', { name: 'Filter tasks' })
}

/** The top bar's Filter button (`Filter`, `Filter, 2 active`). */
export function filterMenuButton(page: Page): Locator {
  return page.locator('header [data-filter-menu]')
}

/** The open Filter menu. */
export function filterMenu(page: Page): Locator {
  return page.getByRole('group', { name: 'Screen filters', exact: true })
}

/** A field's chip in the bar (`People filter: Alice`), shown while that filter is on. */
export function filterChip(page: Page, field: FilterField): Locator {
  return filterTray(page).getByRole('button', { name: new RegExp(`^${field} filter: `) })
}

/** The Show completed chip in the bar (while it is on). */
export function completedChip(page: Page): Locator {
  return filterTray(page).getByRole('button', { name: 'Show completed' })
}

/** Opens the Filter menu (if it isn't open); returns it. */
export async function openFilterMenu(page: Page): Promise<Locator> {
  const button = filterMenuButton(page)
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
  await expect(filterMenu(page)).toBeVisible()
  return filterMenu(page)
}

/** The Filter menu's row for `field` (open the menu first). */
export function filterMenuRow(page: Page, field: FilterField): Locator {
  return filterMenu(page).getByRole('button', { name: new RegExp(`^${field} filter(: |$)`) })
}

/** Opens `field`'s picker from the Filter menu (beside it). */
export async function openFilterPicker(page: Page, field: FilterField): Promise<void> {
  await openFilterMenu(page)
  await filterMenuRow(page, field).click()
}

/**
 * Opens `field`'s picker with the keyboard only: Enter on the Filter button
 * (the menu opens on its first row), Tab to the field's row, Enter.
 */
export async function openFilterPickerByKeyboard(page: Page, field: FilterField): Promise<void> {
  await filterMenuButton(page).focus()
  await page.keyboard.press('Enter')
  await expect(filterMenu(page)).toBeVisible()
  const row = filterMenuRow(page, field)
  for (let i = 0; i < 8 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('Tab')
  await expect(row).toBeFocused()
  await page.keyboard.press('Enter')
}

/** Opens `field`'s picker: from its chip while the filter is on, else from the Filter menu. */
export async function openFieldPicker(page: Page, field: FilterField): Promise<void> {
  if (await filterChip(page, field).count() > 0) await filterChip(page, field).click()
  else await openFilterPicker(page, field)
}

/** Turns Show completed on or off (the menu's toggle; off from its chip). */
export async function setShowCompleted(page: Page, on: boolean): Promise<void> {
  if (!on) {
    if (await completedChip(page).count() > 0) await completedChip(page).click()
    await expect(completedChip(page)).toHaveCount(0)
    return
  }
  await openFilterMenu(page)
  const row = filterMenu(page).getByRole('button', { name: 'Show completed' })
  if (await row.getAttribute('aria-pressed') !== 'true') await row.click()
  await expect(row).toHaveAttribute('aria-pressed', 'true')
  await filterMenuButton(page).click()
  await expect(filterMenu(page)).toHaveCount(0)
}

/** Clears every screen filter (the Filter menu's Clear all filters). */
export async function clearAllFilters(page: Page): Promise<void> {
  await openFilterMenu(page)
  await filterMenu(page).getByRole('button', { name: 'Clear all filters' }).click()
  await expect(filterMenu(page)).toHaveCount(0)
}

/**
 * Waits until the app has loaded its people (`usePersonStore`): what a test
 * that types `@` (Quick Add, the field) needs before its first keystroke.
 */
export async function expectPeopleLoaded(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/person-store.ts' as string)) as {
      usePersonStore: { getState: () => { people: unknown[] } }
    }
    return mod.usePersonStore.getState().people.length
  })).toBeGreaterThan(0)
}
