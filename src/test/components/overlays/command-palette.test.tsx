import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { CommandPalette } from '../../../components/overlays/CommandPalette'
import { createCommands, type CommandContext } from '../../../services/command-registry'
import type { Command } from '../../../services/command-registry'
import type { Person } from '../../../models/person'
import { createTab } from '../../../models/workspace-layout'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { cell, grid } from '../../helpers/layout-builders'

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
  it('shows a command’s hint on the right of its row, and a section groups its category’s commands', () => {
    const open = vi.fn()
    const commands: Command[] = [
      { id: 'filter-show-tasks', name: 'Show Tasks Matching the Filter', hint: '12 tasks', category: 'filter', action: vi.fn() },
      { id: 'filter-ada', name: 'Show tasks of Ada Lovelace', hint: '4 open tasks', category: 'filter', action: open },
    ]
    const onClose = vi.fn()
    render(<CommandPalette commands={commands} onClose={onClose} />)
    const section = screen.getByRole('group', { name: 'Filters' })
    const row = screen.getByRole('option', { name: /Show tasks of Ada Lovelace/ })
    expect(section).toContainElement(row)
    expect(row).toHaveTextContent('4 open tasks')
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Ada' } })
    fireEvent.click(screen.getByRole('option', { name: /Ada Lovelace/ }))
    expect(open).toHaveBeenCalled()
    expect(onClose).toHaveBeenCalled()
  })

  describe('search', () => {
    // The real command list: navigation, task, filter and bulk (two tasks selected) commands.
    const people: Person[] = [
      { id: 1, name: 'Marcus Chen', initials: 'MC' },
      { id: 2, name: 'Ada Lovelace', initials: 'AL' },
      { id: 3, name: 'Mark Twain', initials: 'MT' },
    ]
    function realCommands(): Command[] {
      const ctx: CommandContext = {
        shortcuts: { openPalette: vi.fn(), closePalette: vi.fn(), openSettings: vi.fn(), openShortcutsModal: vi.fn() },
        selectionCount: 2,
        bulkSetCompleted: vi.fn(), bulkSetStatus: vi.fn(), bulkRemove: vi.fn(), getSelectedIds: () => [],
        clearAllFilters: vi.fn(), setShowCompleted: vi.fn(), getShowCompleted: () => false, setDateRange: vi.fn(),
        getTodos: () => [], focusTask: vi.fn(),
        getStatuses: () => [{ id: 1, name: 'Waiting', color: '#888888', sortOrder: 0 }],
        getPeople: () => people, getOpenTaskCounts: () => new Map([[1, 3], [2, 4], [3, 1]]),
      }
      return createCommands(ctx)
    }
    // A Review widget on the open layout: Review With › lists the people (a jump goes there).
    beforeEach(() => {
      const layout = { id: 1, name: 'Main', sortOrder: 0, createdAt: new Date(0), modifiedAt: new Date(0), ...grid([[cell('a', [createTab('review', 'rv')])]]) }
      useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout], activeLayoutId: 1 })
    })
    const optionNames = () => screen.queryAllByRole('option').map((o) => o.querySelector('span')?.textContent ?? '')
    const type = (value: string) => fireEvent.change(screen.getByRole('combobox'), { target: { value } })

    it('matches every word of a multi-word query on its own, in any order, best match first', async () => {
      const onClose = vi.fn()
      render(<CommandPalette commands={realCommands()} onClose={onClose} />)
      type('review mar')
      expect(optionNames().slice(0, 2)).toEqual(['Review With › Marcus Chen', 'Review With › Mark Twain'])
      type('mar review')
      expect(optionNames()[0]).toBe('Review With › Marcus Chen')
      type('  review   ada ')
      expect(optionNames()).toEqual(['Review With › Ada Lovelace'])
      type('clear filters')
      expect(optionNames()).toEqual(['Clear All Filters'])
      type('>review mark')
      expect(optionNames()[0]).toBe('Review With › Mark Twain')
      expect(screen.queryByRole('group', { name: 'Search Results' })).toBeNull()
      // Enter runs the top match.
      type('review mar')
      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
      expect(onClose).toHaveBeenCalled()
      await vi.waitFor(() => expect(useListWidgetStore.getState().reviewFilters.rv?.expression).toEqual({ kind: 'person', id: 1 }))
    })

    it('highlights the letters each word matched in the command name', () => {
      render(<CommandPalette commands={realCommands()} onClose={vi.fn()} />)
      type('review marc')
      const row = screen.getByRole('option', { name: /Marcus Chen/ })
      expect(row.querySelector('span')?.textContent).toBe('Review With › Marcus Chen')
      const marked = Array.from(row.querySelectorAll('mark')).map((m) => m.textContent).join('')
      expect(marked).toContain('Review')
      expect(marked).toContain('Marc')
    })

    it('highlights the matched letters after an emoji (Fuse’s offsets are UTF-16 units, cr31)', () => {
      const commands: Command[] = [{ id: 'party', name: 'Open 🎉 Party list', category: 'navigation', action: vi.fn() }]
      render(<CommandPalette commands={commands} onClose={vi.fn()} />)
      type('party')
      const row = screen.getByRole('option', { name: /Party list/ })
      expect(row.querySelector('span')?.textContent).toBe('Open 🎉 Party list')
      expect(Array.from(row.querySelectorAll('mark')).map((m) => m.textContent).join('')).toBe('Party')
    })

    it('ranks one-word queries as before', () => {
      render(<CommandPalette commands={realCommands()} onClose={vi.fn()} />)
      type('settings')
      expect(optionNames()).toEqual(['Open Settings'])
      type('undo')
      expect(optionNames()).toEqual(['Undo', 'Uncomplete 2 Tasks'])
      type('filters')
      expect(optionNames()).toEqual(['Open Filter Menu', 'Focus Filter Field', 'Clear All Filters', 'Toggle Show Completed', 'Cycle Lens', 'Lift Lens / Put It Back', 'Show Overdue Tasks'])
      type('complete')
      expect(optionNames()).toEqual(['Complete 2 Tasks', 'Uncomplete 2 Tasks', 'Toggle Show Completed'])
      // No check-in commands: those are on the Review widget's field.
      type('check-in')
      expect(optionNames()).toEqual([])
    })

    it('passes the whole query to the task search, whatever the number of words', () => {
      const onSearchDynamic = vi.fn((q: string): Command[] => [
        { id: 'task-7', name: `Task for ${q}`, category: 'search-results', action: vi.fn() },
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

describe('CommandPalette — second steps', () => {
  const go = vi.fn()
  const review = vi.fn()
  const show = vi.fn()
  const addList = vi.fn()
  function stepCommands(): Command[] {
    const leaf = (id: string, name: string, category: Command['category'], action: () => void, extra: Partial<Command> = {}): Command => ({ id, name, category, action, ...extra })
    return [
      { id: 'open-settings', name: 'Open Settings', category: 'navigation', action: vi.fn() },
      {
        id: 'go-to-layout', name: 'Go to Layout', category: 'layout', action: vi.fn(),
        step: [leaf('go-1', 'Daily', 'layout', () => go(1)), leaf('go-2', 'Planning', 'layout', () => go(2), { current: true })],
      },
      {
        id: 'add-widget', name: 'Add Widget', category: 'layout', action: vi.fn(),
        step: [leaf('add-list', 'List', 'layout', addList, { group: 'Tasks' }), leaf('add-number', 'Number', 'layout', vi.fn(), { group: 'Insights' })],
      },
      {
        id: 'review-with', name: 'Review With', category: 'task', action: vi.fn(),
        step: [leaf('review-1', 'Aisha Rahman', 'task', () => review(1), { hint: '3 open tasks' }), leaf('review-2', 'Ben Ito', 'task', () => review(2))],
      },
      {
        id: 'show-tasks-of', name: 'Show Tasks Of', category: 'filter', action: vi.fn(),
        step: [leaf('show-1', 'Aisha Rahman', 'filter', () => show(1)), leaf('show-2', 'Ben Ito', 'filter', () => show(2))],
      },
    ]
  }
  const input = () => screen.getByRole('combobox')
  const type = (value: string) => fireEvent.change(input(), { target: { value } })
  const key = (k: string) => fireEvent.keyDown(input(), { key: k })
  const optionNames = () => screen.queryAllByRole('option').map((o) => o.querySelector('span')?.textContent ?? '')
  const activeName = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '')?.querySelector('span')?.textContent

  beforeEach(() => vi.clearAllMocks())

  it('at rest lists the step commands, marked as opening a step, not what is in them', () => {
    render(<CommandPalette commands={stepCommands()} onClose={vi.fn()} />)
    expect(optionNames()).toEqual(['Open Settings', 'Go to Layout', 'Add Widget', 'Review With', 'Show Tasks Of'])
    expect(screen.getByRole('option', { name: /Go to Layout/ })).toHaveAttribute('aria-haspopup', 'listbox')
    expect(screen.getByRole('option', { name: /Open Settings/ })).not.toHaveAttribute('aria-haspopup')
  })

  it('Enter on a step opens it in place under a breadcrumb; typing filters it; Enter runs a leaf and closes', () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={stepCommands()} onClose={onClose} />)
    type('go to')
    key('Enter')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('command-palette-crumb')).toHaveTextContent(/^Go to Layout\s*›$/)
    expect(input()).toHaveValue('')
    expect(input()).toHaveAttribute('aria-describedby', 'command-palette-crumb')
    expect(document.activeElement).toBe(input())
    expect(optionNames()).toEqual(['Daily', 'Planning'])
    // The open layout is marked.
    expect(screen.getByRole('option', { name: /Planning/ })).toHaveTextContent('Current')
    // The footer says how back works (and no longer `> Commands only`).
    const footer = screen.getByText('Navigate').parentElement
    expect(footer).toHaveTextContent('Backspace or Esc Back')
    expect(footer).not.toHaveTextContent('Commands only')
    type('plan')
    expect(optionNames()).toEqual(['Planning'])
    key('Enter')
    expect(go).toHaveBeenCalledWith(2)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a click on a step opens it and keeps the focus in the field', () => {
    render(<CommandPalette commands={stepCommands()} onClose={vi.fn()} />)
    const row = screen.getByRole('option', { name: /Review With/ })
    // The press doesn't take the focus from the field.
    expect(fireEvent.mouseDown(row)).toBe(false)
    fireEvent.click(row)
    expect(optionNames()).toEqual(['Aisha Rahman', 'Ben Ito'])
    expect(document.activeElement).toBe(input())
  })

  it('Backspace in the empty field and Esc each go back one step, the query and the step row as they were; Esc then closes', () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={stepCommands()} onClose={onClose} />)
    type('widget')
    key('Enter')
    expect(optionNames()).toEqual(['List', 'Number'])
    type('n')
    key('Backspace') // a character to delete: stays in the step
    expect(screen.queryByTestId('command-palette-crumb')).not.toBeNull()
    type('')
    key('Backspace')
    expect(screen.queryByTestId('command-palette-crumb')).toBeNull()
    expect(input()).toHaveValue('widget')
    expect(activeName()).toBe('Add Widget')
    type('')
    key('ArrowDown')
    key('Enter') // Go to Layout
    key('Escape')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.queryByTestId('command-palette-crumb')).toBeNull()
    expect(activeName()).toBe('Go to Layout')
    key('Escape')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a step’s groups have their headings (Add Widget ›: Tasks, Insights)', () => {
    render(<CommandPalette commands={stepCommands()} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('option', { name: /Add Widget/ }))
    expect(screen.getByRole('group', { name: 'Tasks' })).toHaveTextContent('List')
    expect(screen.getByRole('group', { name: 'Insights' })).toHaveTextContent('Number')
  })

  it('a query at the top level reaches into the steps, by path; a word must match a leaf’s own name', () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={stepCommands()} onClose={onClose} />)
    type('planning')
    expect(optionNames()).toEqual(['Go to Layout › Planning'])
    type('aisha')
    expect(optionNames()).toEqual(['Review With › Aisha Rahman', 'Show Tasks Of › Aisha Rahman'])
    expect(screen.getByRole('group', { name: 'Tasks' })).toHaveTextContent('3 open tasks')
    type('show aisha')
    expect(optionNames()).toEqual(['Show Tasks Of › Aisha Rahman'])
    // The step's name alone finds the step (and its category's commands), not each leaf.
    type('layout')
    expect(optionNames()).toContain('Go to Layout')
    expect(optionNames().filter((n) => n.includes('›'))).toEqual([])
    // A step command that matches comes before its leaves.
    type('go to lay')
    expect(optionNames()[0]).toBe('Go to Layout')
    // Its matched letters are marked on the path.
    type('review ben')
    const marked = Array.from(screen.getByRole('option', { name: /Ben Ito/ }).querySelectorAll('mark')).map((m) => m.textContent).join('')
    expect(marked).toContain('Review')
    expect(marked).toContain('Ben')
    // Enter runs the leaf there and then.
    type('aisha')
    key('Enter')
    expect(review).toHaveBeenCalledWith(1)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('a leaf gives the focus back to what opened the palette before it runs; a step doesn’t', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    let focusedWhenRun: Element | null = null
    const commands = stepCommands()
    const step = commands.find((c) => c.id === 'go-to-layout')!
    step.step = [{ id: 'go-1', name: 'Daily', category: 'layout', action: () => { focusedWhenRun = document.activeElement } }]
    render(<CommandPalette commands={commands} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('option', { name: /Go to Layout/ }))
    expect(document.activeElement).toBe(input())
    fireEvent.click(screen.getByRole('option', { name: /Daily/ }))
    expect(focusedWhenRun).toBe(opener)
    opener.remove()
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

describe('CommandPalette as a dialog', () => {
  const commands: Command[] = [{ id: 'a', name: 'Alpha', category: 'navigation', action: vi.fn() }]

  it('Tab stays in it, and an Esc with nothing focused closes it', () => {
    const onClose = vi.fn()
    render(<CommandPalette commands={commands} onClose={onClose} />)
    const input = screen.getByRole('combobox')
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    input.blur()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closing gives focus back, unless what the command opened already took it', () => {
    const opener = document.createElement('button')
    const other = document.createElement('input')
    document.body.append(opener, other)
    opener.focus()
    const { unmount } = render(<CommandPalette commands={commands} onClose={vi.fn()} />)
    other.focus()
    unmount()
    expect(document.activeElement).toBe(other)
    opener.remove()
    other.remove()
  })
})

describe('DialogFrame focus return', () => {
  it('a dialog closed after something else took the focus leaves it there', async () => {
    const { DialogFrame } = await import('../../../components/shared/Dialog')
    const opener = document.createElement('button')
    const other = document.createElement('input')
    document.body.append(opener, other)
    opener.focus()
    const { unmount } = render(<DialogFrame onClose={vi.fn()} aria-label="D"><button>In</button></DialogFrame>)
    expect(document.activeElement?.textContent).toBe('In')
    other.focus()
    unmount()
    expect(document.activeElement).toBe(other)
    opener.remove()
    other.remove()
  })
})
