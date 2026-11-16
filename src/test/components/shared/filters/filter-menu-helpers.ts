import { fireEvent, screen, within } from '@testing-library/react'

/** The top bar's Filter button (`Filter`, `Filter, 2 active`). */
export function filterMenuButton(): HTMLElement {
  return screen.getByRole('button', { name: /^Filter(, \d+ active)?$/ })
}

/** Opens the Filter menu; returns it. */
export function openFilterMenu(): HTMLElement {
  fireEvent.click(filterMenuButton())
  return screen.getByRole('group', { name: 'Screen filters' })
}

/** Opens a field's picker from the Filter menu (`People filter`, `/^Dates filter/`). */
export function openFilterPicker(name: string | RegExp): void {
  const menu = openFilterMenu()
  fireEvent.click(within(menu).getByRole('button', { name }))
}

/** Opens a field's picker (`People`) from the Filter menu (the bar has no chips: the field's pills are). */
export function openFieldPicker(label: string): void {
  openFilterPicker(new RegExp(`^${label} filter(: |$)`))
}
