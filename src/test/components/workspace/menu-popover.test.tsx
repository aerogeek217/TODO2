import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, render, screen, fireEvent, cleanup } from '@testing-library/react'
import { useRef, useState } from 'react'
import { MenuPopover, type MenuEntry } from '../../../components/workspace/MenuPopover'

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

describe('MenuPopover — D0 popover menu', () => {
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
