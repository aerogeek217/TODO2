import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { TaskPillBar, TaskPillFollowup } from '../../../components/shared/TaskPillBar'
import { makeTodo } from '../../helpers'

// Sat 10 Oct 2026.
const today = new Date(2026, 9, 10)

afterEach(cleanup)

describe('<TaskPillFollowup>', () => {
  it('renders nothing without a next follow-up', () => {
    const { container } = render(<TaskPillFollowup todo={makeTodo({ id: 1 })} today={today} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the next follow-up with a tooltip; × clears only the follow-up', () => {
    const onClear = vi.fn()
    const onClick = vi.fn()
    const todo = makeTodo({ id: 1, nextFollowupAt: new Date(2026, 9, 13), lastFollowupAt: new Date(2026, 8, 13) })
    render(<TaskPillFollowup todo={todo} today={today} onFollowupClick={onClick} onFollowupClear={onClear} />)
    const pill = screen.getByRole('button', { name: 'Follow-up: Tue 13' })
    expect(pill).toHaveAttribute('title', 'Next follow-up · Tue 13 Oct\nLast followed up Sun 13 Sep, 4 weeks ago')
    fireEvent.click(screen.getByLabelText('Clear follow-up'))
    expect(onClear).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    fireEvent.click(pill)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('overdue: "Nd late" + overdue marker; today reads "Today"', () => {
    render(<TaskPillFollowup todo={makeTodo({ id: 1, nextFollowupAt: new Date(2026, 9, 9) })} today={today} />)
    const pill = screen.getByRole('button', { name: 'Follow-up: Fri 9 · 1d late' })
    expect(pill).toHaveAttribute('data-followup-overdue', 'true')
    cleanup()
    render(<TaskPillFollowup todo={makeTodo({ id: 2, nextFollowupAt: today })} today={today} />)
    expect(screen.getByRole('button', { name: 'Follow-up: Today' })).not.toHaveAttribute('data-followup-overdue')
  })

  it('completed tasks: never overdue, no ×', () => {
    const todo = makeTodo({ id: 1, isCompleted: true, nextFollowupAt: new Date(2026, 9, 9) })
    render(<TaskPillFollowup todo={todo} today={today} onFollowupClear={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Follow-up: Fri 9' })).not.toHaveAttribute('data-followup-overdue')
    expect(screen.queryByLabelText('Clear follow-up')).toBeNull()
  })

  it('TaskPillBar renders it after the dates; no × without a clear handler (touch rows)', () => {
    const todo = makeTodo({ id: 1, dueDate: new Date(2026, 9, 20), nextFollowupAt: new Date(2026, 9, 13) })
    render(<TaskPillBar todo={todo} people={[]} today={today} weekStartsOn={1} />)
    const pill = screen.getByRole('button', { name: 'Follow-up: Tue 13' })
    expect(pill).toBeInTheDocument()
    expect(screen.queryByLabelText('Clear follow-up')).toBeNull()
  })
})
