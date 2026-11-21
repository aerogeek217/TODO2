import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { CalendarEntryButton } from '../../../components/workspace/calendar/CalendarEntryButton'
import type { CalendarEntry } from '../../../services/calendar-entries'
import { useTodoStore } from '../../../stores/todo-store'
import { makeTodo } from '../../helpers'

/**
 * A calendar entry (a month cell's, the week's, the day popover's) opens the
 * task menu on a right-click — the browser's own menu never shows — and on
 * Shift+F10 / the Menu key, under the entry. The menu acts on that one task,
 * Plan for day › among it; a pick goes no further than the menu.
 */

const TODAY = new Date(2026, 10, 20)
const task = makeTodo({ id: 4, uid: 'e', title: 'Send the deck', dueDate: new Date(2026, 10, 22) })
const entry: CalendarEntry = { todo: task, kind: 'due', isVirtual: false, day: new Date(2026, 10, 22), key: 'due-4', people: [], status: undefined }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 10, 20, 9))
  useTodoStore.setState({ todos: [task] })
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('a calendar entry’s task menu', () => {
  it('opens on a right-click, with Plan for day ›, and keeps the browser’s menu away', () => {
    const onOpen = vi.fn()
    render(<CalendarEntryButton entry={entry} today={TODAY} size="md" onOpen={onOpen} />)
    const button = screen.getByRole('button', { name: /Send the deck/ })
    const shown = fireEvent.contextMenu(button, { button: 2, clientX: 40, clientY: 50 })
    expect(shown).toBe(false)
    const menu = screen.getByRole('menu', { name: 'Task actions' })
    const labels = within(menu).getAllByRole('menuitem').map((m) => m.getAttribute('data-menu-label'))
    expect(labels).toContain('Plan for day')
    expect(labels).toContain('Open')
    // Open opens the task; the click on the item doesn't reach the entry a second time.
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Open' }))
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen).toHaveBeenCalledWith(4)
  })

  it('opens from the keyboard too, and Esc hands the focus back to the entry', () => {
    render(<CalendarEntryButton entry={entry} today={TODAY} size="md" onOpen={() => {}} />)
    const button = screen.getByRole('button', { name: /Send the deck/ })
    act(() => { button.focus() })
    fireEvent.contextMenu(button, { button: -1 })
    expect(screen.getByRole('menu', { name: 'Task actions' })).toBeInTheDocument()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button)
  })

  it('has none on the drag overlay’s copy', () => {
    render(<CalendarEntryButton entry={entry} today={TODAY} size="md" ghost />)
    fireEvent.contextMenu(screen.getByRole('button', { name: /Send the deck/ }), { button: 2 })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})
