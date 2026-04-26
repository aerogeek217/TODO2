import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../../stores/ui-store'
import { AppView } from '../../models'

beforeEach(() => {
  useUIStore.setState({
    activeView: AppView.Canvas,
    selectedTodoId: null,
    selectedTodoIds: new Set(),
    selectionAnchorId: null,
    selectionFocusId: null,
    focusedTodoId: null,
    editPopupMode: null,
    bulkConfirmation: null,
    listGroupBy: 'date',
    listSortBy: 'manual',
    inlineCreateAfterId: null,
    clipboardTodoIds: [],
    clipboardSourceProjectId: null,
    filteredListPopup: null,
    listsEditorOpen: false,
    listsEditorInitialId: null,
    listEditorDialogId: null,
  })
})

describe('useUIStore', () => {
  it('openEditPopup sets selectedTodoId and mode', () => {
    useUIStore.getState().openEditPopup(42)
    const state = useUIStore.getState()
    expect(state.selectedTodoId).toBe(42)
    expect(state.editPopupMode).toBe('edit')
  })

  it('openCreatePopup sets create mode with no selected todo', () => {
    useUIStore.getState().openCreatePopup()
    const state = useUIStore.getState()
    expect(state.selectedTodoId).toBeNull()
    expect(state.editPopupMode).toBe('create')
  })

  it('closeEditPopup clears selection and mode', () => {
    useUIStore.getState().openEditPopup(42)
    useUIStore.getState().closeEditPopup()
    const state = useUIStore.getState()
    expect(state.selectedTodoId).toBeNull()
    expect(state.editPopupMode).toBeNull()
  })

  it('selectOneTodo sets selectedTodoIds to {id} and sets anchor/focus/focusedTodoId', () => {
    useUIStore.getState().selectOneTodo(5)
    const state = useUIStore.getState()
    expect(state.selectedTodoIds).toEqual(new Set([5]))
    expect(state.selectionAnchorId).toBe(5)
    expect(state.selectionFocusId).toBe(5)
    expect(state.focusedTodoId).toBe(5)
  })

  it('toggleSelectTodo adds id and removes if present', () => {
    useUIStore.getState().toggleSelectTodo(1)
    expect(useUIStore.getState().selectedTodoIds.has(1)).toBe(true)

    useUIStore.getState().toggleSelectTodo(2)
    expect(useUIStore.getState().selectedTodoIds.has(1)).toBe(true)
    expect(useUIStore.getState().selectedTodoIds.has(2)).toBe(true)

    useUIStore.getState().toggleSelectTodo(1)
    expect(useUIStore.getState().selectedTodoIds.has(1)).toBe(false)
    expect(useUIStore.getState().selectedTodoIds.has(2)).toBe(true)
  })

  it('rangeSelectTodo selects range from anchor to target', () => {
    useUIStore.getState().selectOneTodo(2)
    useUIStore.getState().rangeSelectTodo(5, [1, 2, 3, 4, 5, 6])
    const state = useUIStore.getState()
    expect(state.selectedTodoIds).toEqual(new Set([2, 3, 4, 5]))
    expect(state.selectionFocusId).toBe(5)
  })

  it('rangeSelectTodo handles reverse range', () => {
    useUIStore.getState().selectOneTodo(5)
    useUIStore.getState().rangeSelectTodo(2, [1, 2, 3, 4, 5, 6])
    expect(useUIStore.getState().selectedTodoIds).toEqual(new Set([2, 3, 4, 5]))
  })

  it('rangeSelectTodo falls back to single when anchor null', () => {
    useUIStore.getState().rangeSelectTodo(3, [1, 2, 3, 4])
    expect(useUIStore.getState().selectedTodoIds).toEqual(new Set([3]))
    expect(useUIStore.getState().selectionAnchorId).toBe(3)
  })

  it('rangeSelectTodo falls back to single when anchor not in orderedIds', () => {
    useUIStore.getState().selectOneTodo(99)
    useUIStore.getState().rangeSelectTodo(3, [1, 2, 3, 4])
    expect(useUIStore.getState().selectedTodoIds).toEqual(new Set([3]))
  })

  it('clearSelection clears all selection state', () => {
    useUIStore.getState().selectOneTodo(5)
    useUIStore.getState().clearSelection()
    const state = useUIStore.getState()
    expect(state.selectedTodoIds.size).toBe(0)
    expect(state.selectionAnchorId).toBeNull()
    expect(state.selectionFocusId).toBeNull()
    expect(state.focusedTodoId).toBeNull()
  })

  it('setActiveView switches view', () => {
    useUIStore.getState().setActiveView(AppView.List)
    expect(useUIStore.getState().activeView).toBe(AppView.List)
  })

  it('showBulkConfirmation and clearBulkConfirmation', () => {
    useUIStore.getState().showBulkConfirmation('delete', [1, 2])
    expect(useUIStore.getState().bulkConfirmation).toEqual({ action: 'delete', ids: [1, 2] })

    useUIStore.getState().clearBulkConfirmation()
    expect(useUIStore.getState().bulkConfirmation).toBeNull()
  })

  it('triggerInlineCreate and clearInlineCreate', () => {
    useUIStore.getState().triggerInlineCreate(7)
    expect(useUIStore.getState().inlineCreateAfterId).toBe(7)

    useUIStore.getState().clearInlineCreate()
    expect(useUIStore.getState().inlineCreateAfterId).toBeNull()
  })

  it('setListSortBy changes within-group sort', () => {
    useUIStore.getState().setListSortBy('date')
    expect(useUIStore.getState().listSortBy).toBe('date')

    useUIStore.getState().setListSortBy('manual')
    expect(useUIStore.getState().listSortBy).toBe('manual')
  })

  it('setListGroupBy changes grouping', () => {
    useUIStore.getState().setListGroupBy('date')
    expect(useUIStore.getState().listGroupBy).toBe('date')

    useUIStore.getState().setListGroupBy('none')
    expect(useUIStore.getState().listGroupBy).toBe('none')
  })

  it('cutTasks and clearClipboard', () => {
    useUIStore.getState().cutTasks([1, 2, 3], 10)
    expect(useUIStore.getState().clipboardTodoIds).toEqual([1, 2, 3])
    expect(useUIStore.getState().clipboardSourceProjectId).toBe(10)

    useUIStore.getState().clearClipboard()
    expect(useUIStore.getState().clipboardTodoIds).toEqual([])
    expect(useUIStore.getState().clipboardSourceProjectId).toBeNull()
  })

  it('openListsEditor stores initialId; closeListsEditor resets both', () => {
    expect(useUIStore.getState().listsEditorOpen).toBe(false)
    expect(useUIStore.getState().listsEditorInitialId).toBeNull()

    useUIStore.getState().openListsEditor(42)
    expect(useUIStore.getState().listsEditorOpen).toBe(true)
    expect(useUIStore.getState().listsEditorInitialId).toBe(42)

    useUIStore.getState().closeListsEditor()
    expect(useUIStore.getState().listsEditorOpen).toBe(false)
    expect(useUIStore.getState().listsEditorInitialId).toBeNull()
  })

  it('openListsEditor without an id leaves initialId null', () => {
    useUIStore.getState().openListsEditor()
    expect(useUIStore.getState().listsEditorOpen).toBe(true)
    expect(useUIStore.getState().listsEditorInitialId).toBeNull()
  })

  it('openListEditorDialog stores the def id; closeListEditorDialog resets it', () => {
    expect(useUIStore.getState().listEditorDialogId).toBeNull()

    useUIStore.getState().openListEditorDialog(7)
    expect(useUIStore.getState().listEditorDialogId).toBe(7)

    useUIStore.getState().closeListEditorDialog()
    expect(useUIStore.getState().listEditorDialogId).toBeNull()
  })

  it('openListEditorDialog does NOT open the Lists manager modal', () => {
    // Direct dialog and Lists manager are deliberately separate flows
    // (triage-2026-04-26 P5 / Q7=A): a tab pill's Edit list opens only the
    // dialog, not the manager underneath.
    useUIStore.getState().openListEditorDialog(7)
    expect(useUIStore.getState().listEditorDialogId).toBe(7)
    expect(useUIStore.getState().listsEditorOpen).toBe(false)
    expect(useUIStore.getState().listsEditorInitialId).toBeNull()
  })

  it('openListsEditor does NOT open the direct list-editor dialog', () => {
    useUIStore.getState().openListsEditor(7)
    expect(useUIStore.getState().listsEditorOpen).toBe(true)
    expect(useUIStore.getState().listEditorDialogId).toBeNull()
  })
})
