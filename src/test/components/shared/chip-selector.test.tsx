import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { ChipSelector, type ChipItem } from '../../../components/shared/ChipSelector'
import { useUndoStore } from '../../../stores/undo-store'

const people: ChipItem[] = [
  { id: 4, name: 'Sam Lee', initials: 'SL', color: '#5b6abf' },
  { id: 1, name: 'Alice Chen', initials: 'AC' },
  { id: 3, name: 'Priya Nair', initials: 'PN' },
  { id: 2, name: 'Dana Kim', initials: 'DK' },
  { id: 5, name: 'Aidan Ross', initials: 'AR' },
]

function input() {
  return screen.getByRole('combobox')
}

function options() {
  return screen.getAllByRole('option')
}

function activeOption() {
  const id = input().getAttribute('aria-activedescendant')
  return id ? document.getElementById(id) : null
}

function type(value: string) {
  fireEvent.change(input(), { target: { value } })
}

function key(k: string) {
  fireEvent.keyDown(input(), { key: k })
}

function renderPicker(props: Partial<React.ComponentProps<typeof ChipSelector>> = {}) {
  const onToggle = vi.fn()
  const onCreate = vi.fn()
  const onClose = vi.fn()
  render(
    <ChipSelector
      items={people}
      selectedIds={new Set([3])}
      onToggle={onToggle}
      onCreate={onCreate}
      onClose={onClose}
      avatars
      placeholder="Search or create people…"
      {...props}
    />,
  )
  return { onToggle, onCreate, onClose }
}

describe('ChipSelector', () => {
  afterEach(cleanup)

  it('focuses the search and lists everyone alphabetically, assigned ones checked', () => {
    renderPicker()
    expect(input()).toHaveFocus()
    expect(options().map((o) => o.textContent)).toEqual([
      'AAidan Ross', 'AAlice Chen', 'DDana Kim', '✓PPriya Nair', 'SSam Lee',
    ])
    expect(screen.getByRole('option', { name: 'Priya Nair' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('option', { name: 'Dana Kim' })).toHaveAttribute('aria-selected', 'false')
    expect(activeOption()).toHaveTextContent('Aidan Ross')
  })

  it('avatars take the person color; uncolored people get the neutral fill', () => {
    renderPicker()
    const sam = screen.getByRole('option', { name: 'Sam Lee' })
    const avatar = sam.children[1] as HTMLElement
    expect(avatar.textContent).toBe('S')
    expect(avatar.style.background).toBe('rgb(91, 106, 191)')
  })

  it('matches a case-insensitive substring and marks it', () => {
    renderPicker()
    type('DAN')
    // The active row carries the ⏎ hint.
    expect(options().map((o) => o.textContent)).toEqual(['AAidan Ross⏎', 'DDana Kim', '+DCreate "DAN"'])
    const marks = Array.from(document.querySelectorAll('mark')).map((m) => m.textContent)
    expect(marks).toEqual(['dan', 'Dan'])
  })

  it('a partial match lists matches first and Create last; ↑/↓ wrap; ⏎ toggles the active person', () => {
    const { onToggle, onCreate } = renderPicker()
    type('dan')
    expect(options().at(-1)).toHaveAccessibleName('Create "dan"')
    expect(activeOption()).toHaveTextContent('Aidan Ross')
    key('ArrowDown')
    expect(activeOption()).toHaveTextContent('Dana Kim')
    key('Enter')
    expect(onToggle).toHaveBeenCalledWith(2)
    key('ArrowDown')
    expect(activeOption()).toHaveAccessibleName('Create "dan"')
    key('ArrowDown')
    expect(activeOption()).toHaveTextContent('Aidan Ross')
    key('ArrowUp')
    expect(activeOption()).toHaveAccessibleName('Create "dan"')
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('an exact match in any case never offers create and is the active row', () => {
    const { onToggle } = renderPicker()
    type('dana KIM ')
    expect(screen.queryByRole('option', { name: /Create/ })).not.toBeInTheDocument()
    expect(activeOption()).toHaveTextContent('Dana Kim')
    key('Enter')
    expect(onToggle).toHaveBeenCalledWith(2)
  })

  it('with no matches Create is the only row and active; ⏎ creates, clears the query and stays open', () => {
    const { onCreate } = renderPicker()
    type('  Marco Rossi ')
    expect(options()).toHaveLength(1)
    const create = screen.getByRole('option', { name: 'Create "Marco Rossi"' })
    expect(activeOption()).toBe(create)
    expect(create.textContent).toContain('M')
    key('Enter')
    expect(onCreate).toHaveBeenCalledWith('Marco Rossi')
    expect(input()).toHaveValue('')
    expect(input()).toHaveFocus()
    expect(options()).toHaveLength(people.length)
  })

  it('clicking a row toggles it; clicking Create creates', () => {
    const { onToggle, onCreate } = renderPicker()
    fireEvent.click(screen.getByText('Sam Lee'))
    expect(onToggle).toHaveBeenCalledWith(4)
    type('Zed')
    fireEvent.click(screen.getByRole('option', { name: 'Create "Zed"' }))
    expect(onCreate).toHaveBeenCalledWith('Zed')
  })

  it('a create that fails says so in the snackbar', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    renderPicker({ onCreate: () => Promise.reject(new Error('write failed')) })
    type('Zed')
    key('Enter')
    await vi.waitFor(() => {
      expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Couldn\'t create "Zed".' })
    })
    expect(warn).toHaveBeenCalled()
  })

  it('Esc calls onClose and does not reach outer handlers', () => {
    const outer = vi.fn()
    const onClose = vi.fn()
    render(
      <div onKeyDown={outer}>
        <ChipSelector items={people} selectedIds={new Set()} onToggle={vi.fn()} onClose={onClose} />
      </div>,
    )
    key('Escape')
    expect(onClose).toHaveBeenCalledOnce()
    expect(outer).not.toHaveBeenCalled()
  })

  it('without onCreate there is no create row — "No matches" instead', () => {
    renderPicker({ onCreate: undefined })
    type('zzz')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
    expect(screen.getByText('No matches')).toBeInTheDocument()
  })

  it('after a create the new item shows checked in alphabetical place', async () => {
    function Host() {
      const [items, setItems] = useState(people)
      const [selected, setSelected] = useState(new Set<number>())
      return (
        <ChipSelector
          items={items}
          selectedIds={selected}
          onToggle={vi.fn()}
          onCreate={(name) => {
            setItems((prev) => [...prev, { id: 9, name, initials: 'MR' }])
            setSelected((prev) => new Set([...prev, 9]))
          }}
          avatars
        />
      )
    }
    render(<Host />)
    type('Marco Rossi')
    key('Enter')
    const names = options().map((o) => o.textContent?.replace(/^✓?[A-Z]/, ''))
    expect(names).toEqual(['Aidan Ross', 'Alice Chen', 'Dana Kim', 'Marco Rossi', 'Priya Nair', 'Sam Lee'])
    expect(screen.getByRole('option', { name: 'Marco Rossi' })).toHaveAttribute('aria-selected', 'true')
  })
})
