import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  TaskPillBar,
  TaskPillPeople,
  TaskPillDates,
  TaskPillStatus,
} from '../../../components/shared/TaskPillBar'
import type { Status } from '../../../models'
import { makeTodo, makePerson } from '../../helpers'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'

const today = new Date(2026, 3, 16) // Apr 16, 2026 (Thursday)

const inProgress: Status = {
  id: 5,
  name: 'In Progress',
  color: '#00ff00',
  sortOrder: 1,
  icon: 'circle',
}

afterEach(cleanup)

describe('<TaskPillBar>', () => {
  describe('full row (default density, interactive=true)', () => {
    it('renders people avatars + due-date chip + status', () => {
      const todo = makeTodo({
        id: 1,
        dueDate: new Date(2026, 3, 25),
        statusId: 5,
      })
      render(
        <TaskPillBar
          todo={todo}
          people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
          status={inProgress}
          today={today}
        />,
      )
      expect(screen.getByText('AL')).toBeInTheDocument()
      expect(screen.getByTitle('Due — click to change')).toBeInTheDocument()
      expect(screen.getByLabelText('Status: In Progress')).toBeInTheDocument()
    })

    it('renders nothing for the date block when there is no due date', () => {
      const todo = makeTodo({ id: 1 })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
        />,
      )
      expect(container.querySelector('[class*="deadlineChip"]')).toBeNull()
      expect(container.querySelector('[class*="dateStack"]')).toBeNull()
    })

    it('renders no people group when there are no people', () => {
      const todo = makeTodo({ id: 1 })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
        />,
      )
      expect(container.querySelector('[class*="peopleGroup"]')).toBeNull()
    })

    it('renders the status indicator with empty dot when no status', () => {
      const todo = makeTodo({ id: 1 })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
        />,
      )
      expect(screen.getByLabelText('Set status')).toBeInTheDocument()
    })

    it('shows the × clear button on the due-date chip when onDeadlineClear is provided', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
          onDeadlineClear={() => undefined}
        />,
      )
      expect(screen.getByLabelText('Clear due date')).toBeInTheDocument()
    })

    it('omits the × clear button when onDeadlineClear is not provided', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
        />,
      )
      expect(screen.queryByLabelText('Clear due date')).toBeNull()
    })

    it('fires the due-date chip callback on click', () => {
      const onDeadlineClick = vi.fn()
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
          onDeadlineClick={onDeadlineClick}
        />,
      )
      fireEvent.click(container.querySelector('[class*="deadlineChip"]')!)
      expect(onDeadlineClick).toHaveBeenCalledTimes(1)
    })

    it('renders the recurrence indicator when recurrenceRule is set', () => {
      const todo = makeTodo({
        id: 1,
        dueDate: new Date(2026, 3, 25),
        recurrenceRule: { type: 'weekly' },
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
        />,
      )
      expect(container.querySelector('[class*="recurrenceIndicator"]')).toBeInTheDocument()
    })

    it('marks the deadline chip past when due date is before today', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 10) })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
        />,
      )
      const chip = container.querySelector('[class*="deadlineChip"]') as HTMLElement
      expect(chip.className).toMatch(/deadlineChipPast/)
    })
  })

  describe('compact mode (calendar EventRow)', () => {
    it('renders icon-only date markers (no labels)', () => {
      const todo = makeTodo({
        id: 1,
        dueDate: new Date(2026, 3, 25),
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
          interactive={false}
          compact
        />,
      )
      // Marker — no due-date chip container in compact
      expect(container.querySelector('[class*="markerDeadline"]')).toBeInTheDocument()
      expect(container.querySelector('[class*="deadlineChip"]')).toBeNull()
    })

    it("fills person avatars with the person's color in compact mode", () => {
      const todo = makeTodo({ id: 1 })
      render(
        <TaskPillBar
          todo={todo}
          people={[makePerson({ id: 1, name: 'Alice', initials: 'AL', color: '#ff0000' })]}
          today={today}
          interactive={false}
          compact
        />,
      )
      expect(screen.getByText('AL')).toHaveStyle({ backgroundColor: '#ff0000' })
    })
  })

  describe('interactive=false (read-only / SearchResultRow)', () => {
    it('renders chips as <span>, not <button>', () => {
      const todo = makeTodo({
        id: 1,
        dueDate: new Date(2026, 3, 25),
        statusId: 5,
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
          status={inProgress}
          today={today}
          interactive={false}
        />,
      )
      // No <button> children inside the bar
      expect(container.querySelector('button')).toBeNull()
    })

    it('wraps the bar in `pointer-events: none` via barReadOnly', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
          interactive={false}
        />,
      )
      const bar = container.firstElementChild as HTMLElement
      expect(bar.tagName.toLowerCase()).toBe('span')
      expect(bar.className).toMatch(/barReadOnly/)
    })

    it('marks the wrapper aria-hidden when ariaHidden is true', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          today={today}
          interactive={false}
          ariaHidden
        />,
      )
      const bar = container.firstElementChild as HTMLElement
      expect(bar.getAttribute('aria-hidden')).toBe('true')
    })
  })

  describe('dateFormat / followupFlagOnly (MobileTaskRow)', () => {
    it('shows the due date as MM/DD and the follow-up as its flag only', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 5), nextFollowupAt: new Date(2026, 3, 25) })
      const { container } = render(
        <TaskPillBar todo={todo} people={[]} today={today} dateFormat="numeric" followupFlagOnly />,
      )
      expect(screen.getByLabelText('Edit due date')).toHaveTextContent('04/05')
      const followup = container.querySelector('[data-pill="followup"]') as HTMLElement
      expect(followup.textContent).toBe('')
      expect(followup).toHaveAccessibleName(/^Follow-up: /)
    })

    it('defaults to the short date and the labelled pill', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25), nextFollowupAt: new Date(2026, 3, 25) })
      const { container } = render(<TaskPillBar todo={todo} people={[]} today={today} />)
      expect(screen.getByLabelText('Edit due date')).toHaveTextContent('Apr 25')
      expect((container.querySelector('[data-pill="followup"]') as HTMLElement).textContent).not.toBe('')
    })
  })

  describe('showStatus={false} (MobileTaskRow)', () => {
    it('omits the status indicator when showStatus is false', () => {
      const todo = makeTodo({ id: 1, statusId: 5 })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          status={inProgress}
          today={today}
          showStatus={false}
        />,
      )
      expect(screen.queryByLabelText('Status: In Progress')).toBeNull()
    })
  })

  describe('store independence', () => {
    it('does not subscribe to assignment stores in the primitive itself', () => {
      // The primitive's import-graph contract: TaskPillBar must not import
      // any of the assignment stores. We assert this by reading the source
      // file content at module level. The actual hook check would need a
      // bundler / mock — so we verify with a direct import-source scan.
      // (This test keeps the perf invariant honest: any future change that
      // adds a store import inside TaskPillBar.tsx would fail here.)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fs = require('fs') as typeof import('fs')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const path = require('path') as typeof import('path')
      const file = fs.readFileSync(
        path.resolve(__dirname, '../../../components/shared/TaskPillBar.tsx'),
        'utf-8',
      )
      // Match only at-runtime references (calls / imports); what matters is
      // that the module never reads from any assignment store.
      expect(file).not.toMatch(/import .*usePersonStore/)
      expect(file).not.toMatch(/import .*useStatusStore/)
      expect(file).not.toMatch(/usePersonStore\(/)
      expect(file).not.toMatch(/useStatusStore\(/)
      expect(file).not.toMatch(/useAssignedPeopleMap/)
    })
  })
})

