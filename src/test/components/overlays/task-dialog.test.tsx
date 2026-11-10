import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent, within } from '@testing-library/react'
import { TaskDialog } from '../../../components/overlays/TaskDialog'
import { currentTaskDialogEnv, personTaskDialog, resolveTaskDialog, screenTaskDialog } from '../../../services/task-dialog'
import { useFilterStore } from '../../../stores/filter-store'
import type { TaskDialogPayload } from '../../../stores/task-dialog-payload'
import { usePersonStore } from '../../../stores/person-store'
import { useReviewStore } from '../../../stores/review-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useUndoStore } from '../../../stores/undo-store'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, PRIYA, SAMPLE_TASKS, STATUSES, TAGS,
} from '../../fixtures/glance-sample'

const HOT: TaskDialogPayload = {
  title: 'Hot tasks',
  glyph: 'urgent',
  description: 'Hot = urgent and important, or in Focus (Settings › Tasks).',
  source: { kind: 'todos', todoIds: [1, 2, 3, 4] },
}


const dialog = () => document.querySelector<HTMLElement>('[data-task-dialog]')
const rowTitles = () => Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-todo-id]'))
  .map((r) => SAMPLE_TASKS.find((t) => t.id === Number(r.dataset.todoId))?.title)
const row = (id: number) => dialog()!.querySelector<HTMLElement>(`[data-todo-id="${id}"]`)!

