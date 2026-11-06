import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { db } from '../../data/database'
import { settingsRepository } from '../../data'
import { settingWriter, type SettingSpec } from '../../stores/setting-writes'
import { useUndoStore } from '../../stores/undo-store'
import { resetModuleState } from '../../utils/module-reset'

// A store of two settings: `word` (one row, `t.word`, gone at its default
// '') and `pair` (two rows written together).
interface TestState { word: string; left: number; right: number }
const useTestStore = create<TestState>(() => ({ word: '', left: 0, right: 0 }))

const shown = vi.fn()
const wordSpec: SettingSpec<TestState, 'word'> = {
  fields: ['word'],
  read: (rows) => ({ word: rows.get('t.word') ?? '' }),
  rows: ({ word }) => ({ 't.word': word === '' ? null : word }),
  label: 'the word',
  failure: 'Couldn’t save the word.',
  undo: ({ word }) => `Word “${word}”`,
  shown: () => shown(useTestStore.getState().word),
}
const pairSpec: SettingSpec<TestState, 'left' | 'right'> = {
  fields: ['left', 'right'],
  read: (rows) => ({ left: Number(rows.get('t.left') ?? 0), right: Number(rows.get('t.right') ?? 0) }),
  rows: ({ left, right }) => ({ 't.left': String(left), 't.right': String(right) }),
  label: 'the pair',
}

const stored = async (key: string) => (await db.settings.get(key))?.value
const undoNames = () => useUndoStore.getState().undoStack.map((e) => e.description)
/** A save that waits until `fail()` / `pass()` is called. */
function holdPut() {
  const held: { fail?: () => void; pass?: () => void } = {}
  vi.spyOn(settingsRepository, 'put').mockImplementationOnce((key, value) => new Promise((resolve, reject) => {
    held.fail = () => reject(new Error('disk full'))
    held.pass = () => { void db.settings.put({ key, value }).then(() => resolve()) }
  }))
  return held
}

let word: ReturnType<typeof settingWriter<TestState, 'word'>>
let pair: ReturnType<typeof settingWriter<TestState, 'left' | 'right'>>

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTestStore.setState({ word: '', left: 0, right: 0 })
  shown.mockClear()
  word = settingWriter(useTestStore, wordSpec)
  pair = settingWriter(useTestStore, pairSpec)
})

afterEach(() => { vi.restoreAllMocks() })

