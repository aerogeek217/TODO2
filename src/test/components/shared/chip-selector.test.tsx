import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { ChipSelector, type ChipItem } from '../../../components/shared/ChipSelector'
import { useUndoStore } from '../../../stores/undo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useUIStore } from '../../../stores/ui-store'
import { DialogFrame } from '../../../components/shared/Dialog'

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

  it('the search shows a × only while it has text; a click empties it, keeps the focus and the picker open', () => {
    const { onClose, onToggle } = renderPicker()
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    type('ali')
    expect(options().map((o) => o.textContent)).toEqual(['AAlice Chen⏎', '+ACreate "ali"'])
    const clear = screen.getByRole('button', { name: 'Clear search' })
    expect(clear).toHaveAttribute('tabindex', '-1')
    fireEvent.click(clear)
    expect(input()).toHaveValue('')
    expect(input()).toHaveFocus()
    expect(options()).toHaveLength(5)
    expect(activeOption()).toHaveTextContent('Aidan Ross')
    expect(screen.queryByRole('button', { name: 'Clear search' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(onToggle).not.toHaveBeenCalled()
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

describe('ChipSelector — a person’s / tag’s menu on its options', () => {
  afterEach(cleanup)

  function seedPeople() {
    usePersonStore.setState({ people: people.map(({ id, name, initials }) => ({ id, name, initials: initials ?? '' })) })
  }

  function renderWithMenu(props: Partial<React.ComponentProps<typeof ChipSelector>> = {}) {
    seedPeople()
    return renderPicker({ entityMenu: 'person', ...props })
  }

  const menuItems = () => within(screen.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)

  it('a right-click on an option opens its menu without picking it; Esc closes only the menu, back in the search', () => {
    const { onToggle, onClose } = renderWithMenu()
    fireEvent.contextMenu(screen.getByRole('option', { name: 'Dana Kim' }), { button: 2, clientX: 40, clientY: 60 })
    const menu = screen.getByRole('menu', { name: '@Dana Kim' })
    expect(menuItems()).toEqual(['Show tasks', 'Edit…', 'Delete…'])
    expect(onToggle).not.toHaveBeenCalled()
    expect(activeOption()).toHaveTextContent('Dana Kim')
    expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: 'Show tasks' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onClose).not.toHaveBeenCalled()
    expect(input()).toHaveFocus()
    expect(options()).toHaveLength(5)
  })

  it('Shift+F10 / the context-menu key in the search opens the highlighted option’s menu; a right-click on the field doesn’t', () => {
    renderWithMenu()
    key('ArrowDown')
    expect(activeOption()).toHaveTextContent('Alice Chen')
    fireEvent.contextMenu(input(), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    // From the keyboard: no right button.
    fireEvent.contextMenu(input(), { button: 0 })
    expect(screen.getByRole('menu', { name: '@Alice Chen' })).toBeInTheDocument()
  })

  it('no menu on the Create row, nor without entityMenu; a right-click in the picker never reaches its host', () => {
    seedPeople()
    const host = vi.fn()
    const onCreate = vi.fn()
    render(
      <div onContextMenu={host}>
        <ChipSelector items={people} selectedIds={new Set()} onToggle={vi.fn()} onCreate={onCreate} entityMenu="person" />
      </div>,
    )
    type('Zed')
    fireEvent.contextMenu(screen.getByRole('option', { name: /Create "Zed"/ }), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(onCreate).not.toHaveBeenCalled()
    fireEvent.contextMenu(input(), { button: 2 })
    expect(host).not.toHaveBeenCalled()
    cleanup()

    render(<div onContextMenu={host}><ChipSelector items={people} selectedIds={new Set()} onToggle={vi.fn()} /></div>)
    fireEvent.contextMenu(screen.getByRole('option', { name: 'Dana Kim' }), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(host).not.toHaveBeenCalled()
  })

  it('Edit… / Delete… act on that person with the focus back in the search first; Show tasks closes the picker', () => {
    const { onClose } = renderWithMenu()
    let focusedWhenOpened: Element | null = null
    const unsubscribe = useUIStore.subscribe((s, prev) => {
      if (s.entityAction && !prev.entityAction) focusedWhenOpened = document.activeElement
    })
    try {
      fireEvent.contextMenu(screen.getByRole('option', { name: 'Sam Lee' }), { button: 2 })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }))
      expect(useUIStore.getState().entityAction).toEqual({ kind: 'person', id: 4, action: 'edit' })
      expect(focusedWhenOpened).toBe(input())
      expect(onClose).not.toHaveBeenCalled()

      useUIStore.getState().closeEntityAction()
      fireEvent.contextMenu(screen.getByRole('option', { name: 'Sam Lee' }), { button: 2 })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Delete…' }))
      expect(useUIStore.getState().entityAction).toEqual({ kind: 'person', id: 4, action: 'delete' })

      fireEvent.contextMenu(screen.getByRole('option', { name: 'Sam Lee' }), { button: 2 })
      fireEvent.click(screen.getByRole('menuitem', { name: 'Show tasks' }))
      expect(onClose).toHaveBeenCalledOnce()
      expect(useUIStore.getState().taskDialog?.title).toBe('Sam Lee')
    } finally {
      unsubscribe()
    }
  })

  it('a tag picker’s menu is the tag’s', () => {
    useTagStore.setState({ tags: [{ id: 7, name: 'work', color: '#f00' }] })
    render(<ChipSelector items={[{ id: 7, name: 'work' }]} selectedIds={new Set()} onToggle={vi.fn()} entityMenu="tag" />)
    fireEvent.contextMenu(screen.getByRole('option', { name: 'work' }), { button: 2 })
    expect(screen.getByRole('menu', { name: '#work' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }))
    expect(useUIStore.getState().entityAction).toEqual({ kind: 'tag', id: 7, action: 'edit' })
  })

  it('inside a dialog the task dialog can’t show above (raised), Show tasks isn’t offered; in an overlay it is', () => {
    seedPeople()
    const picker = <ChipSelector items={people} selectedIds={new Set()} onToggle={vi.fn()} entityMenu="person" />
    const { unmount } = render(<DialogFrame layer="raised" onClose={vi.fn()} aria-label="List editor">{picker}</DialogFrame>)
    fireEvent.contextMenu(screen.getByRole('option', { name: 'Dana Kim' }), { button: 2 })
    expect(menuItems()).toEqual(['Edit…', 'Delete…'])
    unmount()
    render(<DialogFrame layer="overlay" onClose={vi.fn()} aria-label="Task dialog">{picker}</DialogFrame>)
    fireEvent.contextMenu(screen.getByRole('option', { name: 'Dana Kim' }), { button: 2 })
    expect(menuItems()).toEqual(['Show tasks', 'Edit…', 'Delete…'])
  })

  it('the menu closes itself once its person is gone', () => {
    renderWithMenu()
    fireEvent.contextMenu(screen.getByRole('option', { name: 'Dana Kim' }), { button: 2 })
    expect(screen.getByRole('menu')).toBeInTheDocument()
    act(() => { usePersonStore.setState({ people: usePersonStore.getState().people.filter((p) => p.id !== 2) }) })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ChipSelector — Tab accepts the highlighted row', () => {
  afterEach(cleanup)
  const tab = (shift = false) => fireEvent.keyDown(input(), { key: 'Tab', shiftKey: shift })

  it('with a query typed, Tab assigns the highlighted item, clears the query and keeps the focus', () => {
    const { onToggle } = renderPicker()
    input().focus()
    type('ida')
    expect(activeOption()).toHaveTextContent('Aidan Ross')
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    act(() => { input().dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(true)
    expect(onToggle).toHaveBeenCalledWith(5)
    expect(input()).toHaveValue('')
    expect(input()).toHaveFocus()
  })

  it('Tab on the Create row creates it', () => {
    const { onCreate, onToggle } = renderPicker()
    type('Zed')
    expect(activeOption()).toHaveTextContent('Create "Zed"')
    tab()
    expect(onCreate).toHaveBeenCalledWith('Zed')
    expect(onToggle).not.toHaveBeenCalled()
    expect(input()).toHaveValue('')
  })

  it('Tab never unassigns: on a ticked item it only clears the query (Enter still toggles)', () => {
    const { onToggle } = renderPicker({ selectedIds: new Set([5]) })
    type('ida')
    tab()
    expect(onToggle).not.toHaveBeenCalled()
    expect(input()).toHaveValue('')
    type('ida')
    key('Enter')
    expect(onToggle).toHaveBeenCalledWith(5)
  })

  it('with no query, Tab (and Shift+Tab) are left to the browser', () => {
    const { onToggle, onCreate } = renderPicker()
    for (const shift of [false, true]) {
      const ev = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true, cancelable: true })
      input().dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(false)
    }
    type('ida')
    const back = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })
    input().dispatchEvent(back)
    expect(back.defaultPrevented).toBe(false)
    expect(onToggle).not.toHaveBeenCalled()
    expect(onCreate).not.toHaveBeenCalled()
  })
})
