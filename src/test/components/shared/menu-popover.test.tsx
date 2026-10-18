import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { StrictMode, useRef, useState } from 'react'
import { MenuPopover, type MenuEntry } from '../../../components/shared/MenuPopover'

afterEach(cleanup)

function WithTrigger({ entries }: { entries: readonly MenuEntry[] }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button ref={ref} type="button" onClick={() => setOpen((v) => !v)}>Trigger</button>
      {open && <MenuPopover anchorRef={ref} entries={entries} label="Test menu" onClose={() => setOpen(false)} />}
    </>
  )
}

const item = (label: string, extra: Partial<Extract<MenuEntry, { kind: 'item' }>> = {}): MenuEntry =>
  ({ kind: 'item', label, onSelect: vi.fn(), ...extra })

describe('MenuPopover — the popover menu', () => {
  it('checkbox items: aria-checked true / false / mixed with a note', () => {
    render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={vi.fn()} entries={[
      item('On', { checkbox: true, checked: true }),
      item('Off', { checkbox: true, checked: false }),
      item('Some', { checkbox: true, checked: 'mixed', note: '1 of 3' }),
    ]} />)
    expect(screen.getByRole('menuitemcheckbox', { name: 'On' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('menuitemcheckbox', { name: 'Off' })).toHaveAttribute('aria-checked', 'false')
    const some = screen.getByRole('menuitemcheckbox', { name: /Some/ })
    expect(some).toHaveAttribute('aria-checked', 'mixed')
    expect(some).toHaveTextContent('1 of 3')
  })

  it('focus starts on the first item; Esc closes and returns focus to the trigger', () => {
    render(<WithTrigger entries={[item('Alpha'), item('Beta')]} />)
    const trigger = screen.getByRole('button', { name: 'Trigger' })
    act(() => { trigger.focus() })
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Alpha' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('↑↓ wrap, Home / End, a letter jumps to the next item starting with it', () => {
    render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={vi.fn()} entries={[
      item('Apple'), { kind: 'separator' }, item('Banana'), item('Blueberry'), { kind: 'label', text: 'Group' }, item('Cherry'),
    ]} />)
    const at = () => document.activeElement?.getAttribute('data-menu-label')
    const key = (k: string) => fireEvent.keyDown(document.activeElement!, { key: k })
    expect(at()).toBe('Apple')
    key('ArrowUp'); expect(at()).toBe('Cherry')
    key('ArrowDown'); expect(at()).toBe('Apple')
    key('End'); expect(at()).toBe('Cherry')
    key('Home'); expect(at()).toBe('Apple')
    key('b'); expect(at()).toBe('Banana')
    key('b'); expect(at()).toBe('Blueberry')
    key('b'); expect(at()).toBe('Banana')
  })

  it('a nested submenu opens on hover / click / →, ← and Esc close only it, its item closes everything', async () => {
    const onClose = vi.fn()
    const pick = vi.fn()
    render(<MenuPopover point={{ x: 0, y: 0 }} label="Root" onClose={onClose} entries={[
      item('First'),
      { kind: 'item', label: 'More', children: [item('Inner', { onSelect: pick })] },
      item('Last'),
    ]} />)
    const more = screen.getByRole('menuitem', { name: 'More' })
    expect(more).toHaveAttribute('aria-haspopup', 'menu')
    fireEvent.pointerEnter(more)
    expect(screen.getByRole('menu', { name: 'More' })).toBeInTheDocument()
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Last' }))
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull()

    act(() => { more.focus() })
    fireEvent.keyDown(more, { key: 'ArrowRight' })
    await act(async () => { await Promise.resolve() })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Inner' }))
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull()
    expect(document.activeElement).toBe(more)

    fireEvent.click(more)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'More' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(more)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Inner' }))
    expect(pick).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('a click inside the submenu does not count as an outside click', () => {
    const onClose = vi.fn()
    render(<MenuPopover point={{ x: 0, y: 0 }} label="Root" onClose={onClose} entries={[
      { kind: 'item', label: 'More', children: [item('Inner', { keepOpen: true })] },
    ]} />)
    fireEvent.click(screen.getByRole('menuitem', { name: 'More' }))
    fireEvent.mouseDown(screen.getByRole('menuitem', { name: 'Inner' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc stops at the menu (it does not reach other key handlers)', () => {
    const outer = vi.fn()
    document.addEventListener('keydown', outer)
    try {
      render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={vi.fn()} entries={[item('A')]} />)
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
      expect(outer).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', outer)
    }
  })
})

describe('MenuPopover — panels, radio choices, footnotes, focus owner', () => {
  const panelItem = (onButton = vi.fn()): MenuEntry => item('Rule', {
    onSelect: undefined,
    note: 'U+I',
    panel: {
      label: 'Rule panel',
      width: 300,
      render: () => <div><button type="button" onClick={onButton}>First</button><button type="button">Second</button></div>,
    },
  })

  it('hover opens a panel without focus; hovering a plain item closes it again', () => {
    render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={vi.fn()} entries={[item('Plain'), panelItem()]} />)
    const row = screen.getByRole('menuitem', { name: /Rule/ })
    expect(row).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.pointerEnter(row)
    const panel = screen.getByRole('dialog', { name: 'Rule panel' })
    expect(panel.style.width).toBe('300px')
    expect(panel).toHaveAttribute('data-shortcut-scope', 'none')
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'First' }))
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Plain' }))
    expect(screen.queryByRole('dialog', { name: 'Rule panel' })).toBeNull()
  })

  it('a click opens it pinned with the focus inside: plain items don’t close it, its controls don’t close the menu', () => {
    const onClose = vi.fn()
    const onButton = vi.fn()
    render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={onClose} entries={[item('Plain'), panelItem(onButton)]} />)
    fireEvent.click(screen.getByRole('menuitem', { name: /Rule/ }), { detail: 1 })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
    fireEvent.pointerEnter(screen.getByRole('menuitem', { name: 'Plain' }))
    expect(screen.getByRole('dialog', { name: 'Rule panel' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'First' }))
    expect(onButton).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // Tab cycles inside the panel.
    act(() => { screen.getByRole('button', { name: 'Second' }).focus() })
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
  })

  it('Esc or ← in the panel closes only it, back on its item; a mousedown inside is not outside', () => {
    const onClose = vi.fn()
    render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={onClose} entries={[panelItem()]} />)
    const row = screen.getByRole('menuitem', { name: /Rule/ })
    act(() => { row.focus() })
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
    fireEvent.mouseDown(screen.getByRole('button', { name: 'Second' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Rule panel' })).toBeNull()
    expect(document.activeElement).toBe(row)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(row, { key: 'ArrowRight' })
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' })
    expect(screen.queryByRole('dialog', { name: 'Rule panel' })).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('radio choices with a leading circle and a footnote; → focuses the checked one', () => {
    render(<MenuPopover point={{ x: 0, y: 0 }} label="m" onClose={vi.fn()} entries={[
      item('Range', {
        onSelect: undefined,
        note: '3 days',
        children: [
          { kind: 'label', text: 'Pick a range' },
          item('Off', { radio: true, indicator: 'radio', checked: false }),
          item('3 days', { radio: true, indicator: 'radio', checked: true, note: 'by Tue' }),
          { kind: 'separator' },
          { kind: 'note', text: 'Overdue counts too.' },
        ],
      }),
    ]} />)
    const row = screen.getByRole('menuitem', { name: /Range/ })
    act(() => { row.focus() })
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    const sub = screen.getByRole('menu', { name: 'Range' })
    expect(sub).toHaveTextContent('Overdue counts too.')
    const checked = screen.getByRole('menuitemradio', { name: /3 days/ })
    expect(document.activeElement).toBe(checked)
    expect(checked).toHaveAttribute('aria-checked', 'true')
    // The circle shows the choice, not the trailing check.
    expect(checked.querySelector('svg')).toBeNull()
  })

  it('a menu at the pointer gives Esc focus back to what had it before, after a re-run of its mount effect', () => {
    function AtPointer() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Opener</button>
          {open && <MenuPopover point={{ x: 0, y: 0 }} entries={[item('Alpha')]} label="p" onClose={() => setOpen(false)} />}
        </>
      )
    }
    render(<StrictMode><AtPointer /></StrictMode>)
    const opener = screen.getByRole('button', { name: 'Opener' })
    act(() => { opener.focus() })
    fireEvent.click(opener)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Alpha' }))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })
})

describe('MenuPopover — over a popover, focus kept for a picker', () => {
  it('Esc closes only the menu: a popover below listening on the document never sees it', () => {
    const below = vi.fn()
    document.addEventListener('keydown', below, true)
    try {
      const onClose = vi.fn()
      render(<MenuPopover point={{ x: 0, y: 0 }} entries={[item('Alpha')]} label="m" onClose={onClose} />)
      fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Alpha' }), { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(below).not.toHaveBeenCalled()
    } finally {
      document.removeEventListener('keydown', below, true)
    }
  })

  it('restoreFocus: an item hands the focus back before its action runs, and a click outside the menu does too', () => {
    let focusedInAction: Element | null = null
    function Picker() {
      const [open, setOpen] = useState(true)
      return (
        <>
          {open && (
            <MenuPopover
              point={{ x: 0, y: 0 }}
              restoreFocus
              label="m"
              entries={[{ kind: 'item', label: 'Edit…', onSelect: () => { focusedInAction = document.activeElement } }]}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }
    // Focus the search before the menu mounts: it is what had the focus.
    const search = document.createElement('input')
    document.body.appendChild(search)
    search.focus()
    render(<Picker />)
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Edit…' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit…' }))
    expect(focusedInAction).toBe(search)
    expect(document.activeElement).toBe(search)
    search.remove()
  })

  it('restoreFocus: closed by a press outside, the focus goes back too', () => {
    function Picker() {
      const [open, setOpen] = useState(true)
      return (
        <>
          <div data-testid="elsewhere">elsewhere</div>
          {open && <MenuPopover point={{ x: 0, y: 0 }} restoreFocus label="m" entries={[item('Alpha')]} onClose={() => setOpen(false)} />}
        </>
      )
    }
    const search = document.createElement('input')
    document.body.appendChild(search)
    search.focus()
    render(<Picker />)
    fireEvent.mouseDown(screen.getByTestId('elsewhere'))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(search)
    search.remove()
  })
})
