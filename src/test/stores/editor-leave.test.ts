import { describe, it, expect, vi } from 'vitest'
import { afterLeavingEditors, editorsHoldChanges, leaveOpenEditors, registerOpenEditor } from '../../stores/editor-leave'

const editor = (changed: boolean, answer: boolean) => ({ changed: () => changed, ask: vi.fn(() => Promise.resolve(answer)) })

describe('editor-leave: nothing leaves an editor with changes without its question', () => {
  it('no editor, or none with changes: runs at once, asking nothing', () => {
    const run = vi.fn()
    afterLeavingEditors(run)
    expect(run).toHaveBeenCalledTimes(1)
    const clean = editor(false, true)
    const off = registerOpenEditor(clean)
    afterLeavingEditors(run)
    expect(run).toHaveBeenCalledTimes(2)
    expect(clean.ask).not.toHaveBeenCalled()
    expect(editorsHoldChanges()).toBe(false)
    off()
  })

  it('one with changes is asked; Save / Discard run it after, Keep editing never', async () => {
    const run = vi.fn()
    const dirty = editor(true, false)
    const off = registerOpenEditor(dirty)
    expect(editorsHoldChanges()).toBe(true)
    afterLeavingEditors(run)
    expect(run).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(dirty.ask).toHaveBeenCalled())
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()
    off()

    const left = editor(true, true)
    const off2 = registerOpenEditor(left)
    afterLeavingEditors(run)
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    off2()
  })

  it('asks each editor holding changes in turn, stopping at the first Keep editing', async () => {
    const a = editor(true, false)
    const b = editor(true, true)
    const offA = registerOpenEditor(a)
    const offB = registerOpenEditor(b)
    expect(await leaveOpenEditors()).toBe(false)
    expect(b.ask).not.toHaveBeenCalled()
    offA()
    expect(await leaveOpenEditors()).toBe(true)
    offB()
  })
})
