import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { DndContext } from '@dnd-kit/core'
import { WidgetBody } from '../../../components/workspace/WidgetBody'
import { CellControlsContext, type CellControlsValue } from '../../../components/workspace/cell-controls'
import { db } from '../../../data/database'
import { WidgetFaceContext } from '../../../hooks/use-widget-face'
import { emptyPredicate, type Person, type Status, type Tag } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { ReviewBy } from '../../../models/review'
import type { PersistedWorkspaceLayout, ReviewTab } from '../../../models/workspace-layout'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListOrderStore } from '../../../stores/list-order-store'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { usePersonStore } from '../../../stores/person-store'
import { reviewWidgetSession } from '../../../stores/review-session'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import type { WidgetFace } from '../../../utils/widget-face'
import { reviewFaceFor } from '../../../utils/widget-face'
import { clearFilterStore, makeTodo, resetEntityStores } from '../../helpers'
import { single } from '../../helpers/layout-builders'

/**
 * Item 12 · the Review widget as far as JSDOM shows it (board BM): its
 * prompt row — the kind as the row's label, a menu that writes the layout
 * config; the field typed in, its picks temporary (the list widgets' store,
 * never the layout) and OR-combined —, the empty state in the kind's words,
 * the live queue (a task leaving the picks, the current one staying until
 * the review moves on), the place and – marks lasting as long as the picks,
 * the progress on the top line (alone in its cell) or at the prompt row's
 * end (a cell of several widgets), and its faces. Its large face's card is
 * the deck's (`review-deck.test`); layout, focus and the small face's
 * popover are the real browser's (`e2e/review-widget.spec.ts`).
 */

const aisha: Person = { id: 1, name: 'Aisha', initials: 'A' }
const ben: Person = { id: 2, name: 'Ben', initials: 'B' }
const legal: Tag = { id: 1, name: 'legal', color: '#7ec4bc' }
const q4: Tag = { id: 2, name: 'q4', color: '#c8743a' }
const waiting: Status = { id: 1, name: 'Waiting', color: '#4caf50', sortOrder: 1 }
const blocked: Status = { id: 2, name: 'Blocked', color: '#e06c75', sortOrder: 2 }

function listDef(id: number, name: string, over: Partial<PersistedListDefinition> = {}, predicate: Partial<ReturnType<typeof emptyPredicate>> = {}): PersistedListDefinition {
  return {
    id, name, sortOrder: id,
    membership: { kind: 'custom', predicate: { ...emptyPredicate(), ...predicate } },
    sort: 'manual', grouping: 'none',
    owner: { layoutId: 1 },
    ...over,
  }
}

function reviewTab(by: ReviewBy = 'person', over: Partial<ReviewTab> = {}): ReviewTab {
  return { id: 'rv', kind: 'review', config: { by }, ...over }
}

const CONTROLS: CellControlsValue = {
  cellId: 'c', tabs: [], tabId: 'rv', title: 'Review', touch: false, setMoreButton: () => undefined, menuOpen: false,
  onMore: () => {}, collapsed: false, onExpand: () => {}, claim: () => () => {},
}

let patchConfig: ReturnType<typeof vi.fn>
let patchView: ReturnType<typeof vi.fn>

const picks = () => useListWidgetStore.getState().picks.rv
const setPicks = (...ids: number[]) => act(() => { useListWidgetStore.getState().setPicks('rv', ids) })

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
  useListOrderStore.setState({ ranks: new Map(), loaded: true })
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

const field = () => screen.getByRole('combobox', { name: / to review$/ })
const options = () => screen.getAllByRole('option').map((o) => o.textContent)

