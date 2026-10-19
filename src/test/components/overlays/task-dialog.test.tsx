import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act, fireEvent, within } from '@testing-library/react'
import { TaskDialog } from '../../../components/overlays/TaskDialog'
import { createTab, type PersistedWorkspaceLayout } from '../../../models/workspace-layout'
import { personTaskDialog } from '../../../services/task-dialog'
import type { TaskDialogPayload } from '../../../stores/task-dialog-payload'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { useListDraftStore } from '../../../stores/list-draft-store'
import { usePersonStore } from '../../../stores/person-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { useTodoStore } from '../../../stores/todo-store'
import { useUIStore } from '../../../stores/ui-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { DEFAULT_HOT_RULE } from '../../../utils/hot'
import { clearFilterStore, resetEntityStores } from '../../helpers'
import {
  ASSIGNED_PEOPLE, ASSIGNED_TAGS, PEOPLE, SAMPLE_LISTS, SAMPLE_TASKS, STATUSES, TAGS,
} from '../../fixtures/dashboard-sample'

const HOT: TaskDialogPayload = {
  title: 'Hot tasks',
  glyph: 'hot',
  description: 'Hot = urgent and important, or in Focus (Settings › Tasks).',
  source: { kind: 'todos', todoIds: [1, 2, 3, 4] },
  fromTabId: 'dash',
}

function layout(): PersistedWorkspaceLayout {
  const now = new Date(2026, 0, 1)
  return {
    id: 1, name: 'Main', createdAt: now, modifiedAt: now,
    columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [createTab('dashboard', 'dash')] }] }],
  }
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
  useSettingsStore.setState({ urgentDueWithinDays: 3, hotRule: DEFAULT_HOT_RULE, weekStartsOn: 0 })
  useTodoStore.setState({ todos: SAMPLE_TASKS })
  // Loaded as the store loads them: an entry for every task, empty when nobody is on it.
  usePersonStore.setState({ people: PEOPLE, assignedPeopleMap: new Map(SAMPLE_TASKS.map((t) => [t.id, ASSIGNED_PEOPLE.get(t.id) ?? []])) })
  useTagStore.setState({ tags: TAGS, assignedTagsMap: ASSIGNED_TAGS })
  useStatusStore.setState({ statuses: STATUSES })
  useListDefinitionStore.setState({ listDefinitions: SAMPLE_LISTS })
  useListDraftStore.setState({ drafts: {} })
  useUIStore.setState({ taskDialog: null, checkinDialog: null, editPopupMode: null, selectedTodoId: null })
  const l = layout()
  useWorkspaceStore.setState({ layouts: [l], activeLayoutId: 1, working: l, saved: l, isDirty: false, hydrated: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  useWorkspaceStore.setState({ layouts: [], activeLayoutId: null, working: null, saved: null, isDirty: false, hydrated: false })
})

describe('TaskDialog', () => {
  it('shows the title, the count, what is counted and the rows in order', () => {
    open(HOT)
    expect(within(dialog()!).getByRole('heading').textContent).toBe('Hot tasks')
    expect(within(dialog()!).getByTestId('task-dialog-count').textContent).toBe('4')
    expect(dialog()!.textContent).toContain('Hot = urgent and important, or in Focus (Settings › Tasks).')
    expect(rowTitles()).toEqual(['Fix checkout outage', 'Headcount request', 'Draft homepage copy', 'Book venue for offsite'])
    // Not a list widget: no Open as tab.
    expect(within(dialog()!).queryByRole('button', { name: 'Open as tab' })).toBeNull()
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
    expect(groups[0]!.textContent).toContain('· 3')
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

  it('a list’s dialog: the list’s rows, and Open as tab adds its List tab beside the dashboard (layout unsaved)', () => {
    open({ title: '#q4 planning', glyph: 'list', description: 'Saved list · #q4', source: { kind: 'list', listDefinitionId: 3 }, fromTabId: 'dash' })
    expect(rowTitles()).toEqual(['Budget review with finance', 'Q4 roadmap deck', 'Q4 forecast', 'Book venue for offsite', 'Offsite agenda'])
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Open as tab' }))
    const cell = useWorkspaceStore.getState().working!.columns[0]!.cells[0]!
    expect(cell.tabs.map((t) => t.kind)).toEqual(['dashboard', 'lens'])
    expect(cell.tabs[1]).toMatchObject({ kind: 'lens', config: { listDefinitionId: 3 } })
    expect(cell.activeTabId).toBe(cell.tabs[1]!.id)
    expect(useWorkspaceStore.getState().isDirty).toBe(true)
    expect(dialog()).toBeNull()
  })

  it('no Open as tab when the tab it came from is gone', () => {
    open({ title: 'L', glyph: 'list', description: '', source: { kind: 'list', listDefinitionId: 3 }, fromTabId: 'gone' })
    expect(within(dialog()!).queryByRole('button', { name: 'Open as tab' })).toBeNull()
  })

  it('an empty source says so', () => {
    open({ ...HOT, source: { kind: 'todos', todoIds: [] } })
    expect(dialog()!.textContent).toContain('No tasks')
    expect(within(dialog()!).getByRole('button', { name: /Copy tasks/ })).toHaveProperty('disabled', true)
  })

  it('a person’s dialog offers Email check-in next to Copy tasks, which sends that person’s check-in at once', async () => {
    const priya = PEOPLE.find((p) => p.name === 'Priya Nair')!
    open(personTaskDialog(priya))
    const footerButtons = Array.from(dialog()!.querySelectorAll('[class*="footer"] button')).map((b) => b.textContent)
    expect(footerButtons.slice(0, 2)).toEqual(['Copy tasks', 'Email check-in'])
    // No clipboard here: the send can't copy, so the check-in dialog opens for her with the reason.
    fireEvent.click(within(dialog()!).getByRole('button', { name: 'Email check-in' }))
    await vi.waitFor(() => expect(useUIStore.getState().checkinDialog).toEqual({
      personIds: [priya.id],
      notice: 'Couldn’t copy the email to the clipboard, so nothing was opened. Try again.',
    }))
    // The task dialog stays open underneath.
    expect(dialog()).not.toBeNull()
  })

  it('other dialogs have no Email check-in', () => {
    open(HOT)
    expect(within(dialog()!).queryByRole('button', { name: 'Email check-in' })).toBeNull()
  })
})
