import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { EntityDropdownItems, SelectionPanelBody } from '../../../../components/shared/filters/FilterPanels'
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

describe('EntityDropdownItems — the keyboard', () => {
  function KeyboardPicker({ onToggle }: { onToggle: (id: number) => void }) {
    const [checked, setChecked] = useState<Set<number>>(new Set())
    const [text, setText] = useState('')
    return (
      <SelectionPanelBody
        allSelected={false}
        noneSelected={checked.size === 0}
        onSelectAll={() => {}}
        onDeselectAll={() => {}}
        search={{ text, setText, onEscape: () => {} }}
      >
        <EntityDropdownItems
          searchText={text}
          entities={people}
          label="People"
          isChecked={(id) => checked.has(id)}
          onToggle={(id) => {
            onToggle(id)
            setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
          }}
          namePrefix="@"
          entityMenu="person"
        />
      </SelectionPanelBody>
    )
  }

  it('the rows are a multi-select listbox with one tab stop; ↓ from the search goes into it', () => {
    usePersonStore.setState({ people })
    const onToggle = vi.fn()
    render(<KeyboardPicker onToggle={onToggle} />)
    const list = screen.getByRole('listbox', { name: 'People' })
    expect(list).toHaveAttribute('aria-multiselectable', 'true')
    const options = within(list).getAllByRole('option')
    expect(options.map((o) => o.textContent)).toEqual(['None', '@Alice Chen', '@Ben Ortiz'])
    expect(options.map((o) => o.tabIndex)).toEqual([0, -1, -1])

    const search = screen.getByPlaceholderText('Search...')
    search.focus()
    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(options[0]).toHaveFocus()
  })

  it('↑ / ↓ / Home / End move the focus and the tab stop; Space and Enter tick the focused row', () => {
    usePersonStore.setState({ people })
    const onToggle = vi.fn()
    render(<KeyboardPicker onToggle={onToggle} />)
    const options = () => screen.getAllByRole('option')
    options()[0]!.focus()
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(options()[1]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: ' ' })
    expect(onToggle).toHaveBeenLastCalledWith(1)
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(options().map((o) => o.tabIndex)).toEqual([-1, 0, -1])

    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(options()[2]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' })
    expect(onToggle).toHaveBeenLastCalledWith(2)
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
    expect(options()[2]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(options()[0]).toHaveFocus()
    // ↑ on the first row: back to the search box.
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' })
    expect(screen.getByPlaceholderText('Search...')).toHaveFocus()
  })

  it('the context-menu key on a focused person opens their menu under the row', () => {
    usePersonStore.setState({ people })
    render(<KeyboardPicker onToggle={vi.fn()} />)
    const ben = screen.getByRole('option', { name: '@Ben Ortiz' })
    ben.focus()
    fireEvent.contextMenu(ben, { button: 0 })
    expect(screen.getByRole('menu', { name: '@Ben Ortiz' })).toBeInTheDocument()
  })
})
