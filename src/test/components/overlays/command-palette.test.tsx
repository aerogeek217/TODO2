import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../../../components/overlays/CommandPalette'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import type { Command } from '../../../services/command-registry'
import type { Person } from '../../../models/person'

// JSDOM has no scrollIntoView (the palette keeps the active row in view).
const proto = Element.prototype as { scrollIntoView?: unknown }
let originalScrollIntoView: unknown

beforeEach(() => {
  originalScrollIntoView = proto.scrollIntoView
  proto.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  if (originalScrollIntoView === undefined) delete proto.scrollIntoView
  else proto.scrollIntoView = originalScrollIntoView
})

describe('CommandPalette', () => {
  it('shows a command’s hint on the right of its row, and the Email section groups the check-in commands', () => {
    const open = vi.fn()
    const commands: Command[] = [
      { id: 'email-checkins', name: 'Email task check-ins…', hint: 'choose people', category: 'email', action: vi.fn() },
      { id: 'email-checkin-2', name: 'Email check-in: Ada Lovelace', hint: '4 open tasks', category: 'email', action: open },
    ]
    const onClose = vi.fn()
    render(<CommandPalette commands={commands} onClose={onClose} />)
    const section = screen.getByRole('group', { name: 'Email' })
    const row = screen.getByRole('option', { name: /Email check-in: Ada Lovelace/ })
    expect(section).toContainElement(row)
    expect(row).toHaveTextContent('4 open tasks')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('option', { name: /Ada Lovelace/ }))
    expect(open).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  describe('search', () => {
    // The real command list: navigation, task, filter, bulk (two tasks selected) and email commands.
    const people: Person[] = [
      { id: 1, name: 'Marcus Chen', initials: 'MC', email: 'marcus@example.com' },
      { id: 2, name: 'Ada Lovelace', initials: 'AL', email: 'ada@example.com' },
      { id: 3, name: 'Mark Twain', initials: 'MT', email: 'mark@example.com' },
    ]
    function realCommands(openCheckinDialog = vi.fn()): Command[] {
      const ctx: CommandContext = {
        openSettings: vi.fn(), openQuickAdd: vi.fn(), selectionCount: 2,
        bulkSetCompleted: vi.fn(), bulkSetStatus: vi.fn(), bulkRemove: vi.fn(), getSelectedIds: () => [],
        clearAllFilters: vi.fn(), setShowCompleted: vi.fn(), getShowCompleted: () => false, setDateRange: vi.fn(),
        getTodos: () => [], focusTask: vi.fn(), openShortcutsModal: vi.fn(),
        getStatuses: () => [{ id: 1, name: 'Waiting', color: '#888888', sortOrder: 0 }],
        openCheckinDialog, openCheckinImport: vi.fn(),
        getPeople: () => people, getOpenTaskCounts: () => new Map([[1, 3], [2, 4], [3, 1]]),
      }
      return createCommands(ctx)
    }
    const optionNames = () => screen.queryAllByRole('option').map((o) => o.querySelector('span')?.textContent ?? '')
    const type = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })

    it('matches every word of a multi-word query on its own, in any order, best match first', () => {
      const open = vi.fn()
      const onClose = vi.fn()
      render(<CommandPalette commands={realCommands(open)} onClose={onClose} />)
      type('email mar')
      expect(optionNames().slice(0, 2)).toEqual(['Email check-in: Marcus Chen', 'Email check-in: Mark Twain'])
      type('mar email')
      expect(optionNames()[0]).toBe('Email check-in: Marcus Chen')
      type('  email   ada ')
      expect(optionNames()).toEqual(['Email check-in: Ada Lovelace'])
      type('import reply')
      expect(optionNames()).toEqual(['Import check-in reply…'])
      type('clear filters')
      expect(optionNames()).toEqual(['Clear All Filters'])
      type('>email mark')
      expect(optionNames()).toEqual(['Email check-in: Mark Twain'])
      // Enter runs the top match.
      type('email mar')
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
      expect(open).toHaveBeenCalledWith([1])
      expect(onClose).toHaveBeenCalled()
    })

    it('highlights the letters each word matched in the command name', () => {
      render(<CommandPalette commands={realCommands()} onClose={vi.fn()} />)
      type('email marc')
      const row = screen.getByRole('option', { name: /Marcus Chen/ })
      const marked = Array.from(row.querySelectorAll('mark')).map((m) => m.textContent).join('')
      expect(marked).toContain('Email')
      expect(marked).toContain('Marc')
    })

    it('ranks one-word queries as before', () => {
      render(<CommandPalette commands={realCommands()} onClose={vi.fn()} />)
      type('settings')
      expect(optionNames()).toEqual(['Open Settings'])
      type('undo')
      expect(optionNames()).toEqual(['Undo', 'Uncomplete 2 Tasks'])
      type('filters')
      expect(optionNames()).toEqual(['Focus Filters', 'Clear All Filters', 'Toggle Show Completed', 'Show Overdue Tasks'])
      type('complete')
      expect(optionNames()).toEqual(['Complete 2 Tasks', 'Uncomplete 2 Tasks', 'Toggle Show Completed'])
      type('email')
      expect(optionNames()).toEqual([
        'Email task check-ins…', 'Email check-in: Ada Lovelace', 'Email check-in: Marcus Chen',
        'Email check-in: Mark Twain', 'Import check-in reply…',
      ])
    })

    it('passes the whole query to the task search, whatever the number of words', () => {
      const onSearchDynamic = vi.fn((q: string): Command[] => [
        { id: 'task-7', name: `Task for ${q}`, category: 'tasks', action: vi.fn() },
      ])
      render(<CommandPalette commands={realCommands()} onSearchDynamic={onSearchDynamic} onClose={vi.fn()} />)
      type('quarterly report')
      expect(onSearchDynamic).toHaveBeenLastCalledWith('quarterly report')
      expect(screen.getByRole('group', { name: 'Search Results' })).toHaveTextContent('Task for quarterly report')
      type('>quarterly report')
      expect(screen.queryByRole('group', { name: 'Search Results' })).toBeNull()
    })
  })
})

describe('CommandPalette — the active row', () => {
  it('a new query starts again at its first result', () => {
    const commands: Command[] = ['Alpha one', 'Alpha two', 'Alpha three'].map((name, i) => ({ id: `c${i}`, name, category: 'navigation', action: vi.fn() }))
    render(<CommandPalette commands={commands} onClose={vi.fn()} />)
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'alpha' } })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    fireEvent.keyDown(input, { key: 'ArrowDown' })
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true')
    fireEvent.change(input, { target: { value: 'alpha t' } })
    expect(screen.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true')
  })
})