describe('settingWriter', () => {
  it('shows the value at once, saves it, and makes it one undo step with the snackbar; undo / redo save and show', async () => {
    const saving = word.write({ word: 'one' })
    expect(useTestStore.getState().word).toBe('one')
    expect(shown).toHaveBeenLastCalledWith('one')
    expect(await saving).toBe(true)
    expect(await stored('t.word')).toBe('one')
    expect(undoNames()).toEqual(['Word “one”'])
    expect(useUndoStore.getState().snackbar?.description).toBe('Word “one”')

    await useUndoStore.getState().undo()
    expect(useTestStore.getState().word).toBe('')
    expect(shown).toHaveBeenLastCalledWith('')
    expect(await stored('t.word')).toBeUndefined()
    // Undoing records nothing new.
    expect(undoNames()).toEqual([])
    await useUndoStore.getState().redo()
    expect(useTestStore.getState().word).toBe('one')
    expect(await stored('t.word')).toBe('one')
    expect(undoNames()).toEqual(['Word “one”'])
  })

  it('the same value again writes nothing and resolves true', async () => {
    await word.write({ word: 'one' })
    const put = vi.spyOn(settingsRepository, 'put')
    expect(await word.write({ word: 'one' })).toBe(true)
    expect(put).not.toHaveBeenCalled()
    expect(undoNames()).toEqual(['Word “one”'])
  })

  it('a failed save puts the value back, adds no step and says so', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put').mockRejectedValueOnce(new Error('disk full'))
    expect(await word.write({ word: 'one' })).toBe(false)
    expect(useTestStore.getState().word).toBe('')
    expect(shown).toHaveBeenLastCalledWith('')
    expect(undoNames()).toEqual([])
    expect(useUndoStore.getState().snackbar).toEqual({ description: 'Couldn’t save the word.', notice: true })
  })

  it('a spec without a failure notice and an undo name only logs and records nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'writeMany').mockRejectedValueOnce(new Error('disk full'))
    expect(await pair.write({ left: 1, right: 2 })).toBe(false)
    expect(useTestStore.getState()).toMatchObject({ left: 0, right: 0 })
    expect(error).toHaveBeenCalledWith('Failed to save the pair:', expect.any(Error))
    expect(useUndoStore.getState().snackbar).toBeNull()
    expect(await pair.write({ left: 1, right: 2 })).toBe(true)
    expect(undoNames()).toEqual([])
  })

  it('several rows go in one transaction: a failure leaves none saved', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const realPut = db.settings.put.bind(db.settings)
    let calls = 0
    vi.spyOn(db.settings, 'put').mockImplementation(((row: { key: string; value: string }) => {
      calls++
      return calls === 1 ? realPut(row) : Promise.reject(new Error('disk full'))
    }) as never)
    expect(await pair.write({ left: 1, right: 2 })).toBe(false)
    expect(calls).toBe(2)
    expect(await stored('t.left')).toBeUndefined()
    expect(await stored('t.right')).toBeUndefined()
  })

  it('a write’s own description makes an undo step; record: false makes none', async () => {
    await pair.write({ left: 1, right: 1 }, { description: 'Moved both' })
    expect(undoNames()).toEqual(['Moved both'])
    await word.write({ word: 'quiet' }, { record: false })
    expect(undoNames()).toEqual(['Moved both'])
    await useUndoStore.getState().undo()
    expect(useTestStore.getState()).toMatchObject({ left: 0, right: 0, word: 'quiet' })
  })

  it('a failed save keeps a value set since by someone else (a reload)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const held = holdPut()
    const saving = word.write({ word: 'one' })
    await vi.waitFor(() => expect(held.fail).toBeDefined())
    useTestStore.setState({ word: 'reloaded' })
    held.fail?.()
    expect(await saving).toBe(false)
    expect(useTestStore.getState().word).toBe('reloaded')
  })

  it('writes are saved one after another: an earlier one failing late leaves the later one shown, saved and undoable to the value saved before', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const held = holdPut()
    const put = vi.spyOn(settingsRepository, 'put')
    const first = word.write({ word: 'one' })
    const second = word.write({ word: 'two' })
    expect(useTestStore.getState().word).toBe('two')
    await vi.waitFor(() => expect(held.fail).toBeDefined())
    // The second waits for the first's save.
    expect(put).toHaveBeenCalledTimes(1)
    held.fail?.()
    expect(await first).toBe(false)
    expect(await second).toBe(true)
    expect(useTestStore.getState().word).toBe('two')
    expect(await stored('t.word')).toBe('two')
    expect(undoNames()).toEqual(['Word “two”'])
    await useUndoStore.getState().undo()
    expect(useTestStore.getState().word).toBe('')
    expect(await stored('t.word')).toBeUndefined()
  })

  it('the last of several writes failing shows the value saved before it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'put')
      .mockImplementationOnce(async (key, value) => { await db.settings.put({ key, value }) })
      .mockRejectedValueOnce(new Error('disk full'))
    const first = word.write({ word: 'one' })
    const second = word.write({ word: 'two' })
    expect(await first).toBe(true)
    expect(await second).toBe(false)
    expect(useTestStore.getState().word).toBe('one')
    expect(await stored('t.word')).toBe('one')
    expect(undoNames()).toEqual(['Word “one”'])
  })

  it('a late earlier save that succeeds never overwrites a later one', async () => {
    const held = holdPut()
    const first = word.write({ word: 'one' })
    const second = word.write({ word: 'two' })
    await vi.waitFor(() => expect(held.pass).toBeDefined())
    held.pass?.()
    await Promise.all([first, second])
    expect(useTestStore.getState().word).toBe('two')
    expect(await stored('t.word')).toBe('two')
    expect(undoNames()).toEqual(['Word “one”', 'Word “two”'])
  })

  it('writes with the same merge key in a row are one undo step without the snackbar; typed back to the start, the step goes', async () => {
    await word.write({ word: 'o' }, { mergeKey: 'name' })
    await word.write({ word: 'on' }, { mergeKey: 'name' })
    expect(undoNames()).toEqual(['Word “o”'])
    expect(useUndoStore.getState().snackbar).toBeNull()
    await useUndoStore.getState().undo()
    expect(useTestStore.getState().word).toBe('')
    await useUndoStore.getState().redo()
    expect(useTestStore.getState().word).toBe('on')

    await word.write({ word: 'onX' }, { mergeKey: 'name2' })
    await word.write({ word: 'on' }, { mergeKey: 'name2' })
    expect(undoNames()).toEqual(['Word “o”'])
    // Another write ends the run.
    await word.write({ word: 'a' }, { mergeKey: 'name2' })
    await word.write({ word: 'b' })
    await word.write({ word: 'bc' }, { mergeKey: 'name2' })
    expect(undoNames()).toEqual(['Word “o”', 'Word “a”', 'Word “b”', 'Word “bc”'])
  })

  it('an undo whose save fails stays on its stack and says so', async () => {
    await word.write({ word: 'one' })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(settingsRepository, 'delete').mockRejectedValueOnce(new Error('disk full'))
    await useUndoStore.getState().undo()
    expect(useTestStore.getState().word).toBe('one')
    expect(undoNames()).toEqual(['Word “one”'])
    expect(useUndoStore.getState().snackbar).toEqual({ description: "Couldn't undo: Word “one”", notice: true })
  })

  it('a write left in flight by the module reset settles without touching the new state', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const held = holdPut()
    const saving = word.write({ word: 'one' })
    await vi.waitFor(() => expect(held.fail).toBeDefined())
    resetModuleState()
    useUndoStore.getState().clear()
    useTestStore.setState({ word: 'fresh' })
    held.fail?.()
    expect(await saving).toBe(false)
    expect(useTestStore.getState().word).toBe('fresh')
    expect(useUndoStore.getState().snackbar).toBeNull()
    // The next write isn't queued behind the old one.
    expect(await word.write({ word: 'next' })).toBe(true)
    expect(await stored('t.word')).toBe('next')
  })
})
