import { describe, it, expect, vi, afterEach } from 'vitest'
import type { DragEndEvent } from '@dnd-kit/core'
import { DEBUG_DND, hasFlag, makeDndLog } from '../../utils/debug-flags'
import { dispatchTaskDrop } from '../../utils/task-dnd/dispatch'
import { TASK_DRAG_KIND, TASK_DROP_KIND } from '../../utils/task-dnd/kinds'
import { makeTodo } from '../helpers'

/**
 * `?debug-dnd=1`: the flag parse and the logger are pure, so they're tested
 * directly; the module's own `DEBUG_DND` is read from this test page's URL
 * (no flag), which keeps the wrap sites silent.
 */

afterEach(() => {
  vi.restoreAllMocks()
})

describe('hasFlag', () => {
  it('is false when the flag is absent', () => {
    expect(hasFlag('', 'debug-dnd')).toBe(false)
    expect(hasFlag('?other=1', 'debug-dnd')).toBe(false)
  })

  it('is true when ?debug-dnd=1 is present', () => {
    expect(hasFlag('?debug-dnd=1', 'debug-dnd')).toBe(true)
  })

  it('is true even with bare ?debug-dnd (URLSearchParams.has)', () => {
    expect(hasFlag('?debug-dnd', 'debug-dnd')).toBe(true)
  })
})

describe('makeDndLog', () => {
  it('is a no-op when the flag is off', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeDndLog(false)('test.label', { foo: 1 })
    expect(warn).not.toHaveBeenCalled()
  })

  it('forwards label + payload to console.warn under [debug-dnd] prefix when on', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeDndLog(true)('test.label', { foo: 1 })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('[debug-dnd]', 'test.label', { foo: 1 })
  })

  it('passes an empty payload when none supplied', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeDndLog(true)('bare')
    expect(warn).toHaveBeenCalledWith('[debug-dnd]', 'bare', {})
  })
})

describe('debug-dnd wrap sites — production silence', () => {
  it('emits no logs when ?debug-dnd is absent', async () => {
    expect(DEBUG_DND).toBe(false)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const reschedule = vi.fn(async () => {})
    const event = {
      active: { id: 'a', data: { current: { type: TASK_DRAG_KIND.task, todo: makeTodo({ id: 7 }) } } },
      over: { id: 'cal-1', data: { current: { type: TASK_DROP_KIND.calendarDay, date: new Date() } } },
      delta: { x: 0, y: 0 },
    } as unknown as DragEndEvent

    await dispatchTaskDrop(event, { calendar: { reschedule } })

    expect(warn.mock.calls.filter((c) => c[0] === '[debug-dnd]')).toHaveLength(0)
  })
})
