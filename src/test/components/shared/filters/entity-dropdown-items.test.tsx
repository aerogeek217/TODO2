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
  function KeyboardPicker({ onToggle, initial = [] }: { onToggle: (id: number) => void; initial?: number[] }) {
    const [checked, setChecked] = useState<Set<number>>(() => new Set(initial))
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
          onSearchClear={() => setText('')}
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

describe('EntityDropdownItems — ticked rows on top', () => {
  const names = () => screen.getAllByRole('option').map((o) => o.textContent)
  const separated = () => screen.getAllByRole('option').map((o) => o.className.includes('dropdownItemSeparated'))
  const search = () => screen.getByPlaceholderText('Search...')
  const more = [...people, { id: 3, name: 'Cara Diaz', initials: 'CD' }]

  function Picker({ initial }: { initial: number[] }) {
    const [checked, setChecked] = useState<Set<number>>(() => new Set(initial))
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
          entities={more}
          label="People"
          isChecked={(id) => checked.has(id)}
          onToggle={(id) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
          namePrefix="@"
          onSearchClear={() => setText('')}
        />
      </SelectionPanelBody>
    )
  }

  it('the ticked rows first (alphabetical), a separator, then the rest — None first of its block', () => {
    render(<Picker initial={[3, 1]} />)
    expect(names()).toEqual(['@Alice Chen', '@Cara Diaz', 'None', '@Ben Ortiz'])
    expect(separated()).toEqual([false, false, true, false])
    cleanup()
    render(<Picker initial={[0, 2]} />)
    expect(names()).toEqual(['None', '@Ben Ortiz', '@Alice Chen', '@Cara Diaz'])
    cleanup()
    // Nothing ticked: one block, no separator.
    render(<Picker initial={[]} />)
    expect(names()).toEqual(['None', '@Alice Chen', '@Ben Ortiz', '@Cara Diaz'])
    expect(separated()).toEqual([false, false, false, false])
  })

  it('a tick with no search text never moves a row', () => {
    render(<Picker initial={[]} />)
    fireEvent.click(screen.getByRole('option', { name: '@Cara Diaz' }))
    expect(screen.getByRole('option', { name: '@Cara Diaz' })).toHaveAttribute('aria-selected', 'true')
    expect(names()).toEqual(['None', '@Alice Chen', '@Ben Ortiz', '@Cara Diaz'])
  })

  it('a click with search text ticks, clears the search (focus kept) and re-sorts', () => {
    render(<Picker initial={[]} />)
    search().focus()
    fireEvent.change(search(), { target: { value: 'car' } })
    expect(names()).toEqual(['@Cara Diaz'])
    fireEvent.click(screen.getByRole('option', { name: '@Cara Diaz' }))
    expect(search()).toHaveValue('')
    expect(search()).toHaveFocus()
    expect(names()).toEqual(['@Cara Diaz', 'None', '@Alice Chen', '@Ben Ortiz'])
  })

  it('Space on a row with search text: the search clears and the focus follows the row to its new place', () => {
    render(<Picker initial={[1]} />)
    search().focus()
    fireEvent.change(search(), { target: { value: 'ben' } })
    fireEvent.keyDown(search(), { key: 'ArrowDown' })
    const ben = screen.getByRole('option', { name: '@Ben Ortiz' })
    expect(ben).toHaveFocus()
    fireEvent.keyDown(ben, { key: ' ' })
    expect(search()).toHaveValue('')
    expect(names()).toEqual(['@Alice Chen', '@Ben Ortiz', 'None', '@Cara Diaz'])
    expect(screen.getByRole('option', { name: '@Ben Ortiz' })).toHaveFocus()
    // Space again unticks it; no text, so nothing moves.
    fireEvent.keyDown(document.activeElement!, { key: ' ' })
    expect(screen.getByRole('option', { name: '@Ben Ortiz' })).toHaveAttribute('aria-selected', 'false')
    expect(names()).toEqual(['@Alice Chen', '@Ben Ortiz', 'None', '@Cara Diaz'])
  })
})

describe('EntityDropdownItems — search', () => {
  it('ignores spaces around the search text, as the row picker does', () => {
    render(
      <EntityDropdownItems searchText=" ben " entities={people} isChecked={() => false} onToggle={vi.fn()} namePrefix="@" />,
    )
    expect(screen.getByText('@Ben Ortiz')).toBeInTheDocument()
    expect(screen.queryByText('@Alice Chen')).toBeNull()
  })
})
