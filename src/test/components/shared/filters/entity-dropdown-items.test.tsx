import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { EntityDropdownItems } from '../../../../components/shared/filters/FilterPanels'
import { usePersonStore } from '../../../../stores/person-store'
import { useUIStore } from '../../../../stores/ui-store'

afterEach(cleanup)

const people = [{ id: 1, name: 'Alice Chen', initials: 'AC' }, { id: 2, name: 'Ben Ortiz', initials: 'BO' }]

function renderItems(entityMenu?: 'person') {
  usePersonStore.setState({ people })
  const onToggle = vi.fn()
  const onShowTasks = vi.fn()
  const host = vi.fn()
  render(
    <div onContextMenu={host}>
      <input aria-label="Search" />
      <EntityDropdownItems
        searchText=""
        entities={people}
        isChecked={() => false}
        onToggle={onToggle}
        namePrefix="@"
        entityMenu={entityMenu}
        onShowTasks={onShowTasks}
      />
    </div>,
  )
  return { onToggle, onShowTasks, host }
}

describe('EntityDropdownItems — a person’s / tag’s menu on its rows', () => {
  it('a right-click on a row opens the person’s menu without ticking it; the focus stays in the search', () => {
    const { onToggle, host } = renderItems('person')
    const search = screen.getByRole('textbox', { name: 'Search' })
    search.focus()
    const row = screen.getByText('@Ben Ortiz')
    // The right button's press doesn't take the focus out of the search.
    expect(fireEvent.mouseDown(row, { button: 2 })).toBe(false)
    fireEvent.contextMenu(row, { button: 2, clientX: 30, clientY: 40 })
    const menu = screen.getByRole('menu', { name: '@Ben Ortiz' })
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Show tasks', 'Edit…', 'Delete…'])
    expect(onToggle).not.toHaveBeenCalled()
    expect(host).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(search).toHaveFocus()
  })

  it('Show tasks runs onShowTasks (the host closes the picker), then opens the task dialog', () => {
    const { onShowTasks } = renderItems('person')
    fireEvent.contextMenu(screen.getByText('@Alice Chen'), { button: 2 })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Show tasks' }))
    expect(onShowTasks).toHaveBeenCalledOnce()
    expect(useUIStore.getState().taskDialog?.title).toBe('Alice Chen')
  })

  it('no menu on the None row, nor without entityMenu', () => {
    renderItems('person')
    fireEvent.contextMenu(screen.getByText('None'), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    cleanup()
    renderItems()
    fireEvent.contextMenu(screen.getByText('@Alice Chen'), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
