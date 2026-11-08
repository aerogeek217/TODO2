import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TaskLine } from '../../components/task/TaskLine'
import { useSettingsStore } from '../../stores/settings-store'
import { makeTodo, resetEntityStores } from '../helpers'

/**
 * A Lines row on its own: its day rolling over at midnight (cr33 M10), the
 * keyboard's way to its task menu (U4) and its tooltip's full dates (U8).
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
})
