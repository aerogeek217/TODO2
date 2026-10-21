import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../../stores/ui-store'

beforeEach(() => {
  useUIStore.setState({
    selectedTodoId: null,
    selectedTodoIds: new Set(),
    selectionAnchorId: null,
    selectionFocusId: null,
    editPopupMode: null,
    bulkConfirmation: null,
    taskDialog: null,
    listEditor: null,
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

  it('showTaskDialog opens the dialog and clears the selection; hideTaskDialog closes it', () => {
    useUIStore.getState().setScopedSelection('tab', { ids: new Set([1, 2]), anchorKey: 'a', cursorKey: 'b', cursorTodoId: 2 })
    const payload = { title: 'Hot tasks', glyph: 'hot', description: 'd', source: { kind: 'todos', todoIds: [1] } } as const
    useUIStore.getState().showTaskDialog(payload)
    const state = useUIStore.getState()
    expect(state.taskDialog).toBe(payload)
    expect(state.selectedTodoIds.size).toBe(0)
    expect(state.selectionScope).toBeNull()
    useUIStore.getState().hideTaskDialog()
    expect(useUIStore.getState().taskDialog).toBeNull()
  })

  it('selectOneTodo sets selectedTodoIds to {id} and sets anchor/focus', () => {
    useUIStore.getState().selectOneTodo(5)
    const state = useUIStore.getState()
    expect(state.selectedTodoIds).toEqual(new Set([5]))
    expect(state.selectionAnchorId).toBe(5)
    expect(state.selectionFocusId).toBe(5)
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
  })

  it('showBulkConfirmation and clearBulkConfirmation', () => {
    useUIStore.getState().showBulkConfirmation('delete', [1, 2])
    expect(useUIStore.getState().bulkConfirmation).toEqual({ action: 'delete', ids: [1, 2] })

    useUIStore.getState().clearBulkConfirmation()
    expect(useUIStore.getState().bulkConfirmation).toBeNull()
  })

  it('openListEditor opens Edit list for a list tab; closeListEditor closes it', () => {
    expect(useUIStore.getState().listEditor).toBeNull()

    useUIStore.getState().openListEditor(7, 'tab-1')
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 7, tabId: 'tab-1' })
    // Another list's Edit list replaces it: one open at a time.
    useUIStore.getState().openListEditor(8, 'tab-2')
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 8, tabId: 'tab-2' })

    useUIStore.getState().closeListEditor()
    expect(useUIStore.getState().listEditor).toBeNull()
  })

  it('opening Settings closes Edit list first (it belongs to the workspace), through its close request', () => {
    useUIStore.getState().openListEditor(7, 'tab-1')
    useUIStore.getState().openSettings('tasks')
    // Waiting on Edit list's host (it asks while the list is unsaved).
    expect(useUIStore.getState().settingsOpen).toBe(false)
    expect(useUIStore.getState().listEditorCloseRequest).not.toBeNull()
    useUIStore.getState().finishListEditorClose()
    expect(useUIStore.getState()).toMatchObject({ listEditor: null, listEditorCloseRequest: null, settingsOpen: true, settingsSection: 'tasks' })
  })

  it('finishing a close twice (the prompt’s Save landing after the draft went) leaves the Edit list its follow-up opened', () => {
    useUIStore.getState().openListEditor(7, 'tab-1')
    useUIStore.getState().requestCloseListEditor(() => useUIStore.getState().openListEditor(8, 'tab-2'))
    useUIStore.getState().finishListEditorClose()
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 8, tabId: 'tab-2' })
    useUIStore.getState().finishListEditorClose()
    expect(useUIStore.getState().listEditor).toEqual({ listDefinitionId: 8, tabId: 'tab-2' })
  })

  it('a close request runs its follow-up at once when no Edit list is open; Cancel drops it', () => {
    let ran = 0
    useUIStore.getState().requestCloseListEditor(() => { ran++ })
    expect(ran).toBe(1)
    expect(useUIStore.getState().listEditorCloseRequest).toBeNull()

    useUIStore.getState().openListEditor(7, 'tab-1')
    useUIStore.getState().requestCloseListEditor(() => { ran++ })
    useUIStore.getState().cancelListEditorClose()
    expect(useUIStore.getState().listEditor).not.toBeNull()
    expect(ran).toBe(1)
    // closeListEditor (the list left the screen) drops a waiting request too.
    useUIStore.getState().requestCloseListEditor(() => { ran++ })
    useUIStore.getState().closeListEditor()
    expect(useUIStore.getState()).toMatchObject({ listEditor: null, listEditorCloseRequest: null })
    expect(ran).toBe(1)
  })

  it('a control to focus is kept only on the way to a part, and forgotten when Settings closes', () => {
    useUIStore.getState().openSettings('tasks', 'eisenhower-pane-do')
    expect(useUIStore.getState()).toMatchObject({ settingsSection: 'tasks', settingsPart: null, settingsFocus: null })
    useUIStore.getState().openSettings('eisenhower', 'eisenhower-pane-do')
    expect(useUIStore.getState()).toMatchObject({ settingsPart: 'eisenhower', settingsFocus: 'eisenhower-pane-do' })
    useUIStore.getState().closeSettings()
    expect(useUIStore.getState()).toMatchObject({ settingsOpen: false, settingsPart: null, settingsFocus: null })
  })
})