describe('<TaskPillPeople>', () => {
  it('renders nothing when people is empty', () => {
    const { container } = render(
      <TaskPillPeople people={[]} interactive={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("fills each avatar with the person's own color", () => {
    render(
      <TaskPillPeople
        people={[
          makePerson({ id: 1, name: 'Alice', initials: 'AL', color: '#ff0000' }),
          makePerson({ id: 2, name: 'Bob', initials: 'BO', color: '#0000ff' }),
        ]}
        interactive={false}
      />,
    )
    expect(screen.getByText('AL')).toHaveStyle({ backgroundColor: '#ff0000' })
    expect(screen.getByText('BO')).toHaveStyle({ backgroundColor: '#0000ff' })
  })

  it('falls back to NEUTRAL_PERSON_COLOR for a person without a color', () => {
    render(
      <TaskPillPeople
        people={[
          makePerson({ id: 1, name: 'Alice', initials: 'AL', color: '#ff0000' }),
          makePerson({ id: 2, name: 'Bob', initials: 'BO' }),
        ]}
        interactive={false}
      />,
    )
    expect(screen.getByText('BO')).toHaveStyle({ backgroundColor: NEUTRAL_PERSON_COLOR })
    expect(screen.getByText('AL')).not.toHaveStyle({ backgroundColor: NEUTRAL_PERSON_COLOR })
  })

  it('uses size=sm in compact mode', () => {
    const { container } = render(
      <TaskPillPeople
        people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
        interactive={false}
        compact
      />,
    )
    // The AvatarStack's stackSm class contains "stackSm" substring
    expect(container.querySelector('[class*="stackSm"]')).toBeInTheDocument()
  })

  it('uses size=sm when density=small', () => {
    const { container } = render(
      <TaskPillPeople
        people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
        interactive={false}
        density="small"
      />,
    )
    expect(container.querySelector('[class*="stackSm"]')).toBeInTheDocument()
  })
})

describe('<TaskPillDates>', () => {
  it('renders nothing when no due date is set', () => {
    const todo = makeTodo({ id: 1, nextFollowupAt: new Date(2026, 3, 20) })
    const { container } = render(
      <TaskPillDates todo={todo} today={today} interactive={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders the due date', () => {
    const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
    render(<TaskPillDates todo={todo} today={today} interactive={false} />)
    expect(screen.getByTitle('Due')).toBeInTheDocument()
  })
})

describe('<TaskPillStatus>', () => {
  it('renders the status name as title when interactive=false', () => {
    render(<TaskPillStatus status={inProgress} interactive={false} />)
    expect(screen.getByTitle('In Progress')).toBeInTheDocument()
  })

  it('renders the empty status dot when no status', () => {
    const { container } = render(<TaskPillStatus interactive={false} />)
    expect(container.querySelector('[class*="statusReadOnlyEmpty"]')).toBeInTheDocument()
  })
})
