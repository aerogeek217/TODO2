import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layoutRepository } from '../../data/layout-repository'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createTab } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { emptyBody, single } from '../helpers/layout-builders'

/**
 * A layout switch's `show` (cr34 H4): the read and the writes are awaited
 * first, and the change on screen is one synchronous step handed to `show` —
 * what a view transition wraps. Before, the whole switch ran inside the
 * transition, whose update freezes the page and loses every press made
 * while it runs.
 */

const T0 = new Date('2026-09-01T09:00:00.000Z')
const ws = () => useWorkspaceStore.getState()

async function twoLayouts(): Promise<{ plain: number; other: number }> {
  const plain = await layoutRepository.insert({
    name: 'Plain', createdAt: T0, modifiedAt: T0,
    ...single({ id: 'kp', activeTabId: 'p1', tabs: [createTab('notes', 'p1')] }),
  })
  const other = await layoutRepository.insert({ name: 'Second', createdAt: T0, modifiedAt: T0, ...emptyBody() })
  await layoutRepository.setActiveId(plain)
  await ws().init()
  return { plain, other }
}

beforeEach(async () => {
  await resetDb()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace-store.load with a `show`', () => {
  it('runs the writes first, then hands `show` one synchronous step that opens the layout', async () => {
    const { plain, other } = await twoLayouts()
    const touch = vi.spyOn(layoutRepository, 'touch')
    const setActiveId = vi.spyOn(layoutRepository, 'setActiveId')
    const seen: Array<{ written: boolean; openBefore: number | null; openAfter: number | null; returned: unknown }> = []
    await ws().load(other, (apply) => {
      const written = touch.mock.calls.length === 1 && setActiveId.mock.calls.length === 1
      const openBefore = ws().activeLayoutId
      const returned: unknown = apply()
      seen.push({ written, openBefore, openAfter: ws().activeLayoutId, returned })
    })
    // Called once, after both writes; `apply` is synchronous (it returns nothing to wait for).
    expect(seen).toEqual([{ written: true, openBefore: plain, openAfter: other, returned: undefined }])
    expect(ws().working?.id).toBe(other)
    expect(await layoutRepository.getActiveId()).toBe(other)
  })

  it('waits for what `show` returns before it resolves', async () => {
    const { other } = await twoLayouts()
    let release: () => void = () => {}
    const shown = new Promise<void>((resolve) => { release = resolve })
    let resolved = false
    const loading = ws().load(other, (apply) => shown.then(apply)).then(() => { resolved = true })
    // Let the switch's own awaits run: it is then waiting on `show`, the old layout still open.
    await vi.waitFor(() => expect(layoutRepository.getActiveId()).resolves.toBe(other))
    expect(resolved).toBe(false)
    expect(ws().activeLayoutId).not.toBe(other)
    release()
    await loading
    expect(ws().activeLayoutId).toBe(other)
  })

  it('a switch whose write fails never calls `show`: the open layout stays', async () => {
    const { plain, other } = await twoLayouts()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(layoutRepository, 'touch').mockRejectedValue(new Error('full'))
    const show = vi.fn((apply: () => void) => apply())
    await ws().load(other, show)
    expect(show).not.toHaveBeenCalled()
    expect(ws().activeLayoutId).toBe(plain)
  })

  it('the layout that is open already: nothing to show, nothing asked of `show` but the same step', async () => {
    const { plain } = await twoLayouts()
    const show = vi.fn((apply: () => void) => apply())
    await ws().load(plain, show)
    expect(show).toHaveBeenCalledTimes(1)
    expect(ws().activeLayoutId).toBe(plain)
  })

  it('without `show` the layout just opens', async () => {
    const { other } = await twoLayouts()
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(other)
  })
})
