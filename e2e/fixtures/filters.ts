import { expect, type Locator, type Page } from '@playwright/test'

/**
 * The top bar's screen filter: the tray (the funnel, the field — a typed
 * filter, at rest its terms as pills —, the Filter button, the counter), the
 * Filter menu (Priority, Tags, People, Dates, Status, then Show completed
 * and, while a filter is on, Clear all filters) and the stores behind it.
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

/** The field's pills at rest: a term of the filter each (`@"Aisha Rahman"`, `#q4`, `done`), in order. */
export function filterPills(page: Page): Locator {
  return filterTray(page).locator('[data-top-bar-pill]')
}

/** The funnel at the tray's left: one click clears every screen filter (Undo in the snackbar); disabled with none. */
export function filterFunnel(page: Page): Locator {
  return filterTray(page).getByRole('button', { name: 'Clear the filter' })
}

/** The funnel, by its role: one click clears every screen filter. */
export function filterClear(page: Page): Locator {
  return filterTray(page).locator('[data-clear-filters]')
}

/** The field's pause toggle at its right end (while a filter is on): pressed while paused. */
export function filterPause(page: Page): Locator {
  return filterTray(page).getByRole('button', { name: 'Pause the filter' })
}

/** Show completed's pill (`done`, at rest) — its ×. */
export function completedChip(page: Page): Locator {
  return filterTray(page).getByRole('button', { name: 'Remove done' })
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

/** The date panel's type button in `scope` (`Date type: Due`, `, filtering` while that type filters). */
export function dateTypeButton(scope: Locator): Locator {
  return scope.getByRole('button', { name: /^Date type: / })
}

/** The date panel's type menu (open it with the type button). */
export function dateTypeMenu(page: Page): Locator {
  return page.getByRole('menu', { name: 'Date type' })
}

/** A type's item in the open type menu (named by its type, then — lit — its clause after a comma). */
export function dateTypeItem(page: Page, type: string): Locator {
  return dateTypeMenu(page).getByRole('menuitemradio', { name: new RegExp(`^${type}(\\s*,|$)`) })
}

/** Picks `type` from the date panel's type menu in `scope`: it selects that type for editing (and writes nothing). */
export async function pickDateType(page: Page, scope: Locator, type: string): Promise<void> {
  await dateTypeButton(scope).click()
  await dateTypeItem(page, type).click()
  await expect(dateTypeButton(scope)).toHaveAccessibleName(new RegExp(`^Date type: ${type}(, filtering)?$`))
}

/** The date panel's body in `scope`: the selected type's clause, named by its title (`Due date`, `Created`). */
export function dateBody(scope: Locator): Locator {
  return scope.getByRole('group', { name: /date|follow|Completed|Created|Modified/ })
}

/** Opens `field`'s picker from the Filter menu (the bar has no chips: the field's pills are). */
export async function openFieldPicker(page: Page, field: FilterField): Promise<void> {
  await openFilterPicker(page, field)
}

/** Turns Show completed on or off (the menu's toggle; off from its `done` pill's ×). */
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
