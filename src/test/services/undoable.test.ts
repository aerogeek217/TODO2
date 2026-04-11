import { describe, it, expect, vi, beforeEach } from 'vitest'
import { undoable } from '../../services/undoable'
import { useUndoStore } from '../../stores/undo-store'

beforeEach(() => {
  useUndoStore.setState({
    undoStack: [],
    redoStack: [],
    isPerformingUndoRedo: false,
    groupStartIndex: null,
    snackbar: null,
    snackbarTimerId: null,
  })
})

describe('undoable', () => {
  it('pushes entry with redo=doFn and undo=undoFn', () => {
    const doFn = vi.fn()
    const undoFn = vi.fn()
    undoable('test action', doFn, undoFn)

    const { undoStack } = useUndoStore.getState()
    expect(undoStack).toHaveLength(1)
    expect(undoStack[0].description).toBe('test action')
    expect(undoStack[0].redo).toBe(doFn)
    expect(undoStack[0].undo).toBe(undoFn)
  })

  it('skips push when isPerformingUndoRedo is true', () => {
    useUndoStore.setState({ isPerformingUndoRedo: true })
    const doFn = vi.fn()
    const undoFn = vi.fn()
    undoable('test action', doFn, undoFn)

    expect(useUndoStore.getState().undoStack).toHaveLength(0)
  })

  it('passes showSnackbar flag through', () => {
    vi.useFakeTimers()
    const doFn = vi.fn()
    const undoFn = vi.fn()
    undoable('test action', doFn, undoFn, true)

    expect(useUndoStore.getState().snackbar).toEqual({ description: 'test action' })
    vi.useRealTimers()
  })

  it('does not execute doFn itself', () => {
    const doFn = vi.fn()
    const undoFn = vi.fn()
    undoable('test action', doFn, undoFn)

    expect(doFn).not.toHaveBeenCalled()
    expect(undoFn).not.toHaveBeenCalled()
  })
})
