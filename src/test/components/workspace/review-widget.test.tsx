import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { WidgetBody } from '../../../components/workspace/WidgetBody'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { Person } from '../../../models'
import type { ReviewTab } from '../../../models/workspace-layout'
import { usePersonStore } from '../../../stores/person-store'
import { reviewWidgetSession } from '../../../stores/review-session'
import { useSettingsStore } from '../../../stores/settings-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { reviewFaceFor } from '../../../utils/widget-face'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * Item 12 · the Review widget as far as JSDOM shows it: nothing picked
 * (“Who do you want to review?”), the picker (segments, counts, search, ⏎),
 * the live queue (a task leaving the pick, the current one staying until
 * the review moves on), where it stands written as view state, and its
 * faces. Its large face's card is the deck's (`review-deck.test`); layout,
 * focus and the small face's popover are the real browser's
 * (`e2e/review-widget.spec.ts`).
 */

const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }

function reviewTab(over: Partial<ReviewTab> = {}): ReviewTab {
  return { id: 'rv', kind: 'review', config: { pick: { kind: 'person', id: 1 } }, ...over }
}

let patchConfig: ReturnType<typeof vi.fn>
let patchView: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ lenses: [], activeLensId: null })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Vendor contract renewal', sortOrder: 1 }),
      makeTodo({ id: 2, title: 'Q4 headcount plan', sortOrder: 2, lastFollowupAt: new Date() }),
      makeTodo({ id: 3, title: 'Onboarding checklist', sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Ben’s own', sortOrder: 4 }),
      makeTodo({ id: 5, title: 'Done already', sortOrder: 5, isCompleted: true }),
    ],
  })
  usePersonStore.setState({
    people: [aisha, ben],
    assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha]], [3, [aisha, ben]], [4, [ben]], [5, [aisha]]]),
  })
  patchConfig = vi.fn()
  patchView = vi.fn(() => Promise.resolve())
  useWorkspaceStore.setState({ patchTabConfig: patchConfig as never, patchTabViewState: patchView as never })
})

afterEach(() => {
  cleanup()
})

function renderAt(face: WidgetFace, tab: ReviewTab = reviewTab()) {
  return render(
    <WidgetFaceContext.Provider value={{ forced: face }}>
      <WidgetBody tab={tab} />
    </WidgetFaceContext.Provider>,
  )
}

describe('the Review widget', () => {
  it('nothing picked: “Who do you want to review?” and Pick someone… opening the picker', () => {
    renderAt('medium', reviewTab({ config: {} }))
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Who do you want to review?')
    expect(screen.getByTestId('review-pick')).toHaveTextContent('Pick…')
    expect(screen.queryByTestId('lens-switch')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pick someone…' }))
    expect(screen.getByRole('dialog', { name: 'What to review' })).toBeInTheDocument()
  })

  it('the picker: Person · Tag · Status · List, each person with their open tasks; a click picks (layout config)', () => {
    renderAt('medium', reviewTab({ config: {} }))
    fireEvent.click(screen.getByTestId('review-pick'))
    const picker = screen.getByRole('dialog', { name: 'What to review' })
    expect(within(picker).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Person', 'Tag', 'Status', 'List'])
    expect(within(picker).getAllByRole('option').map((o) => o.textContent)).toEqual(['AAisha3', 'BBen2'])
    fireEvent.click(within(picker).getByRole('option', { name: /Ben/ }))
    expect(patchConfig).toHaveBeenCalledWith('rv', 'review', { pick: { kind: 'person', id: 2 } })
    expect(screen.queryByRole('dialog', { name: 'What to review' })).toBeNull()
  })

  it('the picker’s search narrows the rows; ⏎ picks the first', () => {
    renderAt('medium', reviewTab({ config: {} }))
    fireEvent.click(screen.getByTestId('review-pick'))
    const search = screen.getByPlaceholderText('Search people…')
    fireEvent.change(search, { target: { value: 'be' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(patchConfig).toHaveBeenCalledWith('rv', 'review', { pick: { kind: 'person', id: 2 } })
  })

  it('medium face: the pick’s first open task, the progress and the update line', () => {
    renderAt('medium')
    expect(screen.getByTestId('review-pick')).toHaveTextContent('Aisha')
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('1 / 3')
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(screen.getByLabelText('Status update · today')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open card/ })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-review-row]')).toHaveLength(0)
  })

  it('small face: `Review · <pick>` and how many are left (✓ followed up today, item 11) and followed up', () => {
    renderAt('small')
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · Aisha')
    expect(screen.getByTestId('review-small-caption')).toHaveTextContent('2 left · 1 followed up')
  })

  it('large face: the rail, its rows as the deck’s, ✓ on a task followed up today', () => {
    renderAt('large')
    const rail = screen.getByRole('navigation', { name: 'Review queue: Aisha' })
    const rows = rail.querySelectorAll('[data-review-row]')
    expect([...rows].map((r) => r.getAttribute('aria-label')?.split(',')[0])).toEqual(['Vendor contract renewal', 'Q4 headcount plan', 'Onboarding checklist'])
    expect(rows[1]).toHaveAttribute('data-mark', 'done')
    expect(screen.getByTestId('review-sort')).toHaveTextContent('Sort: Queue order')
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('1 of 3 · 1 followed up')
  })

  it('the live queue: a task leaving the pick leaves it; the current one stays until the review moves on', () => {
    renderAt('medium')
    const session = reviewWidgetSession('rv')
    // Skip to Q4, then Q4 and the next task lose Aisha.
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    act(() => {
      usePersonStore.setState({ assignedPeopleMap: new Map([[1, [aisha]], [2, [ben]], [3, [ben]], [4, [ben]]]) })
    })
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    expect(session.getState().order).toEqual([1, 2])
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('2 / 2')
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(session.getState().order).toEqual([1])
  })

  it('where it stands is view state, saved at once: the current task, the sort, today’s skips', () => {
    renderAt('medium')
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(patchView).toHaveBeenLastCalledWith('rv', 'review', expect.objectContaining({
      sort: 'queue',
      currentId: 2,
      skipped: { day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ids: [1] },
    }))
  })

  it('opens on the stored task, with today’s skips; yesterday’s read as none', () => {
    renderAt('large', reviewTab({ viewState: { currentId: 3, skipped: { day: '2000-01-01', ids: [1] } } }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
    expect(document.querySelector('[data-review-row="1"]')).not.toHaveAttribute('data-mark')
  })

  it('a pick with no open tasks here says so', () => {
    usePersonStore.setState({ assignedPeopleMap: new Map() })
    renderAt('medium')
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Nothing to review: no open tasks for Aisha here.')
  })
})

describe('reviewFaceFor', () => {
  it('small as every widget’s; medium until the rail fits beside the whole card; else large', () => {
    expect(reviewFaceFor({ width: 0, height: 0 })).toBe('large')
    expect(reviewFaceFor({ width: 240, height: 72 })).toBe('small')
    expect(reviewFaceFor({ width: 480, height: 260 })).toBe('medium')
    expect(reviewFaceFor({ width: 1000, height: 300 })).toBe('medium')
    expect(reviewFaceFor({ width: 600, height: 800 })).toBe('medium')
    expect(reviewFaceFor({ width: 1000, height: 560 })).toBe('large')
  })
})
