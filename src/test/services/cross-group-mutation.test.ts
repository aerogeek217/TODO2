import { describe, it, expect, vi } from 'vitest'
import { dispatchCrossGroupMutation } from '../../services/cross-group-mutation'
import { useTodoStore } from '../../stores/todo-store'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useUndoStore } from '../../stores/undo-store'

function stubStores() {
  const calls: string[] = []
  const rec = (name: string) => vi.fn(async (...args: unknown[]) => { calls.push(`${name}(${args.map(String).join(',')})`) })
  useTodoStore.setState({ bulkSetStatus: rec('bulkSetStatus') })
  usePersonStore.setState({ assignPerson: rec('assignPerson'), unassignPerson: rec('unassignPerson') })
  useTagStore.setState({ assignTag: rec('assignTag'), unassignTag: rec('unassignTag') })
  return calls
}

describe('dispatchCrossGroupMutation', () => {
  it('sets (or clears) the status', async () => {
    const calls = stubStores()
    await dispatchCrossGroupMutation({ kind: 'status', todoId: 4, statusId: 2 })
    await dispatchCrossGroupMutation({ kind: 'status', todoId: 4, statusId: undefined })
    expect(calls).toEqual(['bulkSetStatus(4,2)', 'bulkSetStatus(4,undefined)'])
  })

  it('replaces the person: removes the source one, then adds the target one', async () => {
    const calls = stubStores()
    await dispatchCrossGroupMutation({ kind: 'people', todoId: 4, removeId: 1, addId: 2 })
    await dispatchCrossGroupMutation({ kind: 'people', todoId: 5, removeId: null, addId: 3 })
    await dispatchCrossGroupMutation({ kind: 'people', todoId: 6, removeId: 3, addId: null })
    expect(calls).toEqual(['unassignPerson(4,1)', 'assignPerson(4,2)', 'assignPerson(5,3)', 'unassignPerson(6,3)'])
  })

  it('replaces the tag the same way', async () => {
    const calls = stubStores()
    await dispatchCrossGroupMutation({ kind: 'tag', todoId: 4, removeId: 1, addId: 2 })
    await dispatchCrossGroupMutation({ kind: 'tag', todoId: 5, removeId: null, addId: 3 })
    expect(calls).toEqual(['unassignTag(4,1)', 'assignTag(4,2)', 'assignTag(5,3)'])
  })
})

describe('dispatchCrossGroupMutation — Priority', () => {
  it('writes the flags as one marker write with its description', async () => {
    const setMarkerFlags = vi.fn(async () => {})
    useTodoStore.setState({ setMarkerFlags })
    await dispatchCrossGroupMutation({ kind: 'priority', todoId: 4, flags: { important: true, urgent: false }, description: 'Marked not urgent, important · A' })
    expect(setMarkerFlags).toHaveBeenCalledTimes(1)
    expect(setMarkerFlags).toHaveBeenCalledWith([{ todoId: 4, important: true, urgent: false }], 'Marked not urgent, important · A')
  })

  it('a failed write says so and doesn’t throw', async () => {
    useTodoStore.setState({ setMarkerFlags: vi.fn(async () => { throw new Error('disk') }) })
    await expect(dispatchCrossGroupMutation({ kind: 'priority', todoId: 4, flags: { focus: true }, description: 'Marked focus · A' })).resolves.toBeUndefined()
    expect(useUndoStore.getState().snackbar?.description).toBe('Couldn’t save: Marked focus · A. Nothing changed.')
  })
})