describe('the Review widget: nothing picked', () => {
  it.each([
    ['person', 'Pick a person to review', 'Type in the Person field above. The pick is temporary and isn’t saved.', 'Pick a person', 'Pick a person…'],
    ['tag', 'Pick a tag to review', 'Type in the Tag field above. The pick is temporary and isn’t saved.', 'Pick a tag', 'Pick a tag…'],
    ['status', 'Pick a status to review', 'Type in the Status field above. The pick is temporary and isn’t saved.', 'Pick a status', 'Pick a status…'],
    ['list', 'Pick a list to review', 'Type in the List field above. The pick is temporary and isn’t saved.', 'Pick a list', 'Pick a list…'],
  ] as const)('by %s: “%s”, the field’s words, a button that focuses the field', (by, title, text, action, placeholder) => {
    renderAt('medium', reviewTab(by))
    const empty = screen.getByTestId('review-empty')
    expect(empty).toHaveTextContent(title)
    expect(empty).toHaveTextContent(text)
    expect(field()).toHaveAttribute('placeholder', placeholder)
    expect(screen.queryByText(/pick someone/i)).toBeNull()
    expect(screen.queryByTestId('lens-switch')).toBeNull()
    expect(screen.queryByTestId('review-widget-progress')).toBeNull()
    fireEvent.click(within(empty).getByRole('button', { name: action }))
    expect(field()).toHaveFocus()
  })

  it('a config an earlier build stored (one saved pick) reads as that pick’s kind, nothing picked', () => {
    renderAt('medium', reviewTab('person', { config: { pick: { kind: 'status', id: 1 } } as never }))
    expect(screen.getByTestId('review-by')).toHaveTextContent('Status')
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick a status to review')
    expect(picks()).toBeUndefined()
  })
})

describe('the Review widget: its field', () => {
  it('people, each with their avatar and open tasks; typing narrows them; ⏎ picks the first', () => {
    renderAt('medium')
    fireEvent.focus(field())
    expect(options()).toEqual(['AAisha3', 'BBen2'])
    fireEvent.change(field(), { target: { value: 'be' } })
    expect(options()).toEqual(['BBen2'])
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(picks()).toEqual([2])
    expect(field()).toHaveValue('')
    // Its chip, with the avatar and a ×.
    expect(screen.getByRole('button', { name: 'Remove Ben' })).toBeInTheDocument()
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
  })

  it('the picks are temporary: nothing is written to the layout — no config, no view state', () => {
    renderAt('medium')
    fireEvent.focus(field())
    fireEvent.click(screen.getByRole('option', { name: /Aisha/ }))
    fireEvent.click(screen.getByRole('option', { name: /Ben/ }))
    expect(picks()).toEqual([1, 2])
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Aisha' }))
    expect(picks()).toEqual([2])
    expect(patchConfig).not.toHaveBeenCalled()
    expect(patchView).not.toHaveBeenCalled()
  })

  it('several picks are any of them: Aisha or Ben — each task once', () => {
    renderAt('large')
    setPicks(1)
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('1 of 3 · 1 followed up')
    setPicks(1, 2)
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('1 of 4 · 1 followed up')
    const rail = screen.getByRole('navigation', { name: 'Review queue: Aisha or Ben' })
    expect([...rail.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['1', '2', '3', '4'])
  })

  it('Backspace in the empty text takes the last chip back; the × at the field’s end clears them all', () => {
    renderAt('medium')
    setPicks(1, 2)
    fireEvent.keyDown(field(), { key: 'Backspace' })
    expect(picks()).toEqual([1])
    fireEvent.click(screen.getByRole('button', { name: 'Clear Person' }))
    expect(picks()).toBeUndefined()
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick a person to review')
  })

  it('tags with their open tasks; a pick’s tasks are any picked tag’s', () => {
    renderAt('large', reviewTab('tag'))
    fireEvent.focus(field())
    expect(options()).toEqual(['legal2', 'q42'])
    setPicks(1, 2)
    expect(screen.getByRole('navigation', { name: 'Review queue: #legal or #q4' })).toBeInTheDocument()
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['1', '2', '4'])
  })

  it('statuses in their own order, with their open tasks', () => {
    renderAt('large', reviewTab('status'))
    fireEvent.focus(field())
    expect(options()).toEqual(['Waiting2', 'Blocked1'])
    setPicks(2, 1)
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['1', '2', '4'])
  })

  it('lists: this layout’s lists (no count); several picked are the union of what they show, divided by list', () => {
    const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [reviewTab('list')] }) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
    useListDefinitionStore.setState({
      listDefinitions: [
        listDef(11, 'Aisha 1:1', {}, { personIds: [1] }),
        listDef(12, 'Waiting', {}, { statusIds: [1] }),
        listDef(13, 'Another layout’s', { owner: { layoutId: 2 } }),
      ],
    })
    renderAt('large', reviewTab('list'))
    fireEvent.focus(field())
    expect(options()).toEqual(['Aisha 1:1', 'Waiting'])
    setPicks(11)
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['1', '2', '3'])
    setPicks(11, 12)
    // Aisha 1:1's three, then Waiting's that aren't among them (task 1 is: once).
    expect(screen.getByRole('navigation', { name: 'Review queue: Aisha 1:1 or Waiting' })).toBeInTheDocument()
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['1', '2', '3', '4'])
    expect(patchConfig).not.toHaveBeenCalled()
    // A picked list that is deleted just drops from the picks.
    act(() => { useListDefinitionStore.setState({ listDefinitions: useListDefinitionStore.getState().listDefinitions.filter((d) => d.id !== 11) }) })
    expect(screen.queryByRole('button', { name: 'Remove Aisha 1:1' })).toBeNull()
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['1', '4'])
  })

  it('a pick that names no one any more drops out: back to the prompt', () => {
    renderAt('medium')
    setPicks(2)
    expect(screen.getByTestId('review-card-title')).toBeInTheDocument()
    act(() => { usePersonStore.setState({ people: [aisha] }) })
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick a person to review')
  })

  it('reads no table: mounting, typing and picking stay in the stores', () => {
    const tables = [db.people, db.statuses, db.tags, db.todos, db.listDefinitions, db.layouts] as const
    const methods = ['toArray', 'where', 'get', 'count', 'each', 'bulkGet', 'orderBy'] as const
    const spies = tables.flatMap((t) => methods.map((m) => vi.spyOn(t as unknown as Record<string, () => unknown>, m)))
    renderAt('small')
    cleanup()
    renderAt('medium')
    fireEvent.focus(field())
    fireEvent.change(field(), { target: { value: 'a' } })
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(picks()).toEqual([1])
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })
})

