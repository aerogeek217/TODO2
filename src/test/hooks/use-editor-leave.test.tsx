import { describe, it, expect, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useEditorLeave } from '../../hooks/use-editor-leave'
import { editorsHoldChanges, leaveOpenEditors } from '../../stores/editor-leave'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'

/**
 * An editor's leave question when its Save says how the write went (cr34 D6,
 * the hook's half): a save that didn't land leaves the editor open with its
 * changes, so whatever asked from outside — Settings, a layout switch,
 * another editor — doesn't carry on. A save that returns nothing is as
 * before.
 */

const DROPPED = 'Edit list closed: its changes to “Team” weren’t saved.'

/** A fake editor holding changes, with `save` as given; its `closed` flips when Save or Discard closes it. */
function editor(save: () => void | Promise<boolean>) {
  const state = { closed: false }
  const changedRef = { current: true }
  const hook = renderHook(() => useEditorLeave({
    changedRef,
    title: 'Save changes to list “Team”?',
    save,
    discard: () => { state.closed = true; changedRef.current = false },
    dropped: DROPPED,
  }))
  return { ...hook, state, changedRef }
}

const answer = (a: 'confirm' | 'discard' | 'cancel') => act(async () => { useUIStore.getState().answerConfirmation(a) })
const question = () => useUIStore.getState().confirmPrompts[0]

describe('useEditorLeave: a Save that reports its write', () => {
  it('a save that returns nothing: Save resolves the question true at once, as before', async () => {
    const save = vi.fn()
    editor(save)
    const left = leaveOpenEditors()
    expect(question()?.title).toBe('Save changes to list “Team”?')
    await answer('confirm')
    expect(await left).toBe(true)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('a save whose write fails (resolves false): the question resolves false, and the editor still counts as holding unsaved changes', async () => {
    const notify = vi.spyOn(useUndoStore.getState(), 'notify')
    let landed!: (ok: boolean) => void
    const save = vi.fn(() => new Promise<boolean>((resolve) => { landed = resolve }))
    const e = editor(save)
    const left = leaveOpenEditors()
    let settledAs: boolean | undefined
    void left.then((ok) => { settledAs = ok })
    await answer('confirm')
    expect(save).toHaveBeenCalledTimes(1)
    // The write is still in flight: the leave waits for it, and a second ask gets the same answer (no second question).
    expect(settledAs).toBeUndefined()
    const again = e.result.current.ask()
    expect(question()).toBeUndefined()
    expect(e.result.current.requestClose()).toBe(true)
    await act(async () => { landed(false) })
    expect(await left).toBe(false)
    expect(await again).toBe(false)
    // Still open, still changed: the rule still sees it, and closing it from outside says its changes weren't saved.
    expect(editorsHoldChanges()).toBe(true)
    e.unmount()
    expect(notify).toHaveBeenCalledWith(DROPPED)
  })

  it('a save whose write lands (resolves true): the question resolves true once it has, and closing drops nothing', async () => {
    const notify = vi.spyOn(useUndoStore.getState(), 'notify')
    let landed!: (ok: boolean) => void
    const e = editor(() => new Promise<boolean>((resolve) => { landed = resolve }))
    const left = leaveOpenEditors()
    await answer('confirm')
    await act(async () => { landed(true) })
    expect(await left).toBe(true)
    e.unmount()
    expect(notify).not.toHaveBeenCalled()
  })

  it('a save that rejects is a save that failed', async () => {
    editor(() => Promise.reject(new Error('the write failed')))
    const left = leaveOpenEditors()
    await answer('confirm')
    expect(await left).toBe(false)
  })

  it('the footer’s Save with a write that fails: a later close from outside still says the changes weren’t saved', async () => {
    const notify = vi.spyOn(useUndoStore.getState(), 'notify')
    const e = editor(() => Promise.resolve(false))
    await act(async () => { e.result.current.save() })
    e.unmount()
    expect(notify).toHaveBeenCalledWith(DROPPED)
  })

  it('Discard and Keep editing are as before', async () => {
    const save = vi.fn(() => Promise.resolve(true))
    const e = editor(save)
    const kept = leaveOpenEditors()
    await answer('cancel')
    expect(await kept).toBe(false)
    expect(e.state.closed).toBe(false)
    const left = leaveOpenEditors()
    await answer('discard')
    expect(await left).toBe(true)
    expect(e.state.closed).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })
})
