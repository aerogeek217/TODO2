import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useUndoStore } from '../../stores/undo-store'

describe('useUndoStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useUndoStore.setState({
      undoStack: [],
      redoStack: [],
      isPerformingUndoRedo: false,
      groupStartIndex: null,
      snackbar: null,
      snackbarTimerId: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeEntry(label: string) {
    return {
      description: label,
      undo: vi.fn(),
      redo: vi.fn(),
    }
  }

  // 1. push: adds to undoStack, clears redoStack
  it('push adds entry to undoStack and clears redoStack', () => {
    const store = useUndoStore.getState()
    const entry = makeEntry('action1')

    // Seed a redo entry
    useUndoStore.setState({ redoStack: [makeEntry('old')] })
    store.push(entry)

    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(1)
    expect(state.undoStack[0]).toBe(entry)
    expect(state.redoStack).toHaveLength(0)
  })

  // 2. push: trims at MAX_STACK_SIZE (50)
  it('push trims undoStack to MAX_STACK_SIZE (50)', () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry(`action${i}`))
    useUndoStore.setState({ undoStack: entries })

    const newEntry = makeEntry('action50')
    useUndoStore.getState().push(newEntry)

    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(50)
    // First entry should have been trimmed
    expect(state.undoStack[0].description).toBe('action1')
    expect(state.undoStack[49]).toBe(newEntry)
  })

  // 3. push with showSnackbar: sets snackbar + timer
  it('push with showSnackbar sets snackbar and auto-dismiss timer', () => {
    const entry = makeEntry('deleted item')
    useUndoStore.getState().push(entry, true)

    const state = useUndoStore.getState()
    expect(state.snackbar).toEqual({ description: 'deleted item' })
    expect(state.snackbarTimerId).not.toBeNull()

    // Timer auto-dismisses after 5000ms
    vi.advanceTimersByTime(5000)
    const after = useUndoStore.getState()
    expect(after.snackbar).toBeNull()
    expect(after.snackbarTimerId).toBeNull()
  })

  // 4. push without showSnackbar: no snackbar change
  it('push without showSnackbar does not set snackbar', () => {
    useUndoStore.getState().push(makeEntry('quiet'))

    const state = useUndoStore.getState()
    expect(state.snackbar).toBeNull()
    expect(state.snackbarTimerId).toBeNull()
  })

  // 5. undo: calls entry.undo(), moves entry to redoStack
  it('undo calls entry.undo and moves entry to redoStack', async () => {
    const entry = makeEntry('action1')
    useUndoStore.getState().push(entry)

    await useUndoStore.getState().undo()

    expect(entry.undo).toHaveBeenCalledOnce()
    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(0)
    expect(state.redoStack).toHaveLength(1)
    expect(state.redoStack[0]).toBe(entry)
  })

  // 6. undo: empty stack -> no-op
  it('undo with empty stack is a no-op', async () => {
    await useUndoStore.getState().undo()
    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(0)
    expect(state.redoStack).toHaveLength(0)
  })

  // 7. undo: sets isPerformingUndoRedo during execution
  it('undo sets isPerformingUndoRedo during execution and resets after', async () => {
    let flagDuringUndo = false
    const entry = {
      description: 'check flag',
      undo: vi.fn(() => {
        flagDuringUndo = useUndoStore.getState().isPerformingUndoRedo
      }),
      redo: vi.fn(),
    }
    useUndoStore.getState().push(entry)

    await useUndoStore.getState().undo()

    expect(flagDuringUndo).toBe(true)
    expect(useUndoStore.getState().isPerformingUndoRedo).toBe(false)
  })

  // 8. redo: calls entry.redo(), moves entry to undoStack
  it('redo calls entry.redo and moves entry to undoStack', async () => {
    const entry = makeEntry('action1')
    useUndoStore.getState().push(entry)
    await useUndoStore.getState().undo()

    await useUndoStore.getState().redo()

    expect(entry.redo).toHaveBeenCalledOnce()
    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(1)
    expect(state.undoStack[0]).toBe(entry)
    expect(state.redoStack).toHaveLength(0)
  })

  // 9. redo: empty stack -> no-op
  it('redo with empty stack is a no-op', async () => {
    await useUndoStore.getState().redo()
    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(0)
    expect(state.redoStack).toHaveLength(0)
  })

  // 10. redo: sets/resets isPerformingUndoRedo
  it('redo sets isPerformingUndoRedo during execution and resets after', async () => {
    let flagDuringRedo = false
    const entry = {
      description: 'check flag',
      undo: vi.fn(),
      redo: vi.fn(() => {
        flagDuringRedo = useUndoStore.getState().isPerformingUndoRedo
      }),
    }
    useUndoStore.getState().push(entry)
    await useUndoStore.getState().undo()

    await useUndoStore.getState().redo()

    expect(flagDuringRedo).toBe(true)
    expect(useUndoStore.getState().isPerformingUndoRedo).toBe(false)
  })

  // 11. beginGroup + entries + endGroup: merges into compound entry
  it('beginGroup/endGroup merges entries into a single compound entry', () => {
    const store = useUndoStore.getState()
    store.beginGroup()
    store.push(makeEntry('a'))
    store.push(makeEntry('b'))
    store.push(makeEntry('c'))
    useUndoStore.getState().endGroup('compound')

    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(1)
    expect(state.undoStack[0].description).toBe('compound')
    expect(state.groupStartIndex).toBeNull()
  })

  // 12. Compound undo calls individual undos in reverse order
  it('compound entry undo calls sub-entries in reverse order', async () => {
    const order: string[] = []
    const mkEntry = (label: string) => ({
      description: label,
      undo: vi.fn(() => { order.push(label) }),
      redo: vi.fn(),
    })

    const store = useUndoStore.getState()
    store.beginGroup()
    store.push(mkEntry('first'))
    store.push(mkEntry('second'))
    store.push(mkEntry('third'))
    useUndoStore.getState().endGroup('compound')

    await useUndoStore.getState().undo()

    expect(order).toEqual(['third', 'second', 'first'])
  })

  // 13. Compound redo calls individual redos in forward order
  it('compound entry redo calls sub-entries in forward order', async () => {
    const order: string[] = []
    const mkEntry = (label: string) => ({
      description: label,
      undo: vi.fn(),
      redo: vi.fn(() => { order.push(label) }),
    })

    const store = useUndoStore.getState()
    store.beginGroup()
    store.push(mkEntry('first'))
    store.push(mkEntry('second'))
    store.push(mkEntry('third'))
    useUndoStore.getState().endGroup('compound')

    await useUndoStore.getState().undo()
    await useUndoStore.getState().redo()

    expect(order).toEqual(['first', 'second', 'third'])
  })

  // 14. endGroup with no entries since begin -> clears groupStartIndex only
  it('endGroup with no entries since beginGroup is a no-op', () => {
    const store = useUndoStore.getState()
    store.beginGroup()
    expect(useUndoStore.getState().groupStartIndex).toBe(0)

    useUndoStore.getState().endGroup('empty group')

    const state = useUndoStore.getState()
    expect(state.groupStartIndex).toBeNull()
    expect(state.undoStack).toHaveLength(0)
  })

  // 15. canUndo/canRedo report based on stack contents
  it('canUndo returns true when undoStack has entries', () => {
    expect(useUndoStore.getState().canUndo()).toBe(false)
    useUndoStore.getState().push(makeEntry('x'))
    expect(useUndoStore.getState().canUndo()).toBe(true)
  })

  it('canRedo returns true when redoStack has entries', async () => {
    expect(useUndoStore.getState().canRedo()).toBe(false)
    useUndoStore.getState().push(makeEntry('x'))
    await useUndoStore.getState().undo()
    expect(useUndoStore.getState().canRedo()).toBe(true)
  })

  // 16. dismissSnackbar clears snackbar and timer
  it('dismissSnackbar clears snackbar and cancels timer', () => {
    useUndoStore.getState().push(makeEntry('action'), true)
    expect(useUndoStore.getState().snackbar).not.toBeNull()

    useUndoStore.getState().dismissSnackbar()

    const state = useUndoStore.getState()
    expect(state.snackbar).toBeNull()
    expect(state.snackbarTimerId).toBeNull()
  })

  // 17. endGroup with showSnackbar sets snackbar
  it('endGroup with showSnackbar sets snackbar', () => {
    const store = useUndoStore.getState()
    store.beginGroup()
    store.push(makeEntry('a'))
    useUndoStore.getState().endGroup('grouped action', true)

    const state = useUndoStore.getState()
    expect(state.snackbar).toEqual({ description: 'grouped action' })
    expect(state.snackbarTimerId).not.toBeNull()
  })

  // 18. Rapid undo preserves redo entries
  it('rapid sequential undos preserve all redo entries', async () => {
    const undos: string[] = []
    useUndoStore.getState().push({
      description: 'a',
      undo: async () => { undos.push('a') },
      redo: async () => {},
    })
    useUndoStore.getState().push({
      description: 'b',
      undo: async () => { undos.push('b') },
      redo: async () => {},
    })
    useUndoStore.getState().push({
      description: 'c',
      undo: async () => { undos.push('c') },
      redo: async () => {},
    })

    // Undo all three sequentially
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()
    await useUndoStore.getState().undo()

    expect(undos).toEqual(['c', 'b', 'a'])
    expect(useUndoStore.getState().undoStack).toHaveLength(0)
    expect(useUndoStore.getState().redoStack).toHaveLength(3)
  })

  // 19. push clears previous snackbar timer when setting a new one
  it('push with showSnackbar clears previous snackbar timer', () => {
    useUndoStore.getState().push(makeEntry('first'), true)
    const firstTimerId = useUndoStore.getState().snackbarTimerId

    useUndoStore.getState().push(makeEntry('second'), true)
    const secondTimerId = useUndoStore.getState().snackbarTimerId

    expect(secondTimerId).not.toBe(firstTimerId)
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'second' })

    // Only the second timer should fire; advancing should not cause issues
    vi.advanceTimersByTime(5000)
    expect(useUndoStore.getState().snackbar).toBeNull()
  })
})
