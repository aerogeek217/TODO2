import { describe, it, expect, vi, beforeEach } from 'vitest'
import { pasteTasksAt } from '../../services/clipboard'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { AppView } from '../../models'
import { makeTodo } from '../helpers'

// Mock task-placement so we control what mutations are returned
vi.mock('../../services/task-placement', () => ({
  placeMultipleAt: vi.fn(),
}))

import { placeMultipleAt } from '../../services/task-placement'
const mockPlaceMultipleAt = vi.mocked(placeMultipleAt)

const UI_RESET = {
  activeView: AppView.Canvas,
  selectedTodoId: null,
  selectedTodoIds: new Set<number>(),
  selectionAnchorId: null,
  selectionFocusId: null,
  focusedTodoId: null,
  editPopupMode: null as null,
  bulkConfirmation: null,
  listSortBy: 'date' as const,
  inlineCreateAfterId: null,
  clipboardTodoIds: [] as number[],
  clipboardSourceProjectId: null,
  filteredListPopup: null,
  pendingCanvasTarget: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  useUIStore.setState(UI_RESET)
  useTodoStore.setState({ todos: [], loading: false, error: null })
})

const TARGET = { projectId: 10, beforeTodoId: null }

describe('pasteTasksAt', () => {
  it('pasteTasksAt_emptyClipboard_returnsWithoutCallingPlaceMultipleAt', async () => {
    // Arrange: clipboard is empty (default)
    expect(useUIStore.getState().clipboardTodoIds).toHaveLength(0)

    // Act
    await pasteTasksAt(TARGET)

    // Assert: placement function never called
    expect(mockPlaceMultipleAt).not.toHaveBeenCalled()
  })

  it('pasteTasksAt_emptyClipboard_doesNotClearClipboard', async () => {
    // Arrange: clipboard is empty
    const clearClipboard = vi.spyOn(useUIStore.getState(), 'clearClipboard')

    // Act
    await pasteTasksAt(TARGET)

    // Assert
    expect(clearClipboard).not.toHaveBeenCalled()
  })

  it('pasteTasksAt_validClipboardAndMutationsProduced_callsApplyMutationsAndClearsClipboard', async () => {
    // Arrange
    const todo1 = makeTodo({ id: 1, projectId: 20, sortOrder: 1 })
    const todo2 = makeTodo({ id: 2, projectId: 20, sortOrder: 2 })
    useTodoStore.setState({ todos: [todo1, todo2], loading: false, error: null })
    useUIStore.getState().cutTasks([1, 2], 20)

    const mutations = [
      { todoId: 1, changes: { projectId: 10, sortOrder: 3 } },
      { todoId: 2, changes: { projectId: 10, sortOrder: 4 } },
    ]
    mockPlaceMultipleAt.mockReturnValue(mutations)

    const applyMutations = vi.fn().mockResolvedValue(undefined)
    useTodoStore.setState({ applyMutations } as any)

    // Act
    await pasteTasksAt(TARGET)

    // Assert: placement called with correct args
    expect(mockPlaceMultipleAt).toHaveBeenCalledWith(
      [todo1, todo2],
      new Set([1, 2]),
      TARGET
    )

    // Assert: mutations applied
    expect(applyMutations).toHaveBeenCalledWith(mutations)

    // Assert: clipboard cleared after paste
    expect(useUIStore.getState().clipboardTodoIds).toHaveLength(0)
    expect(useUIStore.getState().clipboardSourceProjectId).toBeNull()
  })

  it('pasteTasksAt_placeMultipleAtReturnsEmptyMutations_doesNotApplyOrClearClipboard', async () => {
    // Arrange: clipboard has items but placement is a no-op
    const todo1 = makeTodo({ id: 5, projectId: 10, sortOrder: 1 })
    useTodoStore.setState({ todos: [todo1], loading: false, error: null })
    useUIStore.getState().cutTasks([5], 10)

    mockPlaceMultipleAt.mockReturnValue([])

    const applyMutations = vi.fn().mockResolvedValue(undefined)
    useTodoStore.setState({ applyMutations } as any)

    // Act
    await pasteTasksAt(TARGET)

    // Assert: nothing applied
    expect(applyMutations).not.toHaveBeenCalled()

    // Assert: clipboard NOT cleared because mutations were empty
    expect(useUIStore.getState().clipboardTodoIds).toEqual([5])
  })

  it('pasteTasksAt_singleClipboardItem_passesCorrectSetToPlaceMultipleAt', async () => {
    // Arrange
    const todo = makeTodo({ id: 7, projectId: 30, sortOrder: 1 })
    useTodoStore.setState({ todos: [todo], loading: false, error: null })
    useUIStore.getState().cutTasks([7], 30)

    mockPlaceMultipleAt.mockReturnValue([{ todoId: 7, changes: { projectId: 10, sortOrder: 1 } }])

    const applyMutations = vi.fn().mockResolvedValue(undefined)
    useTodoStore.setState({ applyMutations } as any)

    const singleItemTarget = { projectId: 10, beforeTodoId: null }

    // Act
    await pasteTasksAt(singleItemTarget)

    // Assert: Set contains exactly the one clipboard id
    expect(mockPlaceMultipleAt).toHaveBeenCalledWith(
      [todo],
      new Set([7]),
      singleItemTarget
    )
  })
})
