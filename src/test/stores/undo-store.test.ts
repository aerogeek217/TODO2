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
    expect(state.undoStack[0]!.description).toBe('action1')
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

  it('an entry with a detail shows it as the snackbar’s second line, for as long as a notice', () => {
    useUndoStore.getState().push({ ...makeEntry('Check-in for Ann opened'), detail: 'Paste the body.' }, true)
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Check-in for Ann opened', detail: 'Paste the body.' })
    vi.advanceTimersByTime(5000)
    expect(useUndoStore.getState().snackbar).not.toBeNull()
    vi.advanceTimersByTime(3000)
    expect(useUndoStore.getState().snackbar).toBeNull()
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
    const group = store.beginGroup()
    store.push(makeEntry('a'))
    store.push(makeEntry('b'))
    store.push(makeEntry('c'))
    useUndoStore.getState().endGroup(group, 'compound')

    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(1)
    expect(state.undoStack[0]!.description).toBe('compound')
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
    const group = store.beginGroup()
    store.push(mkEntry('first'))
    store.push(mkEntry('second'))
    store.push(mkEntry('third'))
    useUndoStore.getState().endGroup(group, 'compound')

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
    const group = store.beginGroup()
    store.push(mkEntry('first'))
    store.push(mkEntry('second'))
    store.push(mkEntry('third'))
    useUndoStore.getState().endGroup(group, 'compound')

    await useUndoStore.getState().undo()
    await useUndoStore.getState().redo()

    expect(order).toEqual(['first', 'second', 'third'])
  })

  // 14. endGroup with no entries since begin -> clears groupStartIndex only
  it('endGroup with no entries since beginGroup is a no-op', () => {
    const store = useUndoStore.getState()
    const group = store.beginGroup()
    expect(useUndoStore.getState().groupStartIndex).toBe(0)

    useUndoStore.getState().endGroup(group, 'empty group')

    const state = useUndoStore.getState()
    expect(state.groupStartIndex).toBeNull()
    expect(state.undoStack).toHaveLength(0)
  })

  it('a group on a full stack still merges into one entry (pushes inside it never trim)', () => {
    const store = useUndoStore.getState()
    for (let i = 0; i < 50; i++) store.push(makeEntry(`old${i}`))
    const group = store.beginGroup()
    store.push(makeEntry('a'))
    store.push(makeEntry('b'))
    useUndoStore.getState().endGroup(group, 'compound')

    const state = useUndoStore.getState()
    expect(state.undoStack).toHaveLength(50)
    expect(state.undoStack.at(-1)!.description).toBe('compound')
    expect(state.undoStack.at(-2)!.description).toBe('old49')
    expect(state.undoStack[0]!.description).toBe('old1')
  })

  it('pushes inside a group show no snackbar; endGroup shows the group description', () => {
    const store = useUndoStore.getState()
    const group = store.beginGroup()
    store.push(makeEntry('a'), true)
    expect(useUndoStore.getState().snackbar).toBeNull()
    useUndoStore.getState().endGroup(group, 'compound', true)
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'compound' })
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
    const group = store.beginGroup()
    store.push(makeEntry('a'))
    useUndoStore.getState().endGroup(group, 'grouped action', true)

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

  it('notify shows a notice without touching the undo stack, for longer than an undo snackbar', () => {
    const entry = makeEntry('action1')
    useUndoStore.getState().push(entry, true)
    useUndoStore.getState().notify('Deleted 2 completed tasks. No backup was taken.')

    const state = useUndoStore.getState()
    expect(state.snackbar).toEqual({ description: 'Deleted 2 completed tasks. No backup was taken.', notice: true })
    expect(state.undoStack).toEqual([entry])
    vi.advanceTimersByTime(5000)
    expect(useUndoStore.getState().snackbar).not.toBeNull()
    vi.advanceTimersByTime(3000)
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('a snackbar timer only ends its own snackbar — not one shown after the store was put back', () => {
    // The test setup puts every store back to its initial state before each
    // test; a timer started earlier must not clear a later test's snackbar.
    useUndoStore.getState().notify('Earlier notice')
    useUndoStore.getState().push(makeEntry('Earlier undo'), true)
    useUndoStore.setState(useUndoStore.getInitialState(), true)
    vi.advanceTimersByTime(4000)
    useUndoStore.getState().notify('Later notice')
    vi.advanceTimersByTime(4500) // past both earlier timers, not the later one
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Later notice', notice: true })
    vi.advanceTimersByTime(4000)
    expect(useUndoStore.getState().snackbar).toBeNull()
  })

  it('an undoable push replaces a notice', () => {
    useUndoStore.getState().notify('notice')
    useUndoStore.getState().push(makeEntry('action1'), true)
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'action1' })
  })
})

