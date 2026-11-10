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

/** Opens a field's picker (`People`): from its chip while the filter is on, else from the Filter menu. */
export function openFieldPicker(label: string): void {
  const chip = screen.queryByRole('button', { name: new RegExp(`^${label} filter: `) })
  if (chip) fireEvent.click(chip)
  else openFilterPicker(`${label} filter`)
}