describe('the Review widget: its kind', () => {
  it('the row’s label is a menu — Review by: Person ✓ · Tag · Status · List; a pick writes the layout config and clears the picks', () => {
    renderAt('medium')
    setPicks(1)
    fireEvent.click(screen.getByTestId('review-by'))
    const menu = screen.getByRole('menu', { name: 'Review by' })
    expect(menu).toHaveTextContent('Review by')
    const items = within(menu).getAllByRole('menuitemradio')
    expect(items.map((i) => i.textContent)).toEqual(['Person', 'Tag', 'Status', 'List'])
    expect(items.map((i) => i.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false', 'false'])
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Tag' }))
    expect(patchConfig).toHaveBeenCalledWith('rv', 'review', { by: 'tag' })
    expect(picks()).toBeUndefined()
  })

  it('a kind that changes under the picks some other way (the layout’s unsaved kind discarded) takes them along', () => {
    const view = renderAt('medium')
    setPicks(1)
    expect(screen.getByTestId('review-card-title')).toBeInTheDocument()
    view.rerender(
      <WidgetFaceContext.Provider value={{ forced: 'medium' }}>
        <WidgetBody tab={reviewTab('tag')} />
      </WidgetFaceContext.Provider>,
    )
    expect(picks()).toBeUndefined()
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Pick a tag to review')
  })

  it('the kind it already has changes nothing: the picks stay, the layout is not touched', () => {
    renderAt('medium')
    setPicks(1)
    fireEvent.click(screen.getByTestId('review-by'))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Review by' })).getByRole('menuitemradio', { name: 'Person' }))
    expect(patchConfig).not.toHaveBeenCalled()
    expect(picks()).toEqual([1])
  })
})

describe('the Review widget: the progress and its faces', () => {
  it('alone in its cell: a top line — Review, the progress, then the prompt row under it', () => {
    renderAlone('large')
    const top = document.querySelector<HTMLElement>('[data-widget-top-line]')!
    expect(within(top).getByTestId('top-line-name')).toHaveTextContent('Review')
    // Nothing picked: no progress.
    expect(screen.queryByTestId('review-widget-progress')).toBeNull()
    setPicks(1)
    expect(within(top).getByTestId('review-widget-progress')).toHaveTextContent('1 of 3 · 1 followed up')
    const row = document.querySelector<HTMLElement>('[data-prompt-row]')!
    expect(within(row).queryByTestId('review-widget-progress')).toBeNull()
    expect(top.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('in a cell of several widgets: no top line — the prompt row is first and ends with the progress', () => {
    renderAt('large')
    setPicks(1)
    expect(document.querySelector('[data-widget-top-line]')).toBeNull()
    const host = document.querySelector<HTMLElement>('[data-review-widget]')!
    const row = document.querySelector<HTMLElement>('[data-prompt-row]')!
    expect(host.firstElementChild).toBe(row)
    expect(row.lastElementChild).toBe(within(row).getByTestId('review-widget-progress'))
    expect(within(row).getByTestId('review-widget-progress')).toHaveTextContent('1 of 3 · 1 followed up')
  })

  it('medium face: the picks’ first open task, the progress and the update line', () => {
    renderAt('medium')
    setPicks(1)
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('1 of 3')
    expect(screen.getByTestId('review-widget-progress')).not.toHaveTextContent('followed up')
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(screen.getByLabelText('Status update · today')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Open card/ })).toBeInTheDocument()
    expect(document.querySelectorAll('[data-review-row]')).toHaveLength(0)
  })

  it('small face: `Review · Pick a person` with nothing picked — no field; then the picks, how many are left (✓ followed up today, item 11) and followed up', () => {
    renderAt('small')
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · Pick a person')
    expect(screen.queryByTestId('review-small-caption')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    setPicks(1)
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · Aisha')
    expect(screen.getByTestId('review-small-caption')).toHaveTextContent('2 left · 1 followed up')
    setPicks(1, 2)
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · Aisha or Ben')
    expect(screen.getByTestId('review-small-caption')).toHaveTextContent('3 left · 1 followed up')
  })

  it('small face, by tag: `Review · Pick a tag`', () => {
    renderAt('small', reviewTab('tag'))
    expect(screen.getByTestId('review-small-face')).toHaveTextContent('Review · Pick a tag')
  })

  it('large face: the rail, its rows as the deck’s, ✓ on a task followed up today', () => {
    renderAt('large')
    setPicks(1)
    const rail = screen.getByRole('navigation', { name: 'Review queue: Aisha' })
    const rows = rail.querySelectorAll('[data-review-row]')
    expect([...rows].map((r) => r.getAttribute('aria-label')?.split(',')[0])).toEqual(['Vendor contract renewal', 'Q4 headcount plan', 'Onboarding checklist'])
    expect(rows[1]).toHaveAttribute('data-mark', 'done')
    expect(screen.getByTestId('review-sort')).toHaveTextContent('Sort: Queue order')
  })
})

describe('the Review widget: the queue and where it stands', () => {
  it('the live queue: a task leaving the picks leaves it; the current one stays until the review moves on', () => {
    renderAt('medium')
    setPicks(1)
    const session = reviewWidgetSession('rv')
    // Skip to Q4, then Q4 and the next task lose Aisha.
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    act(() => {
      usePersonStore.setState({ assignedPeopleMap: new Map([[1, [aisha]], [2, [ben]], [3, [ben]], [4, [ben]]]) })
    })
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    expect(session.getState().order).toEqual([1, 2])
    expect(screen.getByTestId('review-widget-progress')).toHaveTextContent('2 of 2')
    fireEvent.click(screen.getByRole('button', { name: /^Back/ }))
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(session.getState().order).toEqual([1])
  })

  it('a pick added keeps the place and the – marks; a current task whose pick is removed gives way to the next', () => {
    renderAt('large')
    setPicks(1)
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    setPicks(1, 2)
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Q4 headcount plan')
    expect(document.querySelector('[data-review-row="1"]')).toHaveAttribute('data-mark', 'skipped')
    // Aisha removed while on her task: Ben's tasks are the queue, the review on the first of them after it.
    setPicks(2)
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['3', '4'])
  })

  it('the place and the – marks last as long as the picks: cleared, the next review starts over', () => {
    renderAt('large')
    setPicks(1)
    fireEvent.click(screen.getByRole('button', { name: /^Skip/ }))
    expect(reviewWidgetSession('rv').getState().marks).toEqual({ 1: 'skipped' })
    setPicks()
    expect(reviewWidgetSession('rv').getState().marks).toEqual({})
    expect(reviewWidgetSession('rv').getState().order).toEqual([])
    setPicks(1)
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Vendor contract renewal')
    expect(document.querySelector('[data-review-row="1"]')).not.toHaveAttribute('data-mark')
    // None of it was ever view state.
    expect(patchView).not.toHaveBeenCalled()
  })

  it('only the rail’s sort is view state, saved at once', () => {
    renderAt('large')
    setPicks(1)
    fireEvent.click(screen.getByTestId('review-sort'))
    fireEvent.click(within(screen.getByRole('menu', { name: 'Sort the queue' })).getByRole('menuitemradio', { name: 'Title' }))
    expect(patchView).toHaveBeenCalledTimes(1)
    expect(patchView).toHaveBeenCalledWith('rv', 'review', { sort: 'title' })
  })

  it('opens with the stored sort; a place an earlier build saved is ignored', () => {
    renderAt('large', reviewTab('person', { viewState: { sort: 'title', currentId: 3, skipped: { day: '2000-01-01', ids: [1] } } as never }))
    setPicks(1)
    expect(screen.getByTestId('review-sort')).toHaveTextContent('Sort: Title')
    // Title order: Onboarding, Q4, Vendor — on the first, not the stored task; no mark.
    expect(screen.getByTestId('review-card-title')).toHaveTextContent('Onboarding checklist')
    expect(document.querySelector('[data-review-row="1"]')).not.toHaveAttribute('data-mark')
    expect(patchView).not.toHaveBeenCalled()
  })

  it('picks with no open tasks here say so', () => {
    usePersonStore.setState({ assignedPeopleMap: new Map() })
    renderAt('medium')
    setPicks(1, 2)
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Nothing to review: no open tasks for Aisha or Ben here.')
  })

  it('a picked list that asks for a pick waits for it: the pick of a list tab of this layout showing it', () => {
    const lensTab = { id: 'lt', kind: 'lens' as const, config: { listDefinitionId: 21 } }
    const layout: PersistedWorkspaceLayout = { id: 1, sortOrder: 0, name: 'L', createdAt: new Date(), modifiedAt: new Date(), ...single({ id: 'c', tabs: [reviewTab('list'), lensTab] }) }
    useWorkspaceStore.setState({ working: layout, saved: layout, layouts: [layout] })
    useListDefinitionStore.setState({ listDefinitions: [listDef(21, 'Tasks for…', { runtimeFilter: { field: 'person' } })] })
    renderAt('large', reviewTab('list'))
    setPicks(21)
    expect(screen.getByTestId('review-empty')).toHaveTextContent('Tasks for… asks for a pick first: answer it in a list widget showing it.')
    // Answered in the list tab (Ben): the review takes what that tab shows.
    act(() => { useListWidgetStore.getState().setPicks('lt', [2]) })
    expect([...document.querySelectorAll('[data-review-row]')].map((r) => r.getAttribute('data-review-row'))).toEqual(['3', '4'])
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