function open(payload: TaskDialogPayload) {
  render(<TaskDialog />)
  act(() => useUIStore.getState().showTaskDialog(payload))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 9, 10, 10))
  resetEntityStores()
  clearFilterStore()
  useSettingsStore.setState({ urgentDueWithinDays: 3, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  // Loaded as the store loads them: an entry for every task, empty when nobody is on it.
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: new Map(SAMPLE_TASKS.map((t) => [t.id, ASSIGNED_PEOPLE.get(t.id) ?? []])) })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useUIStore.setState({ taskDialog: null, checkinDialog: null, editPopupMode: null, selectedTodoId: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('TaskDialog', () => {
  it('shows the title, the count, what is counted and the rows in order', () => {
    open(HOT)
    expect(within(dialog()!).getByRole('heading').textContent).toBe('Hot tasks')
    expect(within(dialog()!).getByTestId('task-dialog-count').textContent).toBe('4')
    expect(dialog()!.textContent).toContain('Hot = urgent and important, or in Focus (Settings › Tasks).')
    expect(rowTitles()).toEqual(['Fix checkout outage', 'Headcount request', 'Draft homepage copy', 'Book venue for offsite'])
  })

  it('a completed row stays, struck through, until the dialog closes; a deleted one goes', () => {
    open(HOT)
    act(() => {
      useTodoStore.setState({ todos: SAMPLE_TASKS.filter((t) => t.id !== 4).map((t) => (t.id === 1 ? { ...t, isCompleted: true } : t)) })
    })
    expect(rowTitles()).toEqual(['Fix checkout outage', 'Headcount request', 'Draft homepage copy'])
    expect(row(1).className).toMatch(/completed/)
    expect(within(row(1)).getByRole('checkbox')).toHaveProperty('checked', true)
  })

  it('a row opens the editor', () => {
    open(HOT)
    fireEvent.click(row(2).querySelector('[data-task-title]')!)
    expect(useUIStore.getState()).toMatchObject({ editPopupMode: 'edit', selectedTodoId: 2 })
    expect(dialog()).not.toBeNull()
  })

  it('Esc closes it, unless the editor is open on top', () => {
    open(HOT)
    act(() => useUIStore.setState({ editPopupMode: 'edit', selectedTodoId: 1 }))
    fireEvent.keyDown(dialog()!, { key: 'Escape' })
    expect(useUIStore.getState().taskDialog).not.toBeNull()
    act(() => useUIStore.setState({ editPopupMode: null, selectedTodoId: null }))
    fireEvent.keyDown(dialog()!, { key: 'Escape' })
    expect(useUIStore.getState().taskDialog).toBeNull()
    expect(dialog()).toBeNull()
  })

  it('× and Close close it', () => {
    open(HOT)
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Close' }))
    expect(dialog()).toBeNull()
    act(() => useUIStore.getState().showTaskDialog(HOT))
    fireEvent.click(within(dialog()!).getByRole('button', { name: /^Close\s*Esc$/ }))
    expect(dialog()).toBeNull()
  })

  it('grouped sources show headings with counts', () => {
    open({
      ...HOT,
      title: 'Today',
      source: { kind: 'groups', groups: [{ key: 'due', label: 'Due', todoIds: [1, 2, 3] }, { key: 'fu', label: 'Follow-up', todoIds: [9] }] },
    })
    const groups = within(dialog()!).getAllByRole('group').filter((g) => g.dataset.taskDialogGroup)
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Due', 'Follow-up'])
    // Each heading: the name, then the count (D25 A1: no `·` between them).
    expect(groups.map((g) => g.firstElementChild?.textContent)).toEqual(['Due3', 'Follow-up1'])
    expect(within(dialog()!).getByTestId('task-dialog-count').textContent).toBe('4')
  })

  it('Copy tasks copies the rows as shown', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    open({ ...HOT, source: { kind: 'todos', todoIds: [1, 9] } })
    await act(async () => {
      fireEvent.click(within(dialog()!).getByRole('button', { name: /Copy tasks/ }))
    })
    expect(writeText).toHaveBeenCalledTimes(1)
    const text = writeText.mock.calls[0]![0] as string
    expect(text.split('\n').map((l) => l.replace(/ \(.*$/, '').replace(/ \[.*$/, ''))).toEqual([
      '[ ] Fix checkout outage',
      '[ ] Chase venue deposit invoice',
    ])
    expect(within(dialog()!).getByRole('button', { name: /Copied/ })).toBeTruthy()
  })

  it('Copy tasks refused by the browser says so in the snackbar, and nothing reads Copied', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    open({ ...HOT, source: { kind: 'todos', todoIds: [1, 9] } })
    await act(async () => {
      fireEvent.click(within(dialog()!).getByRole('button', { name: /Copy tasks/ }))
    })
    expect(useUndoStore.getState().snackbar).toMatchObject({ notice: true, description: 'Couldn’t copy: the browser didn’t allow access to the clipboard.' })
    expect(within(dialog()!).queryByRole('button', { name: /Copied/ })).toBeNull()
  })

  it('an empty source says so', () => {
    open({ ...HOT, source: { kind: 'todos', todoIds: [] } })
    expect(dialog()!.textContent).toContain('No tasks')
    expect(within(dialog()!).getByRole('button', { name: /Copy tasks/ })).toHaveProperty('disabled', true)
  })

  it('a person’s dialog has Review · Email check-in · Paste reply… as buttons under its title; the footer only Copy tasks and Close', async () => {
    const priya = PEOPLE.find((p) => p.name === 'Priya Nair')!
    open(personTaskDialog(priya))
    const actions = within(dialog()!).getByRole('group', { name: 'Actions for Priya Nair' })
    expect(within(actions).getAllByRole('button').map((b) => b.textContent)).toEqual(['Review', 'Email check-in', 'Paste reply…'])
    // Each names the person in full, as the person menu does.
    expect(within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Review with Priya Nair…', 'Email check-in to Priya Nair', 'Paste reply from Priya Nair…'])
    // Under the title, before the rows.
    const heading = within(dialog()!).getByRole('heading')
    expect(heading.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(actions.compareDocumentPosition(within(dialog()!).getByRole('group', { name: 'Tasks' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    const footerButtons = Array.from(dialog()!.querySelectorAll('[class*="footer"] button')).map((b) => b.textContent)
    expect(footerButtons).toEqual(['Copy tasks', 'CloseEsc'])
    expect(within(dialog()!).queryByRole('button', { name: /Email check-in options/ })).toBeNull()
    // No clipboard here: the send can't copy, so the check-in dialog opens for her with the reason.
    fireEvent.click(within(actions).getByRole('button', { name: 'Email check-in to Priya Nair' }))
    await vi.waitFor(() => expect(useUIStore.getState().checkinDialog).toEqual({
      personIds: [priya.id],
      notice: 'Couldn’t copy the email to the clipboard, so nothing was opened. Try again.',
    }))
    // The task dialog stays open underneath.
    expect(dialog()).not.toBeNull()
  })

  it('a person’s dialog’s Review closes the dialog, then opens the deck on her open tasks', () => {
    const priya = PEOPLE.find((p) => p.name === 'Priya Nair')!
    const expected = resolveTaskDialog(personTaskDialog(priya).source, currentTaskDialogEnv()).flatMap((g) => g.todoIds)
    open(personTaskDialog(priya))
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Review with Priya Nair…' }))
    const review = useReviewStore.getState()
    expect(review).toMatchObject({ open: true, source: { kind: 'person', title: 'Priya Nair' } })
    expect(review.ids).toEqual(expected)
    expect(review.ids.length).toBeGreaterThan(0)
    expect(useUIStore.getState().taskDialog).toBeNull()
  })

  it('a person with no open tasks: Review is off, saying why', () => {
    open(personTaskDialog({ id: 999, name: 'Nobody' }))
    const review = within(dialog()!).getByRole('button', { name: 'Review with Nobody…' })
    expect(review).toBeDisabled()
    expect(review).toHaveAttribute('title', 'No open tasks')
  })

  it('a person’s dialog’s Paste reply opens the check-in reply import over it', () => {
    const priya = PEOPLE.find((p) => p.name === 'Priya Nair')!
    useUIStore.setState({ checkinImportOpen: false })
    open(personTaskDialog(priya))
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Paste reply from Priya Nair…' }))
    expect(useUIStore.getState().checkinImportOpen).toBe(true)
    expect(useUIStore.getState().checkinImportPersonId).toBe(priya.id)
    expect(dialog()).not.toBeNull()
  })

  it('other dialogs have no Email check-in', () => {
    open(HOT)
    expect(within(dialog()!).queryByRole('button', { name: /Email check-in/ })).toBeNull()
  })
})

describe('TaskDialog — the screen filter’s tasks (a phone)', () => {
  const PRIYA_OPEN = ['Draft homepage copy', 'Vendor contract redlines', 'Q4 roadmap deck', 'Q4 forecast']
  const bar = () => dialog()!.querySelector<HTMLElement>('[data-task-dialog-filters]')!
  const count = () => within(dialog()!).getByTestId('task-dialog-count').textContent

  it('opens on the tasks the screen filter matches, with the search and a Filters disclosure under the header', () => {
    useFilterStore.getState().setPersonIds(new Set([PRIYA]))
    open(screenTaskDialog())
    expect(within(dialog()!).getByRole('heading').textContent).toBe('Filtered tasks')
    expect(count()).toBe('4')
    expect(dialog()!.textContent).toContain('Open tasks matching the screen filter.')
    const filters = within(bar()).getByRole('button', { name: 'Filters, 1 active' })
    expect(filters).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(filters)
    expect(filters).toHaveAttribute('aria-expanded', 'true')
    // Footer: Copy tasks and Close only.
    expect(within(dialog()!).queryByRole('button', { name: 'Email check-in' })).toBeNull()
  })

  it('rows resolve again when the screen filter changes, and stay fixed between changes', () => {
    useFilterStore.getState().setPersonIds(new Set([PRIYA]))
    open(screenTaskDialog())
    const draft = SAMPLE_TASKS.find((t) => t.title === 'Draft homepage copy')!
    // Completed here: the row stays (struck through) — the filter didn't change.
    act(() => useTodoStore.setState({ todos: SAMPLE_TASKS.map((t) => (t.id === draft.id ? { ...t, isCompleted: true } : t)) }))
    expect(rowTitles()).toEqual(PRIYA_OPEN)
    act(() => useFilterStore.getState().setShowCompleted(true))
    expect(rowTitles()).toEqual(expect.arrayContaining([...PRIYA_OPEN, 'Team lunch booking']))
    expect(count()).toBe('5')
    expect(dialog()!.textContent).toContain('Tasks matching the screen filter, completed ones included.')
    act(() => useFilterStore.getState().setShowCompleted(false))
    expect(rowTitles()).toEqual(PRIYA_OPEN.filter((t) => t !== 'Draft homepage copy'))
  })

  it('its search edits the screen filter’s text; Esc with text clears it, the next Esc closes', async () => {
    open(screenTaskDialog())
    const search = within(bar()).getByRole('textbox', { name: 'Filter tasks' })
    fireEvent.change(search, { target: { value: 'q4 forecast' } })
    await vi.waitFor(() => expect(useFilterStore.getState().filters.searchText).toBe('q4 forecast'))
    expect(rowTitles()).toEqual(['Q4 forecast'])
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(dialog()).not.toBeNull()
    expect((search as HTMLInputElement).value).toBe('')
    await vi.waitFor(() => expect(useFilterStore.getState().filters.searchText).toBe(''))
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(useUIStore.getState().taskDialog).toBeNull()
  })

  it('its search takes tokens (D16): @name makes a People chip, the words stay the text search', async () => {
    open(screenTaskDialog())
    const search = within(bar()).getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement
    const type = (value: string) => fireEvent.change(search, { target: { value, selectionStart: value.length, selectionEnd: value.length } })
    act(() => search.focus())
    type('forecast @pri')
    // The popup under the bar, inside the dialog.
    const popup = bar().querySelector<HTMLElement>('[data-nlp-popup]')
    expect(popup).not.toBeNull()
    fireEvent.mouseDown(within(popup!).getByRole('option', { name: 'Priya Nair' }), { button: 0 })
    expect(useFilterStore.getState().filters.personIds).toEqual(new Set([PRIYA]))
    expect(search.value).toBe('forecast ')
    await vi.waitFor(() => expect(useFilterStore.getState().filters.searchText).toBe('forecast'))
    expect(rowTitles()).toEqual(['Q4 forecast'])
    expect(within(bar()).getByRole('button', { name: 'Filters, 1 active' })).toBeTruthy()
    // An unknown name stays words, with a note.
    type('forecast @nobody ')
    expect(within(bar()).getByRole('status')).toHaveTextContent('No person named nobody — searching the words instead')
    // Backspace in the empty box takes the last chip back as its token.
    type('')
    fireEvent.keyDown(search, { key: 'Backspace' })
    expect(search.value).toBe('@"Priya Nair"')
    expect(useFilterStore.getState().filters.personIds).toBeNull()
  })

  it('Esc on the popup closes the popup only, not the dialog', () => {
    open(screenTaskDialog())
    const search = within(bar()).getByRole('textbox', { name: 'Filter tasks' }) as HTMLInputElement
    act(() => search.focus())
    fireEvent.change(search, { target: { value: '@pri', selectionStart: 4, selectionEnd: 4 } })
    expect(bar().querySelector('[data-nlp-popup]')).not.toBeNull()
    fireEvent.keyDown(search, { key: 'Escape' })
    expect(bar().querySelector('[data-nlp-popup]')).toBeNull()
    expect(useUIStore.getState().taskDialog).not.toBeNull()
  })

  it('sorted and grouped by Settings’ new-list defaults', () => {
    useSettingsStore.setState({ newListSort: 'name', newListSortDirection: 'asc', newListGroup: 'status' })
    useFilterStore.getState().setPersonIds(new Set([PRIYA]))
    open(screenTaskDialog())
    const groups = Array.from(dialog()!.querySelectorAll<HTMLElement>('[data-task-dialog-group]'))
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) {
      const titles = Array.from(g.querySelectorAll<HTMLElement>('[data-todo-id]'))
        .map((r) => SAMPLE_TASKS.find((t) => t.id === Number(r.dataset.todoId))!.title)
      expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b)))
    }
  })

  it('other dialogs have no filter bar, and their rows don’t follow the screen filter', () => {
    open(HOT)
    expect(dialog()!.querySelector('[data-task-dialog-filters]')).toBeNull()
    const before = rowTitles()
    act(() => useFilterStore.getState().setPersonIds(new Set([PRIYA])))
    expect(rowTitles()).toEqual(before)
  })
})
