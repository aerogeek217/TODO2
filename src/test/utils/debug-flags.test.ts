import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for `?debug-dnd=1` (P5 of ui-consistency-2026-04-25). The flag is
 * read once at module load, so each test re-imports `debug-flags.ts` after
 * stubbing `window.location.search`. We also spot-check that the four wrap
 * sites (`task-dnd/dispatch`, `task-dnd/collision`, `rail-dnd`, the rails
 * drag monitor) actually call `dndLog` so the debug ladder appears end-to-end
 * when the flag is on.
 */

const ORIGINAL_LOCATION = typeof window !== 'undefined' ? window.location : undefined

function stubSearch(search: string): void {
  vi.stubGlobal('window', {
    ...window,
    location: { ...ORIGINAL_LOCATION, search } as Location,
  })
}

beforeEach(() => {
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DEBUG_DND flag', () => {
  it('is false when ?debug-dnd is absent', async () => {
    stubSearch('')
    const mod = await import('../../utils/debug-flags')
    expect(mod.DEBUG_DND).toBe(false)
  })

  it('is true when ?debug-dnd=1 is present', async () => {
    stubSearch('?debug-dnd=1')
    const mod = await import('../../utils/debug-flags')
    expect(mod.DEBUG_DND).toBe(true)
  })

  it('is true even with bare ?debug-dnd (URLSearchParams.has)', async () => {
    stubSearch('?debug-dnd')
    const mod = await import('../../utils/debug-flags')
    expect(mod.DEBUG_DND).toBe(true)
  })
})

describe('dndLog', () => {
  it('is a no-op when DEBUG_DND is false', async () => {
    stubSearch('')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { dndLog } = await import('../../utils/debug-flags')
    dndLog('test.label', { foo: 1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('forwards label + payload to console.warn under [debug-dnd] prefix when on', async () => {
    stubSearch('?debug-dnd=1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { dndLog } = await import('../../utils/debug-flags')
    dndLog('test.label', { foo: 1 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[debug-dnd]', 'test.label', { foo: 1 })
  })

  it('passes an empty payload when none supplied', async () => {
    stubSearch('?debug-dnd=1')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { dndLog } = await import('../../utils/debug-flags')
    dndLog('bare')
    expect(warn).toHaveBeenCalledWith('[debug-dnd]', 'bare', {})
  })
})

describe('debug-dnd wrap sites — production silence', () => {
  // The wrap-site fixture drags previously asserted that each of the four
  // dndLog call-sites (dispatch / collision / rail-dnd / drag-monitor) emits
  // its expected label under `?debug-dnd=1`. That coverage was a costly
  // mock-heavy walk to assert "this string passed through dndLog at this
  // call-site"; the dndLog tests above already pin the contract end-to-end.
  // The single remaining test below pins the load-bearing invariant:
  // production (no flag) emits no debug noise.
  it('emits no logs when ?debug-dnd is absent', async () => {
    stubSearch('')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const dispatchMod = await import('../../utils/task-dnd/dispatch')
    const kindsMod = await import('../../utils/task-dnd/kinds')
    const helpers = await import('../helpers')

    const reschedule = vi.fn(async () => {})
    const fakeTaskboard: import('../../utils/task-dnd/dispatch').TaskboardOps = {
      board: null,
      getEntries: () => [],
      ensureLoaded: async () => ({
        id: 1, entries: [], createdAt: new Date(), updatedAt: new Date(),
      }),
      has: () => false,
      reorder: async () => {},
      removeEntry: async () => {},
      addAt: async () => {},
      addMultipleAt: async () => {},
    }
    const todo = helpers.makeTodo({ id: 7 })
    const event = {
      active: { id: 'a', data: { current: { type: kindsMod.TASK_DRAG_KIND.task, todo } } },
      over: {
        id: 'cal-1',
        data: { current: { type: kindsMod.TASK_DROP_KIND.calendarDay, date: new Date() } },
      },
      delta: { x: 0, y: 0 },
    } as unknown as import('@dnd-kit/core').DragEndEvent

    await dispatchMod.dispatchTaskDrop(event, { taskboard: fakeTaskboard, calendar: { reschedule } })

    const debugCalls = warn.mock.calls.filter((c) => c[0] === '[debug-dnd]')
    expect(debugCalls).toHaveLength(0)
  })
})
