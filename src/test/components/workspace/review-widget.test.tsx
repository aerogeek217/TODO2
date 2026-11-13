import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WidgetBody } from '../../../components/workspace/WidgetBody'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import { db } from '../../../data/database'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import type { FilterExpr, Person, Status, Tag } from '../../../models'
import type { ReviewTab } from '../../../models/workspace-layout'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { reviewWidgetSession } from '../../../stores/review-session'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import {
  REVIEW_MEDIUM_MAX_HEIGHT_PX,
  REVIEW_MEDIUM_MAX_WIDTH_PX,
  REVIEW_QUEUE_FOLD_PX,
  reviewFaceFor,
  reviewQueueFolds,
} from '../../../utils/widget-face'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'

/**
 * The Review widget as far as JSDOM shows it (item 12; widget feedback 2A,
 * board Review-field): no kind — one field that takes a filter expression,
 * temporary (the list widgets' store, never the layout); a click lists
 * people, tags and statuses with their open tasks, bare letters match all
 * three, picks join by `or` / `and`; a filter that doesn't read keeps the
 * last one that did; the check-in buttons while the filter names only
 * people; the live queue, its default Priority sort and a row's
 * double-click; the progress on the top line or the row's end; the faces.
 * Layout, focus and the popup's placement are the real browser's
 * (`e2e/review-widget.spec.ts`).
 */

const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
const legal: Tag = { id: 1, name: 'legal', color: '#7ec4bc' }
const q4: Tag = { id: 2, name: 'q4', color: '#c8743a' }
const waiting: Status = { id: 1, name: 'Waiting', color: '#4caf50', sortOrder: 1 }
const blocked: Status = { id: 2, name: 'Blocked', color: '#e06c75', sortOrder: 2 }

function reviewTab(over: Partial<ReviewTab> = {}): ReviewTab {
  return { id: 'rv', kind: 'review', config: {}, ...over }
}

const CONTROLS: CellControlsValue = {
  cellId: 'c', tabs: [], tabId: 'rv', title: 'Review', touch: false, setMoreButton: () => undefined, menuOpen: false,
  onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
}

let patchConfig: ReturnType<typeof vi.fn>
let patchView: ReturnType<typeof vi.fn>

const person = (id: number): FilterExpr => ({ kind: 'person', id })
const stored = () => useListWidgetStore.getState().reviewFilters.rv
const setFilter = (expression: FilterExpr | null) => act(() => {
  useListWidgetStore.getState().setReviewFilter('rv', expression ? { expression, showCompleted: false } : null)
})

beforeEach(() => {
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ lenses: [], activeLensId: null })
  useTodoStore.setState({
    todos: [
      makeTodo({ id: 1, title: 'Vendor contract renewal', sortOrder: 1, statusId: 1 }),
      makeTodo({ id: 2, title: 'Q4 headcount plan', sortOrder: 2, lastFollowupAt: new Date(), statusId: 2 }),
      makeTodo({ id: 3, title: 'Onboarding checklist', sortOrder: 3 }),
      makeTodo({ id: 4, title: 'Ben’s own', sortOrder: 4, statusId: 1 }),
      makeTodo({ id: 5, title: 'Done already', sortOrder: 5, isCompleted: true }),
      makeTodo({ id: 6, title: 'Nobody’s', sortOrder: 6 }),
    ],
  })
  usePersonStore.setState({
    people: [aisha, ben],
    assignedPeopleMap: new Map([[1, [aisha]], [2, [aisha]], [3, [aisha, ben]], [4, [ben]], [5, [aisha]]]),
  })
  useTagStore.setState({ tags: [legal, q4], assignedTagsMap: new Map([[1, [legal]], [2, [q4]], [4, [legal, q4]]]) })
  useStatusStore.setState({ statuses: [waiting, blocked] })
  patchConfig = vi.fn()
  patchView = vi.fn(() => Promise.resolve())
  useWorkspaceStore.setState({ patchTabConfig: patchConfig as never, patchTabViewState: patchView as never })
})

afterEach(() => {
  cleanup()
})

/** The widget in a cell of several widgets (no top line of its own), at `face`. */
function renderAt(face: WidgetFace, tab: ReviewTab = reviewTab()) {
  return render(
    <WidgetFaceContext.Provider value={{ forced: face }}>
      <WidgetBody tab={tab} />
    </WidgetFaceContext.Provider>,
  )
}

