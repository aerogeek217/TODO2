// The review card's title, edited in place as the task editor's (`ReviewTitleField`),
// and the card's ⋯ — the editor header's task actions.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewCard, ReviewCompactCard } from '../../../components/review/ReviewCard'
import { ReviewSessionContext } from '../../../components/review/review-session-context'
import { createReviewSession } from '../../../stores/review-session'
import { useStatusUpdateStore } from '../../../stores/status-update-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { makeTodo } from '../../helpers'

afterEach(cleanup)

const todo = makeTodo({ id: 1, title: 'Vendor contract renewal', createdAt: new Date(2026, 10, 2) })

function renderCard(compact = false) {
  useStatusUpdateStore.setState({ byTodo: new Map(), loaded: true })
  useTodoStore.setState({ todos: [todo] })
  const update = vi.fn(async () => true)
  useTodoStore.setState({ update })
  const session = createReviewSession({ ids: [1], order: [1] })
  const outer = vi.fn()
  render(
    <div onKeyDown={outer}>
      <ReviewSessionContext.Provider value={session}>
        {compact ? <ReviewCompactCard todo={todo} /> : <ReviewCard todo={todo} />}
      </ReviewSessionContext.Provider>
    </div>,
  )
  return { update, outer, title: screen.getByRole('textbox', { name: 'Task title' }) }
}

describe('the review card’s title', () => {
  it('is a field: ⏎ writes the new title, trimmed — one write', async () => {
    const { update, title } = renderCard()
    title.focus()
    fireEvent.change(title, { target: { value: '  Vendor contract renewal 2027  ' } })
    fireEvent.keyDown(title, { key: 'Enter' })
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { title: 'Vendor contract renewal 2027' }))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('a blur writes it too; a blank or unchanged title writes nothing and shows the stored one', async () => {
    const { update, title } = renderCard()
    title.focus()
    fireEvent.change(title, { target: { value: '   ' } })
    fireEvent.blur(title)
    expect(title).toHaveValue('Vendor contract renewal')
    title.focus()
    fireEvent.change(title, { target: { value: 'Renewal' } })
    fireEvent.blur(title)
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { title: 'Renewal' }))
    expect(update).toHaveBeenCalledTimes(1)
  })

  it('Esc puts the stored title back, writes nothing and goes no further (the popup around stays open)', async () => {
    const { update, outer, title } = renderCard()
    title.focus()
    fireEvent.change(title, { target: { value: 'Oops' } })
    fireEvent.keyDown(title, { key: 'Escape' })
    expect(title).toHaveValue('Vendor contract renewal')
    expect(outer).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 0))
    expect(update).not.toHaveBeenCalled()
  })

  it('a newline typed or pasted is a space (the large face’s field wraps)', () => {
    const { title } = renderCard()
    fireEvent.change(title, { target: { value: 'Two\nlines' } })
    expect(title).toHaveValue('Two lines')
    expect(title.tagName).toBe('TEXTAREA')
  })

  it('the medium face’s title is a one-line field that writes as well', async () => {
    const { update, title } = renderCard(true)
    expect(title.tagName).toBe('INPUT')
    title.focus()
    fireEvent.change(title, { target: { value: 'Renewal' } })
    fireEvent.keyDown(title, { key: 'Enter' })
    await waitFor(() => expect(update).toHaveBeenCalledWith(1, { title: 'Renewal' }))
  })
})

describe('the review card’s header', () => {
  it('shows when the task was created and modified', () => {
    renderCard()
    expect(document.querySelector('[data-task-meta]')).toHaveTextContent(/^Created .* · Modified /)
  })

  it('its ⋯ offers the editor’s task actions; Delete asks as the editor’s does', async () => {
    const showBulkConfirmation = vi.spyOn(useUIStore.getState(), 'showBulkConfirmation').mockImplementation(() => {})
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const items = screen.getAllByRole('menuitem').map((m) => m.textContent)
    expect(items).toEqual(['Open in editor', 'Duplicate', 'Make subtask of…', 'Delete'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    await waitFor(() => expect(showBulkConfirmation).toHaveBeenCalledWith('delete', [1]))
  })
})
