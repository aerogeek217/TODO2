// The Review widget's medium face (`ReviewCompactCard`, board BM): the box
// and title, the facts line (the planned day after the priority), then the updates dock — the Status updates
// heading (always there; the count once there is an entry), the latest two
// entries oldest first, the update line. What gives way in a short cell is
// the real browser's (`e2e/reviewer-layout.spec.ts`).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ReviewCompactCard } from '../../../components/review/ReviewCard'
import { ReviewSessionContext } from '../../../components/review/review-session-context'
import type { PersistedStatusUpdate, PersistedTodoItem } from '../../../models'
import { useSettingsStore } from '../../../stores/settings-store'
import { createReviewSession } from '../../../stores/review-session'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { makeTodo } from '../../helpers'

afterEach(cleanup)

const todo = makeTodo({ id: 1, title: 'Vendor contract renewal' })

function entry(id: number, day: number, text: string): PersistedStatusUpdate {
  return { id, todoId: 1, date: new Date(2026, 10, day), text, createdAt: new Date(2026, 10, day, 9) }
}

function renderCard(entries: PersistedStatusUpdate[]) {
  // Newest first, as the store keeps them.
  useStatusUpdateStore.setState({ byTodo: new Map([[1, entries]]), loaded: true })
  const session = createReviewSession({ ids: [1], order: [1] })
  render(
    <ReviewSessionContext.Provider value={session}>
      <ReviewCompactCard todo={todo} />
    </ReviewSessionContext.Provider>,
  )
  return within(screen.getByRole('region', { name: /^Status updates/ }))
}

describe('the review card’s essentials (the widget’s medium face)', () => {
  it('three entries: the heading with the count, the latest two oldest first, then the update line', () => {
    const dock = renderCard([entry(3, 3, 'Sent redlines'), entry(2, 2, 'Budget confirmed'), entry(1, 1, 'Notice received')])
    expect(dock.getByRole('heading', { name: /Status updates/ })).toHaveTextContent('Status updates3')
    const lines = within(dock.getByRole('list', { name: 'Latest status updates' })).getAllByRole('listitem')
    expect(lines.map((li) => li.textContent)).toEqual(['11/02Budget confirmed', '11/03Sent redlines'])
    expect(lines[0]).not.toHaveAttribute('data-newest')
    expect(lines[1]).toHaveAttribute('data-newest', 'true')
    expect(screen.getByTestId('review-newest-update')).toBe(lines[1])
    // The update line comes after the log.
    const line = screen.getByLabelText('Status update · today')
    expect(lines[1]!.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByTestId('review-card-title')).toHaveValue('Vendor contract renewal')
  })

  it('one entry: just that one', () => {
    const dock = renderCard([entry(1, 1, 'Notice received')])
    expect(dock.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['11/01Notice received'])
    expect(dock.getByRole('heading')).toHaveTextContent('Status updates1')
  })

  it('the facts line names the planned day after the priority, with the hollow bar — in the deadline color past a real date', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 22, 9))
    useSettingsStore.setState({ rowDates: 'numeric' })
    try {
      const facts = (task: PersistedTodoItem) => {
        cleanup()
        useStatusUpdateStore.setState({ byTodo: new Map(), loaded: true })
        render(
          <ReviewSessionContext.Provider value={createReviewSession({ ids: [1], order: [1] })}>
            <ReviewCompactCard todo={task} />
          </ReviewSessionContext.Provider>,
        )
        return screen.getByTestId('review-facts')
      }
      const late = facts(makeTodo({ id: 1, title: 'Vendor', dueDate: new Date(2026, 10, 27), urgent: true, doDate: new Date(2026, 10, 28) }))
      expect(Array.from(late.children).map((c) => c.getAttribute('data-fact'))).toEqual(['due', 'priority', 'planned', 'last'])
      const planned = late.querySelector('[data-fact="planned"]')!
      expect(planned).toHaveTextContent('Planned 11/28')
      expect(planned).toHaveAttribute('data-tone', 'due')
      expect(planned.querySelector('[aria-hidden="true"]')).not.toBeNull()
      const onTime = facts(makeTodo({ id: 1, title: 'Vendor', dueDate: new Date(2026, 10, 27), doDate: new Date(2026, 10, 25) }))
      expect(onTime.querySelector('[data-fact="planned"]')).not.toHaveAttribute('data-tone')
      expect(facts(makeTodo({ id: 1, title: 'Vendor', unplanned: true })).querySelector('[data-fact="planned"]')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('no entries: the heading still shows, without a count or a list; the update line is there', () => {
    const dock = renderCard([])
    expect(dock.getByRole('heading')).toHaveTextContent(/^Status updates$/)
    expect(dock.queryByRole('list')).toBeNull()
    expect(screen.queryByTestId('review-newest-update')).toBeNull()
    expect(dock.getByLabelText('Status update · today')).toBeInTheDocument()
  })
})