describe('useUndoStore — an undo or redo that fails', () => {
  beforeEach(() => {
    useUndoStore.getState().clear()
    useUndoStore.setState({ isPerformingUndoRedo: false })
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    useUndoStore.getState().clear()
    vi.restoreAllMocks()
  })

  const makeEntry = (label: string) => ({ description: label, undo: vi.fn(), redo: vi.fn() })

  function failingEntry(label: string, failing: 'undo' | 'redo') {
    let fail = true
    const run = vi.fn(async () => { if (fail) throw new Error('write failed') })
    const ok = vi.fn()
    return {
      entry: { description: label, undo: failing === 'undo' ? run : ok, redo: failing === 'redo' ? run : ok },
      run,
      heal: () => { fail = false },
    }
  }

  it('a failed undo stays on the undo stack, tells the user and does not reject', async () => {
    const { entry, run, heal } = failingEntry('Delete "Milk"', 'undo')
    useUndoStore.getState().push(entry)

    await expect(useUndoStore.getState().undo()).resolves.toBeUndefined()
    let state = useUndoStore.getState()
    expect(state.undoStack).toEqual([entry])
    expect(state.redoStack).toEqual([])
    expect(state.isPerformingUndoRedo).toBe(false)
    expect(state.snackbar).toEqual({ description: "Couldn't undo: Delete \"Milk\"", notice: true })

    // The next try runs the same entry again and, once it works, moves it.
    heal()
    await useUndoStore.getState().undo()
    state = useUndoStore.getState()
    expect(run).toHaveBeenCalledTimes(2)
    expect(state.undoStack).toEqual([])
    expect(state.redoStack).toEqual([entry])
  })

  it('a failed redo stays on the redo stack, tells the user and does not reject', async () => {
    const { entry } = failingEntry('Add "Milk"', 'redo')
    useUndoStore.getState().push(entry)
    await useUndoStore.getState().undo()

    await expect(useUndoStore.getState().redo()).resolves.toBeUndefined()
    const state = useUndoStore.getState()
    expect(state.redoStack).toEqual([entry])
    expect(state.undoStack).toEqual([])
    expect(state.isPerformingUndoRedo).toBe(false)
    expect(state.snackbar).toEqual({ description: "Couldn't redo: Add \"Milk\"", notice: true })
  })

  it('abortGroup takes back what the group holds, newest first, and leaves no entry', async () => {
    const order: string[] = []
    const kept = { description: 'Before', undo: vi.fn(), redo: vi.fn() }
    useUndoStore.getState().push(kept)
    const group = useUndoStore.getState().beginGroup()
    for (const label of ['A', 'B']) {
      useUndoStore.getState().push({ description: label, undo: vi.fn(() => { order.push(label) }), redo: vi.fn() })
    }
    await expect(useUndoStore.getState().abortGroup(group, 'Drop')).resolves.toBe(true)
    const state = useUndoStore.getState()
    expect(order).toEqual(['B', 'A'])
    expect(state.undoStack).toEqual([kept])
    expect(state.groupStartIndex).toBeNull()
    expect(state.isPerformingUndoRedo).toBe(false)
  })

  it('abortGroup: an entry that can’t be taken back stays undoable with what is left, as one entry', async () => {
    const undoneA = vi.fn()
    const group = useUndoStore.getState().beginGroup()
    useUndoStore.getState().push({ description: 'A', undo: undoneA, redo: vi.fn() })
    useUndoStore.getState().push({ description: 'B', undo: vi.fn(async () => { throw new Error('write failed') }), redo: vi.fn() })
    useUndoStore.getState().push({ description: 'C', undo: vi.fn(), redo: vi.fn() })
    await expect(useUndoStore.getState().abortGroup(group, 'Drop')).resolves.toBe(false)
    const state = useUndoStore.getState()
    expect(state.undoStack.map((e) => e.description)).toEqual(['Drop'])
    expect(state.isPerformingUndoRedo).toBe(false)
    // C was taken back; A and B are left — undoing the entry takes them back.
    expect(undoneA).not.toHaveBeenCalled()
  })

  it('abortGroup without an open group does nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const group = useUndoStore.getState().beginGroup()
    useUndoStore.getState().endGroup(group, 'Done')
    await expect(useUndoStore.getState().abortGroup(group, 'Drop')).resolves.toBe(true)
    expect(useUndoStore.getState().undoStack).toEqual([])
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a token that is not the open group’s ends or takes back nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stale = useUndoStore.getState().beginGroup()
    useUndoStore.getState().endGroup(stale, 'First')
    const before = makeEntry('Before')
    useUndoStore.getState().push(before)
    const open = useUndoStore.getState().beginGroup()
    const inside = makeEntry('Inside')
    useUndoStore.getState().push(inside)

    useUndoStore.getState().endGroup(stale, 'Wrong')
    await expect(useUndoStore.getState().abortGroup(stale, 'Wrong')).resolves.toBe(true)
    // The open group is untouched: nothing merged, nothing taken back.
    expect(inside.undo).not.toHaveBeenCalled()
    expect(useUndoStore.getState().groupToken).toBe(open)
    expect(useUndoStore.getState().undoStack).toEqual([before, inside])
    expect(warn).toHaveBeenCalledTimes(2)

    useUndoStore.getState().endGroup(open, 'Right')
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Before', 'Right'])
    warn.mockRestore()
  })

  describe('runGroup', () => {
    beforeEach(() => { vi.useRealTimers() })

    it('ends the group as one entry with the snackbar, named when it ends', async () => {
      let count = 0
      await useUndoStore.getState().runGroup(() => `Applied ${count}`, async () => {
        useUndoStore.getState().push(makeEntry('a'), true)
        count++
        useUndoStore.getState().push(makeEntry('b'), true)
        count++
      })
      const state = useUndoStore.getState()
      expect(state.undoStack.map((e) => e.description)).toEqual(['Applied 2'])
      expect(state.snackbar).toEqual({ description: 'Applied 2' })
      expect(state.groupToken).toBeNull()
    })

    it('a group that throws still ends as one entry, and the error reaches the caller', async () => {
      const run = useUndoStore.getState().runGroup('Partial', async () => {
        useUndoStore.getState().push(makeEntry('a'))
        throw new Error('write failed')
      })
      await expect(run).rejects.toThrow('write failed')
      expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Partial'])
      expect(useUndoStore.getState().groupToken).toBeNull()
    })

    it('groups started together run one after the other: each its own entry, and a group’s abort takes back only its own', async () => {
      let releaseFirst!: () => void
      const firstHeld = new Promise<void>((r) => { releaseFirst = r })
      const firstA = makeEntry('first a')
      const secondA = makeEntry('second a')
      const first = useUndoStore.getState().runGroup('First', async () => {
        useUndoStore.getState().push(firstA)
        await firstHeld
      })
      const second = useUndoStore.getState().runGroup('Second', async (group) => {
        useUndoStore.getState().push(secondA)
        await useUndoStore.getState().abortGroup(group, 'Second')
      })
      // The second hasn't started while the first is held open.
      await Promise.resolve()
      expect(secondA.undo).not.toHaveBeenCalled()
      expect(useUndoStore.getState().undoStack).toEqual([firstA])
      releaseFirst()
      await Promise.all([first, second])
      expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['First'])
      expect(firstA.undo).not.toHaveBeenCalled()
      expect(secondA.undo).toHaveBeenCalledTimes(1)
    })

    it('a group that failed doesn’t stop the next', async () => {
      const failed = useUndoStore.getState().runGroup('Bad', async () => { throw new Error('boom') })
      const next = useUndoStore.getState().runGroup('Good', async () => { useUndoStore.getState().push(makeEntry('x')) })
      await expect(failed).rejects.toThrow('boom')
      await next
      expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Good'])
    })
  })

  it('a failed undo goes back where it was: an entry pushed meanwhile stays on top', async () => {
    let fail!: () => void
    const gate = new Promise<void>((r) => { fail = r })
    const failing = { description: 'Slow', undo: vi.fn(async () => { await gate; throw new Error('write failed') }), redo: vi.fn() }
    const later = { description: 'Later', undo: vi.fn(), redo: vi.fn() }
    useUndoStore.getState().push(failing)
    const undoing = useUndoStore.getState().undo()
    useUndoStore.getState().push(later)
    fail()
    await undoing
    expect(useUndoStore.getState().undoStack.map((e) => e.description)).toEqual(['Slow', 'Later'])
  })
})
