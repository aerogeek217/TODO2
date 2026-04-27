import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import {
  TaskPillBar,
  TaskPillPeople,
  TaskPillDates,
  TaskPillStatus,
} from '../../../components/shared/TaskPillBar'
import type { Status } from '../../../models'
import { makeTodo, makePerson, makeOrg } from '../../helpers'

const today = new Date(2026, 3, 16) // Apr 16, 2026 (Thursday)
const weekStartsOn = 1 as const

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
    it('renders people avatars + scheduled chip + deadline chip + status', () => {
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'fuzzy', token: 'today' },
        dueDate: new Date(2026, 3, 25),
        statusId: 5,
      })
      render(
        <TaskPillBar
          todo={todo}
          people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
          orgs={[makeOrg({ id: 9, name: 'Acme', initials: 'AC', color: '#ff0000' })]}
          status={inProgress}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      expect(screen.getByText('AL')).toBeInTheDocument()
      expect(screen.getByText('AC')).toBeInTheDocument()
      expect(screen.getByText('Today')).toBeInTheDocument()
      expect(screen.getByTitle('Deadline — click to change')).toBeInTheDocument()
      expect(screen.getByLabelText('Status: In Progress')).toBeInTheDocument()
    })

    it('renders nothing for the date block when there is no scheduled or deadline', () => {
      const todo = makeTodo({ id: 1 })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      expect(container.querySelector('[class*="scheduledChip"]')).toBeNull()
      expect(container.querySelector('[class*="deadlineChip"]')).toBeNull()
      expect(container.querySelector('[class*="dateStack"]')).toBeNull()
    })

    it('renders no people group when there are no people or orgs', () => {
      const todo = makeTodo({ id: 1 })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
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
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      expect(screen.getByLabelText('Set status')).toBeInTheDocument()
    })

    it('shows the × clear button on the deadline chip when onDeadlineClear is provided', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
          onDeadlineClear={() => undefined}
        />,
      )
      expect(screen.getByLabelText('Clear deadline')).toBeInTheDocument()
    })

    it('omits the × clear button when onDeadlineClear is not provided', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 25) })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      expect(screen.queryByLabelText('Clear deadline')).toBeNull()
    })

    it('fires the scheduled chip callback on click', () => {
      const onScheduledClick = vi.fn()
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'fuzzy', token: 'today' },
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
          onScheduledClick={onScheduledClick}
        />,
      )
      fireEvent.click(container.querySelector('[class*="scheduledChip"]')!)
      expect(onScheduledClick).toHaveBeenCalledTimes(1)
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
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      expect(container.querySelector('[class*="recurrenceIndicator"]')).toBeInTheDocument()
    })

    it('marks the scheduled chip past when scheduled date is before today', () => {
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'date', value: new Date(2026, 3, 10) },
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      const chip = container.querySelector('[class*="scheduledChip"]') as HTMLElement
      expect(chip.className).toMatch(/scheduledChipPast/)
    })

    it('marks the deadline chip past when due date is before today', () => {
      const todo = makeTodo({ id: 1, dueDate: new Date(2026, 3, 10) })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
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
        scheduledDate: { kind: 'fuzzy', token: 'today' },
        dueDate: new Date(2026, 3, 25),
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
          interactive={false}
          compact
        />,
      )
      // Markers — no scheduled-chip / deadline-chip class containers in compact
      expect(container.querySelector('[class*="markerScheduled"]')).toBeInTheDocument()
      expect(container.querySelector('[class*="markerDeadline"]')).toBeInTheDocument()
      expect(container.querySelector('[class*="scheduledChip"]')).toBeNull()
      expect(container.querySelector('[class*="deadlineChip"]')).toBeNull()
    })

    it('hides org avatars in compact mode', () => {
      const todo = makeTodo({ id: 1 })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
          orgs={[makeOrg({ id: 9, name: 'Acme', initials: 'AC', color: '#ff0000' })]}
          today={today}
          weekStartsOn={weekStartsOn}
          interactive={false}
          compact
        />,
      )
      expect(screen.getByText('AL')).toBeInTheDocument()
      expect(container.querySelector('[class*="avatarHollow"]')).toBeNull()
    })
  })

  describe('interactive=false (read-only / SearchResultRow)', () => {
    it('renders chips as <span>, not <button>', () => {
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'fuzzy', token: 'today' },
        dueDate: new Date(2026, 3, 25),
        statusId: 5,
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
          orgs={[]}
          status={inProgress}
          today={today}
          weekStartsOn={weekStartsOn}
          interactive={false}
        />,
      )
      // No <button> children inside the bar
      expect(container.querySelector('button')).toBeNull()
    })

    it('wraps the bar in `pointer-events: none` via barReadOnly', () => {
      const todo = makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
          interactive={false}
        />,
      )
      const bar = container.firstElementChild as HTMLElement
      expect(bar.tagName.toLowerCase()).toBe('span')
      expect(bar.className).toMatch(/barReadOnly/)
    })

    it('marks the wrapper aria-hidden when ariaHidden is true', () => {
      const todo = makeTodo({ id: 1, scheduledDate: { kind: 'fuzzy', token: 'today' } })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
          interactive={false}
          ariaHidden
        />,
      )
      const bar = container.firstElementChild as HTMLElement
      expect(bar.getAttribute('aria-hidden')).toBe('true')
    })
  })

  describe('dateLayout=stack (TaskRow)', () => {
    it('wraps scheduled+deadline in a vertical date-stack container', () => {
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'fuzzy', token: 'today' },
        dueDate: new Date(2026, 3, 25),
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
          dateLayout="stack"
        />,
      )
      expect(container.querySelector('[class*="dateStack"]')).toBeInTheDocument()
      expect(container.querySelector('[class*="dateStackSecondary"]')).toBeInTheDocument()
    })

    it('uses inline layout by default', () => {
      const todo = makeTodo({
        id: 1,
        scheduledDate: { kind: 'fuzzy', token: 'today' },
        dueDate: new Date(2026, 3, 25),
      })
      const { container } = render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          today={today}
          weekStartsOn={weekStartsOn}
        />,
      )
      expect(container.querySelector('[class*="dateInline"]')).toBeInTheDocument()
      expect(container.querySelector('[class*="dateStack"]')).toBeNull()
    })
  })

  describe('showStatus={false} (MobileTaskRow)', () => {
    it('omits the status indicator when showStatus is false', () => {
      const todo = makeTodo({ id: 1, statusId: 5 })
      render(
        <TaskPillBar
          todo={todo}
          people={[]}
          orgs={[]}
          status={inProgress}
          today={today}
          weekStartsOn={weekStartsOn}
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
      // Match only at-runtime references (calls / imports). Comments mentioning
      // `useOrgStore` for context are fine; what matters is that the module
      // never reads from any assignment store.
      expect(file).not.toMatch(/import .*usePersonStore/)
      expect(file).not.toMatch(/import .*useOrgStore/)
      expect(file).not.toMatch(/import .*useStatusStore/)
      expect(file).not.toMatch(/usePersonStore\(/)
      expect(file).not.toMatch(/useOrgStore\(/)
      expect(file).not.toMatch(/useStatusStore\(/)
      expect(file).not.toMatch(/useAssignedPeopleMap/)
    })
  })
})

describe('<TaskPillPeople>', () => {
  it('renders nothing when people and orgs are empty', () => {
    const { container } = render(
      <TaskPillPeople people={[]} orgs={[]} interactive={false} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('uses size=sm in compact mode', () => {
    const { container } = render(
      <TaskPillPeople
        people={[makePerson({ id: 1, name: 'Alice', initials: 'AL' })]}
        orgs={[]}
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
        orgs={[]}
        interactive={false}
        density="small"
      />,
    )
    expect(container.querySelector('[class*="stackSm"]')).toBeInTheDocument()
  })
})

describe('<TaskPillDates>', () => {
  it('renders nothing when neither scheduled nor deadline is set', () => {
    const todo = makeTodo({ id: 1 })
    const { container } = render(
      <TaskPillDates todo={todo} today={today} weekStartsOn={weekStartsOn} interactive={false} />,
    )
    expect(container.firstChild).toBeNull()
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
