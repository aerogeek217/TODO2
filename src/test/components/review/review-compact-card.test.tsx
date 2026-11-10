// The Review widget's medium face (`ReviewCompactCard`, board BM): the box
// and title, the facts line, then the updates dock — the Status updates
// heading (always there; the count once there is an entry), the latest two
// entries oldest first, the update line. What gives way in a short cell is
// the real browser's (`e2e/reviewer-layout.spec.ts`).
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { ReviewCompactCard } from '../../../components/review/ReviewCard'
import { ReviewSessionContext } from '../../../components/review/review-session-context'
import type { PersistedStatusUpdate } from '../../../models'
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
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
  })

  it('one entry: just that one', () => {
    const dock = renderCard([entry(1, 1, 'Notice received')])
    expect(dock.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['11/01Notice received'])
    expect(dock.getByRole('heading')).toHaveTextContent('Status updates1')
  })

  it('no entries: the heading still shows, without a count or a list; the update line is there', () => {
    const dock = renderCard([])
    expect(dock.getByRole('heading')).toHaveTextContent(/^Status updates$/)
    expect(dock.queryByRole('list')).toBeNull()
    expect(screen.queryByTestId('review-newest-update')).toBeNull()
    expect(dock.getByLabelText('Status update · today')).toBeInTheDocument()
  })
})
