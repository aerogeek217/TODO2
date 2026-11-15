// The folded queue's button (`ReviewQueueButton`, a Review widget under
// 820px): it says it opens a dialog (`aria-haspopup="dialog"`), and the
// popover it opens is one — `role="dialog"`, named as the queue (cr34 U11).
// Where the popover sits and the focus goes is the real browser's
// (`e2e/task-layout-a.spec.ts`).
import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ReviewQueueButton } from '../../../components/review/ReviewQueueButton'
import { ReviewSessionContext } from '../../../components/review/review-session-context'
import { AnchoredPicker } from '../../../components/shared/AnchoredPicker'
import { createReviewSession } from '../../../stores/review-session'
import { makeTodo } from '../../helpers'
import { useRef } from 'react'

afterEach(cleanup)

const TODOS = [makeTodo({ id: 1, title: 'Vendor contract renewal' }), makeTodo({ id: 2, title: 'Budget review' })]

function renderButton() {
  const session = createReviewSession({ ids: [1, 2], order: [1, 2] })
  render(
    <ReviewSessionContext.Provider value={session}>
      <ReviewQueueButton todoById={new Map(TODOS.map((t) => [t.id, t]))} followedUpToday={() => false} label="Review queue · Aisha" />
    </ReviewSessionContext.Provider>,
  )
  return screen.getByRole('button', { name: 'Queue' })
}

describe('the review’s Queue button', () => {
  it('opens a dialog named as the queue, holding the queue’s rows', () => {
    const button = renderButton()
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    const dialog = screen.getByRole('dialog', { name: 'Review queue · Aisha' })
    expect(dialog).toHaveAttribute('data-anchored-picker')
    expect(within(dialog).getByRole('navigation', { name: 'Review queue · Aisha' })).toBeInTheDocument()
    expect(dialog.querySelectorAll('[data-review-row]')).toHaveLength(2)

    fireEvent.click(button)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('AnchoredPicker', () => {
  function Picker({ dialogLabel }: { dialogLabel?: string }) {
    const ref = useRef<HTMLButtonElement>(null)
    return (
      <>
        <button ref={ref} type="button">Anchor</button>
        <AnchoredPicker anchorRef={ref} onClose={() => {}} dialogLabel={dialogLabel}><span>Body</span></AnchoredPicker>
      </>
    )
  }

  it('is a named dialog only when given a name; a picker whose content names itself has no role', () => {
    render(<Picker />)
    const plain = document.querySelector('[data-anchored-picker]')!
    expect(plain).not.toHaveAttribute('role')
    expect(plain).not.toHaveAttribute('aria-label')
    cleanup()
    render(<Picker dialogLabel="Queue" />)
    expect(screen.getByRole('dialog', { name: 'Queue' })).toHaveAttribute('data-anchored-picker')
  })
})
