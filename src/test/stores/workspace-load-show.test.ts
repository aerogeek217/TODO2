import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { layoutRepository } from '../../data/layout-repository'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { createTab } from '../../models/workspace-layout'
import { resetDb } from '../helpers'
import { emptyBody, single } from '../helpers/layout-builders'

/**
 * A layout switch (`workspace-store.load`): the read and the writes are
 * awaited first, then the new layout is put on screen in one synchronous
 * step. No view transition wraps it (cr34 answer 26: a transition froze the
 * page and lost presses while the new layout mounted; `e2e/layout-switch-presses`).
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

describe('workspace-store.load', () => {
  it('runs the writes first, then opens the layout', async () => {
    const { plain, other } = await twoLayouts()
    const touch = vi.spyOn(layoutRepository, 'touch')
    const setActiveId = vi.spyOn(layoutRepository, 'setActiveId')
    const seen: Array<{ open: number | null; written: boolean }> = []
    const unsubscribe = useWorkspaceStore.subscribe((s, prev) => {
      if (s.activeLayoutId !== prev.activeLayoutId) {
        seen.push({ open: s.activeLayoutId, written: touch.mock.calls.length === 1 && setActiveId.mock.calls.length === 1 })
      }
    })
    expect(ws().activeLayoutId).toBe(plain)
    await ws().load(other)
    unsubscribe()
    // One change on screen, after both writes.
    expect(seen).toEqual([{ open: other, written: true }])
    expect(ws().working?.id).toBe(other)
    expect(await layoutRepository.getActiveId()).toBe(other)
  })

  it('a switch whose write fails leaves the open layout as it was', async () => {
    const { plain, other } = await twoLayouts()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(layoutRepository, 'touch').mockRejectedValue(new Error('full'))
    await ws().load(other)
    expect(ws().activeLayoutId).toBe(plain)
  })

  it('the layout that is open already opens again in place', async () => {
    const { plain } = await twoLayouts()
    await ws().load(plain)
    expect(ws().activeLayoutId).toBe(plain)
  })
})
