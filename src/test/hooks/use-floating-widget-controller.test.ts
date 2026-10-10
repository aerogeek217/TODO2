import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { db } from '../../data/database'
import { useCanvasStore } from '../../stores/canvas-store'
import { useFloatingNoteStore } from '../../stores/floating-note-store'
import { useFloatingStatusStore } from '../../stores/floating-status-store'
import { useFloatingCalendarStore } from '../../stores/floating-calendar-store'
import {
  useFloatingNoteController,
  useFloatingStatusController,
  useFloatingCalendarController,
} from '../../hooks/use-floating-widget-controller'
import { resetFloatingStores } from '../helpers'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useCanvasStore.setState({ selectedCanvasId: null })
  resetFloatingStores()
})

async function seedCanvas(): Promise<number> {
  return db.canvases.add({ name: 'Test', sortOrder: 0, createdAt: new Date() })
}

describe('useFloatingNoteController', () => {
  it('fires loadByCanvas when canvasId changes from null to a number', async () => {
    const canvasId = await seedCanvas()
    await db.floatingNotes.add({ canvasId, x: 1, y: 2, width: 200, height: 150 })

    const { result, rerender } = renderHook(
      ({ id }) => useFloatingNoteController(id),
      { initialProps: { id: null as number | null } },
    )

    expect(result.current.items.length).toBe(0)

    await act(async () => {
      rerender({ id: canvasId })
      await Promise.resolve()
    })
    await act(async () => { await Promise.resolve() })

    expect(useFloatingNoteStore.getState().notes.length).toBe(1)
    expect(useFloatingNoteStore.getState().notes[0]!.x).toBe(1)
  })

  it('exposes handlers that route to the underlying store actions', async () => {
    const canvasId = await seedCanvas()
    const { result } = renderHook(() => useFloatingNoteController(canvasId))
    await act(async () => { await Promise.resolve() })

    const newId = await act(async () => {
      return result.current.addAtPosition(canvasId, 50, 60)
    })
    expect(typeof newId).toBe('number')

    await act(async () => {
      await result.current.handlers.onResize(newId, 400, 300)
    })

    const updated = useFloatingNoteStore.getState().notes.find((n) => n.id === newId)
    expect(updated?.width).toBe(400)
    expect(updated?.height).toBe(300)

    await act(async () => {
      await result.current.handlers.onClose(newId)
    })
    expect(useFloatingNoteStore.getState().notes.find((n) => n.id === newId)).toBeUndefined()
  })

  it('handlers reference is memo-stable across renders that don\'t change selectors', async () => {
    const canvasId = await seedCanvas()
    const { result, rerender } = renderHook(
      ({ id }) => useFloatingNoteController(id),
      { initialProps: { id: canvasId } },
    )
    const handlersV1 = result.current.handlers
    rerender({ id: canvasId })
    const handlersV2 = result.current.handlers
    expect(handlersV1).toBe(handlersV2)
  })
})

describe('per-kind controllers wire their store correctly', () => {
  it('useFloatingStatusController writes to the statuses slice on add', async () => {
    const canvasId = await seedCanvas()
    const { result } = renderHook(() => useFloatingStatusController(canvasId))
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      await result.current.addAtPosition(canvasId, 7, 8)
    })

    expect(useFloatingStatusStore.getState().statuses.length).toBe(1)
    expect(useFloatingStatusStore.getState().statuses[0]!.x).toBe(7)
  })

  it('useFloatingCalendarController writes to the calendars slice on add', async () => {
    const canvasId = await seedCanvas()
    const { result } = renderHook(() => useFloatingCalendarController(canvasId))
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      await result.current.addAtPosition(canvasId, 9, 10)
    })

    expect(useFloatingCalendarStore.getState().calendars.length).toBe(1)
    expect(useFloatingCalendarStore.getState().calendars[0]!.x).toBe(9)
  })
})