/** The widget alone in its cell (the cell lends its controls: the widget has its own top line), at `face`. */
function renderAlone(face: WidgetFace, tab: ReviewTab = reviewTab()) {
  return render(
    <DndContext>
      <CellControlsContext.Provider value={CONTROLS}>
        <WidgetFaceContext.Provider value={{ forced: face }}>
          <WidgetBody tab={tab} />
        </WidgetFaceContext.Provider>
      </CellControlsContext.Provider>
    </DndContext>,
  )
}

const field = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Review filter' })
const options = () => screen.getAllByRole('option').map((o) => o.textContent)
const rowIds = () => [...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))
const type = (text: string) => fireEvent.change(field(), { target: { value: text, selectionStart: text.length } })

describe('the Review widget: nothing to review', () => {
  it('the empty state in the board’s words; Pick focuses the field and lists who or what', () => {
    renderAt('medium')
    const empty = screen.getByTestId('review-empty')
    expect(empty).toHaveTextContent('Pick who or what to review')
    expect(empty).toHaveTextContent('Click the field, or type @person, #tag, !status or any filter. It is temporary and isn’t saved.')
    expect(field()).toHaveAttribute('placeholder', 'Who or what to review…')
    expect(screen.queryByTestId('lens-switch')).toBeNull()
    expect(screen.queryByTestId('review-widget-progress')).toBeNull()
    fireEvent.click(within(empty).getByRole('button', { name: 'Pick' }))
    expect(field()).toHaveFocus()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('no kind to choose: no Review by menu', () => {
    renderAt('medium')
    expect(screen.queryByTestId('review-by')).toBeNull()
    expect(screen.queryByRole('button', { name: /Review by/ })).toBeNull()
  })

  it('a tab an earlier build stored with a kind or a pick opens without error, nothing to review', () => {
    renderAt('medium', reviewTab({ config: { by: 'status', pick: { kind: 'tag', id: 1 } } as never }))
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick who or what to review')
    expect(stored()).toBeUndefined()
  })
})

describe('the Review widget: its field', () => {
  it('a click lists people, tags and statuses under their headings, each with its open tasks, the most counted first', () => {
    renderAt('medium')
    fireEvent.click(field())
    const list = screen.getByRole('listbox')
    expect(list).toHaveTextContent(/^People.*Tags.*Status/)
    expect(options()).toEqual(['AAisha3', 'BBen2', 'legal2', 'q42', 'Waiting2', 'Blocked1'])
  })

  it('a click on a row adds it; picks combine as chips do: a second person joins with or, a tag narrows both', () => {
    renderAt('large')
    fireEvent.click(field())
    fireEvent.mouseDown(screen.getByRole('option', { name: /Aisha/ }))
    expect(field()).toHaveValue('@Aisha ')
    expect(stored()).toEqual({ expression: person(1), showCompleted: false })
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.click(field())
    fireEvent.mouseDown(screen.getByRole('option', { name: /Ben/ }))
    expect(field()).toHaveValue('@Aisha or @Ben ')
    expect(stored()?.expression).toEqual({ kind: 'or', items: [person(1), person(2)] })
    expect(rowIds().sort()).toEqual(['1', '2', '3', '4'])
    // The third pick, a tag: (Aisha or Ben) and legal — not Aisha, or Ben's legal tasks (F1).
    fireEvent.click(field())
    fireEvent.mouseDown(screen.getByRole('option', { name: /legal/ }))
    expect(field()).toHaveValue('(@Aisha or @Ben) and #legal ')
    expect(stored()?.expression).toEqual({ kind: 'and', items: [{ kind: 'or', items: [person(1), person(2)] }, { kind: 'tag', id: 1 }] })
    expect(rowIds().sort()).toEqual(['1', '4'])
    // A second tag joins the first: (Aisha or Ben) and (legal or q4).
    fireEvent.click(field())
    fireEvent.mouseDown(screen.getByRole('option', { name: /q4/ }))
    expect(field()).toHaveValue('(@Aisha or @Ben) and (#legal or #q4) ')
    expect(rowIds().sort()).toEqual(['1', '2', '4'])
  })

  it('a review takes open tasks only: `done` and a Completed date are refused, saying so, and change nothing (F6)', () => {
    renderAt('large')
    setFilter(person(2))
    type('done')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByTestId('review-field-error')).toHaveTextContent('done has no say here')
    expect(stored()?.expression).toEqual(person(2))
    type('@Ben and completed this week')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByTestId('review-field-error')).toHaveTextContent('Leave completed out')
    expect(stored()?.expression).toEqual(person(2))
    expect(rowIds().sort()).toEqual(['3', '4'])
  })

  it('a filter that narrows by nothing (a jump from such a list): the field says Every open task, with its × (F12)', () => {
    renderAt('large')
    setFilter({ kind: 'and', items: [] })
    expect(field()).toHaveValue('')
    expect(screen.getByTestId('review-field-pills')).toHaveTextContent(/^Every open task$/)
    expect(field()).toHaveAccessibleDescription('Every open task')
    expect(rowIds().sort()).toEqual(['1', '2', '3', '4', '6'])
    // A focus and a blur keep it (the empty text is that filter's own).
    fireEvent.focus(field())
    expect(screen.queryByTestId('review-field-pills')).toBeNull()
    expect(field()).toHaveAttribute('placeholder', 'Who or what to review…')
    fireEvent.blur(field())
    expect(stored()?.expression).toEqual({ kind: 'and', items: [] })
    fireEvent.click(screen.getByRole('button', { name: 'Clear the filter' }))
    expect(stored()).toBeUndefined()
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick who or what to review')
    expect(screen.queryByRole('button', { name: 'Clear the filter' })).toBeNull()
  })

  it('bare letters match people, tags and statuses at once; ⏎ takes the first', () => {
    renderAt('medium')
    fireEvent.focus(field())
    type('b')
    expect(options()).toEqual(['BBen2', 'Blocked1'])
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(field()).toHaveValue('@Ben ')
    expect(stored()).toEqual({ expression: person(2), showCompleted: false })
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
  })

  it('a typed expression is written on ⏎; the queue follows it', () => {
    renderAt('large')
    fireEvent.focus(field())
    type('#legal or !Blocked')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(stored()?.expression).toEqual({ kind: 'or', items: [{ kind: 'tag', id: 1 }, { kind: 'status', id: 2 }] })
    expect(rowIds().sort()).toEqual(['1', '2', '4'])
  })

  it('a filter that doesn’t read: its error under the field, the queue keeps the last that read, Esc puts its text back', () => {
    renderAt('large')
    setFilter(person(2))
    expect(field()).toHaveValue('@Ben')
    type('@Ben and')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(screen.getByTestId('review-field-error')).toBeInTheDocument()
    expect(field()).toHaveAttribute('aria-invalid', 'true')
    expect(stored()?.expression).toEqual(person(2))
    expect(rowIds().sort()).toEqual(['3', '4'])
    fireEvent.keyDown(field(), { key: 'Escape' })
    expect(field()).toHaveValue('@Ben')
    expect(screen.queryByTestId('review-field-error')).toBeNull()
  })

  it('× clears the field and the filter', () => {
    renderAt('medium')
    setFilter(person(1))
    fireEvent.click(screen.getByRole('button', { name: 'Clear the filter' }))
    expect(field()).toHaveValue('')
    expect(stored()).toBeUndefined()
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick who or what to review')
  })

  it('the filter changing from elsewhere (a Review button’s jump) shows in the field', () => {
    renderAt('medium')
    setFilter({ kind: 'and', items: [person(1), { kind: 'status', id: 1 }] })
    expect(field()).toHaveValue('@Aisha and !Waiting')
  })

  it('the filter is temporary: nothing is written to the layout — no config, no view state', () => {
    renderAt('medium')
    fireEvent.click(field())
    fireEvent.mouseDown(screen.getByRole('option', { name: /Aisha/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear the filter' }))
    expect(patchConfig).not.toHaveBeenCalled()
    expect(patchView).not.toHaveBeenCalled()
  })

  it('reads no table: mounting, typing and picking stay in the stores', () => {
    const tables = [db.people, db.statuses, db.tags, db.todos, db.listDefinitions, db.layouts] as const
    const methods = ['toArray', 'where', 'get', 'count', 'each', 'bulkGet', 'orderBy'] as const
    const spies = tables.flatMap((t) => methods.map((m) => vi.spyOn(t as unknown as Record<string, () => unknown>, m)))
    renderAt('small')
    cleanup()
    renderAt('medium')
    fireEvent.focus(field())
    type('ai')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(stored()?.expression).toEqual(person(1))
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('the Review widget: the check-in buttons', () => {
  it('only while the filter names only people', () => {
    renderAt('large')
    expect(screen.queryByRole('button', { name: 'Check-in' })).toBeNull()
    setFilter(person(1))
    expect(screen.getByRole('button', { name: 'Check-in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paste reply' })).toBeInTheDocument()
    setFilter({ kind: 'or', items: [person(1), person(2)] })
    expect(screen.getByRole('button', { name: 'Check-in' })).toBeInTheDocument()
    setFilter({ kind: 'and', items: [person(1), { kind: 'tag', id: 1 }] })
    expect(screen.queryByRole('button', { name: 'Check-in' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Paste reply' })).toBeNull()
  })

  it('one person: Paste reply opens the reply import for them', () => {
    const openCheckinImport = vi.fn()
    useUIStore.setState({ openCheckinImport })
    renderAt('large')
    setFilter(person(2))
    fireEvent.click(screen.getByRole('button', { name: 'Paste reply' }))
    expect(openCheckinImport).toHaveBeenCalledWith({ personId: 2 })
  })

  it('one person: Check-in opens the check-in dialog for them; nothing is copied or sent', () => {
    const openCheckinDialog = vi.fn()
    useUIStore.setState({ openCheckinDialog })
    renderAt('large')
    setFilter(person(2))
    const button = screen.getByRole('button', { name: 'Check-in' })
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    fireEvent.click(button)
    expect(openCheckinDialog).toHaveBeenCalledWith([2])
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('several: Check-in opens the dialog for all of them (no menu), the first selected there; Paste reply opens the import (the reply names its person)', () => {
    const openCheckinDialog = vi.fn()
    const openCheckinImport = vi.fn()
    useUIStore.setState({ openCheckinDialog, openCheckinImport })
    renderAt('large')
    setFilter({ kind: 'or', items: [person(1), person(2)] })
    fireEvent.click(screen.getByRole('button', { name: 'Check-in' }))
    expect(openCheckinDialog).toHaveBeenCalledWith([1, 2])
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Paste reply' }))
    expect(openCheckinImport).toHaveBeenCalledWith(undefined)
  })
})

describe('the Review widget: the progress and its faces', () => {
  it('no place in the queue (`k of N`) at any face; once every task has a mark the large face says all reviewed', () => {
    const { unmount } = renderAt('medium')
    setFilter(person(1))
    expect(document.querySelector('[data-review-widget]')).not.toHaveTextContent(/\d+ of \d+/)
    unmount()
    renderAlone('large')
    expect(document.querySelector('[data-review-widget]')).not.toHaveTextContent(/\d+ of \d+/)
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent(/^All 3 reviewed · 1 followed up$/)
  })

  it('alone in its cell: a top line — Review, the progress, then the field’s row under it', () => {
    renderAlone('large')
    const top = document.querySelector<HTMLElement>('[data-widget-top-line]')!
    expect(within(top).getByTestId('top-line-name')).toHaveTextContent('Review')
    expect(screen.queryByTestId('review-widget-progress')).toBeNull()
    setFilter(person(1))
    expect(within(top).getByTestId('review-widget-progress')).toHaveTextContent(/^1 followed up$/)
    const row = document.querySelector<HTMLElement>('[data-prompt-row]')!
    expect(within(row).queryByTestId('review-widget-progress')).toBeNull()
    expect(top.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('in a cell of several widgets: no top line — the field’s row is first and ends with the progress', () => {
    renderAt('large')
    setFilter(person(1))
    expect(document.querySelector('[data-widget-top-line]')).toBeNull()
    const host = document.querySelector<HTMLElement>('[data-review-widget]')!
    const row = document.querySelector<HTMLElement>('[data-prompt-row]')!
    expect(host.firstElementChild).toBe(row)
    expect(within(row).getByTestId('review-widget-progress')).toHaveTextContent(/^1 followed up$/)
  })

  it('medium face: the first open task, how many are followed up and the update line', () => {
    renderAt('medium')
    setFilter(person(1))
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent(/^1 followed up$/)
    expect(screen.getByTestId('review-card-title')).toBeInTheDocument()
    expect(screen.getByLabelText('Status update · today')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open card/ })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-review-row]')).toHaveLength(0)
  })

  it('small face: `Review · Pick who or what` with no filter — no field; then the filter, how many are left and followed up', () => {
    renderAt('small')
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · Pick who or what')
    expect(screen.queryByTestId('review-small-caption')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    setFilter(person(1))
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · @Aisha')
    expect(screen.getByTestId('review-small-caption')).toHaveTextContent('2 left · 1 followed up')
    setFilter({ kind: 'or', items: [person(1), person(2)] })
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · @Aisha or @Ben')
    expect(screen.getByTestId('review-small-caption')).toHaveTextContent('3 left · 1 followed up')
  })

  it('large face: the rail, sorted by Priority unless the tab stores a sort, ✓ on a task followed up today', () => {
    renderAt('large')
    setFilter(person(1))
    const rail = screen.getByRole('navigation', { name: 'Review queue: @Aisha' })
    expect(rail.querySelectorAll('[data-review-row]')).toHaveLength(3)
    expect(rail.querySelector('[data-review-row="2"]')).toHaveAttribute('data-mark', 'done')
    expect(screen.getByTestId('review-sort')).toHaveTextContent('Sort: Priority')
    expect(patchView).not.toHaveBeenCalled()
  })

  it('a double-click on a rail row opens the task in its editor; a single click shows its card', () => {
    const openEditPopup = vi.fn()
    useUIStore.setState({ openEditPopup })
    renderAt('large')
    setFilter(person(1))
    const row = document.querySelector<HTMLElement>('[data-review-row="3"]')!
    fireEvent.click(row)
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
    expect(openEditPopup).not.toHaveBeenCalled()
    fireEvent.doubleClick(row)
    expect(openEditPopup).toHaveBeenCalledWith(3)
  })

  it('at rest each term of the filter is a pill with its own ×, which takes that term out', () => {
    renderAt('large')
    setFilter({ kind: 'and', items: [{ kind: 'or', items: [person(1), person(2)] }, { kind: 'not', item: { kind: 'priority', value: 'urgent' } }] })
    const pills = () => [...document.querySelectorAll('[data-review-pill]')].map((el) => el.getAttribute('data-review-pill'))
    expect(pills()).toEqual(['@Aisha', '@Ben', '/urgent'])
    expect(screen.getByTestId('review-field-pills').textContent).toBe('(@Aisha× or @Ben×) and not /urgent×')
    expect(document.querySelector('[data-review-pill="/urgent"]')).toHaveAttribute('data-tint', 'urgent')
    // The `not` goes with its term; a group left with one term loses its parentheses.
    fireEvent.click(screen.getByRole('button', { name: 'Remove /urgent' }))
    expect(useListWidgetStore.getState().reviewFilters.rv?.expression).toEqual({ kind: 'or', items: [person(1), person(2)] })
    fireEvent.click(screen.getByRole('button', { name: 'Remove @Aisha' }))
    expect(useListWidgetStore.getState().reviewFilters.rv?.expression).toEqual(person(2))
    expect(pills()).toEqual(['@Ben'])
    // Focused, the field is its text: no pills.
    fireEvent.focus(screen.getByRole('textbox', { name: 'Review filter' }))
    expect(pills()).toEqual([])
    fireEvent.blur(screen.getByRole('textbox', { name: 'Review filter' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove @Ben' }))
    expect(useListWidgetStore.getState().reviewFilters.rv).toBeUndefined()
  })

  it('a rail row’s box is a checkbox beside the row: it completes the task and doesn’t pick the row', () => {
    const toggleComplete = vi.fn(async () => {})
    useTodoStore.setState({ toggleComplete })
    renderAt('large')
    setFilter(person(1))
    const title = screen.getByTestId('review-card-title').textContent
    const box = screen.getByRole('checkbox', { name: 'Mark “Onboarding checklist” complete' })
    // Not inside the row's button (a button can't hold a checkbox).
    expect(box.closest('[data-review-row]')).toBeNull()
    expect(box.closest('li')?.querySelector('[data-review-row="3"]')).not.toBeNull()
    fireEvent.click(box)
    expect(toggleComplete).toHaveBeenCalledWith(3)
    expect(screen.getByTestId('review-card-title')).toHaveTextContent(title ?? '')
  })
})

describe('the Review widget: the queue and where it stands', () => {
  it('the live queue: a task leaving the filter leaves it; the current one stays until the review moves on', () => {
    renderAt('medium', reviewTab({ viewState: { sort: 'queue' } }))
    setFilter(person(1))
    const session = reviewWidgetSession('rv')
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    act(() => {
      usePersonStore.setState({ assignedPeopleMap: new Map([[1, [aisha]], [2, [ben]], [3, [ben]], [4, [ben]]]) })
    })
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    expect(session.getState().order).toEqual([1, 2])
    expect(session.getState().index).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(session.getState().order).toEqual([1])
  })

  it('the place and the – marks last as long as the filter: cleared, the next review starts over', () => {
    renderAt('large', reviewTab({ viewState: { sort: 'queue' } }))
    setFilter(person(1))
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(reviewWidgetSession('rv').getState().marks).toEqual({ 1: 'skipped' })
    setFilter(null)
    expect(reviewWidgetSession('rv').getState().marks).toEqual({})
    expect(reviewWidgetSession('rv').getState().order).toEqual([])
    setFilter(person(1))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(document.querySelector('[data-review-row="1"]')).not.toHaveAttribute('data-mark')
    expect(patchView).not.toHaveBeenCalled()
  })

  it('only the rail’s sort is view state, saved at once', () => {
    renderAt('large')
    setFilter(person(1))
    fireEvent.click(screen.getByTestId('review-sort'))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Sort the queue' })).getByRole('menuitemradio', { name: 'Title' }))
    expect(patchView).toHaveBeenCalledTimes(1)
    expect(patchView).toHaveBeenCalledWith('rv', 'review', { sort: 'title' })
  })

  it('opens with the stored sort; a place an earlier build saved is ignored', () => {
    renderAt('large', reviewTab({ viewState: { sort: 'title', currentId: 3, skipped: { day: '2000-01-01', ids: [1] } } as never }))
    setFilter(person(1))
    expect(screen.getByTestId('review-sort')).toHaveTextContent('Sort: Title')
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
    expect(document.querySelector('[data-review-row="1"]')).not.toHaveAttribute('data-mark')
    expect(patchView).not.toHaveBeenCalled()
  })

  it('a filter with no open tasks here says so', () => {
    usePersonStore.setState({ assignedPeopleMap: new Map() })
    renderAt('medium')
    setFilter({ kind: 'or', items: [person(1), person(2)] })
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Nothing to review: no open tasks match this filter here.')
  })
})

describe('reviewFaceFor', () => {
  it('small as every widget’s; medium while too narrow for the card’s two columns or too short for a scrolling card; else large', () => {
    expect(reviewFaceFor({ width: 0, height: 0 })).toBe('large')
    expect(reviewFaceFor({ width: 240, height: 72 })).toBe('small')
    expect(reviewFaceFor({ width: 480, height: 260 })).toBe('medium')
    expect(reviewFaceFor({ width: 1000, height: 300 })).toBe('medium')
    expect(reviewFaceFor({ width: 600, height: 800 })).toBe('medium')
    // A short cell keeps the large face: its queue and its card scroll.
    expect(reviewFaceFor({ width: 1000, height: 340 })).toBe('large')
    expect(reviewFaceFor({ width: 1000, height: 500 })).toBe('large')
    expect(reviewFaceFor({ width: 1000, height: REVIEW_MEDIUM_MAX_HEIGHT_PX })).toBe('medium')
    expect(reviewFaceFor({ width: 1000, height: REVIEW_MEDIUM_MAX_HEIGHT_PX + 1 })).toBe('large')
    expect(reviewFaceFor({ width: REVIEW_MEDIUM_MAX_WIDTH_PX, height: 800 })).toBe('medium')
    expect(reviewFaceFor({ width: REVIEW_MEDIUM_MAX_WIDTH_PX + 1, height: 800 })).toBe('large')
    expect([REVIEW_MEDIUM_MAX_HEIGHT_PX, REVIEW_MEDIUM_MAX_WIDTH_PX]).toEqual([320, 640])
  })
})

describe('reviewQueueFolds', () => {
  it('under 820px (the queue’s 220px beside the card’s 600px) the queue folds; unmeasured never', () => {
    expect(REVIEW_QUEUE_FOLD_PX).toBe(820)
    expect(reviewQueueFolds(0)).toBe(false)
    expect(reviewQueueFolds(700)).toBe(true)
    expect(reviewQueueFolds(819)).toBe(true)
    expect(reviewQueueFolds(820)).toBe(false)
    expect(reviewQueueFolds(1400)).toBe(false)
  })
})
