import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskLine } from '../../components/task/TaskLine'
import { useSettingsStore } from '../../stores/settings-store'
import { makeTodo, resetEntityStores } from '../helpers'

/**
 * A Lines row on its own: its day rolling over at midnight (cr33 M10), the
 * keyboard's way to its task menu (U4) and its tooltip's full dates (U8).
 * The real browser's focus and Shift+F10 are `e2e/list-zoom.spec.ts`'s.
 */

const line = () => document.querySelector<HTMLElement>('[data-task-line]')!
const lineDate = () => line().querySelector('[data-line-date]')

describe('TaskLine', () => {
  beforeEach(() => {
    resetEntityStores()
    useSettingsStore.setState({ urgentDueWithinDays: 3, staleAfterDays: 30, rowDates: 'relative' })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('rolls over at midnight without new props: the box and the date go late (cr33 M10)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16, 23, 59))
    render(<TaskLine todo={makeTodo({ id: 1, title: 'Due', dueDate: new Date(2026, 3, 16), modifiedAt: new Date(2026, 3, 16) })} />)
    expect(line()).toHaveAttribute('data-tone', 'soon')
    expect(lineDate()).toHaveTextContent('Today')
    expect(lineDate()).toHaveAttribute('data-date-tone', 'soon')
    act(() => { vi.advanceTimersByTime(10 * 60_000) })
    expect(line()).toHaveAttribute('data-tone', 'late')
    expect(lineDate()).toHaveTextContent('04/16')
    expect(lineDate()).toHaveAttribute('data-date-tone', 'late')
  })

  it('is a tab stop; the context-menu key on it opens the task menu under it, Esc hands the focus back (cr33 U4)', () => {
    render(<TaskLine todo={makeTodo({ id: 1, title: 'Keyed' })} />)
    expect(line()).toHaveAttribute('tabindex', '0')
    line().focus()
    // From the keyboard: no right button (Chromium reports -1), the event on the focused line.
    fireEvent.contextMenu(line(), { button: -1 })
    const menu = screen.getByRole('menu', { name: 'Task actions' })
    expect(menu).toContainElement(document.activeElement as HTMLElement)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(line()).toHaveFocus()
  })

  it('Enter on the focused line opens it, as a click does', () => {
    const onSelect = vi.fn()
    const onOpenDetail = vi.fn()
    render(<TaskLine todo={makeTodo({ id: 4, title: 'Enter me' })} onSelect={onSelect} onOpenDetail={onOpenDetail} />)
    fireEvent.keyDown(line(), { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(4, { shift: false, ctrl: false })
    expect(onOpenDetail).toHaveBeenCalledWith(4)
    fireEvent.keyDown(line(), { key: 'Enter', shiftKey: true })
    expect(onOpenDetail).toHaveBeenCalledOnce()
  })

  it('its tooltip gives each date in full with its year (cr33 U8)', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16, 10, 0))
    render(<TaskLine todo={makeTodo({ id: 1, title: 'Far', dueDate: new Date(2027, 0, 15), modifiedAt: new Date(2026, 3, 16) })} />)
    expect(lineDate()).toHaveTextContent('01/15')
    fireEvent.pointerEnter(line())
    act(() => { vi.advanceTimersByTime(1000) })
    expect(screen.getByRole('tooltip')).toHaveTextContent('Due Fri 15 Jan 2027')
  })
})
