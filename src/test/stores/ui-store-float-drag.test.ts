/**
 * Phase 4 float-dock: unit tests for the `ui-store` float-drag slice.
 * Focus is the short-circuit contracts on `setFloatDrag` and
 * `setFloatAnnouncement` — both guard against churn that would otherwise
 * push downstream consumers (DockOverlay, sr-only region) to re-render on
 * every pointermove.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useUIStore } from '../../stores/ui-store'

beforeEach(() => {
  useUIStore.setState({ floatDrag: null, floatAnnouncement: '' })
})

describe('ui-store.setFloatDrag', () => {
  it('sets a new descriptor from null', () => {
    useUIStore.getState().setFloatDrag({ kind: 'note', id: 7 })
    expect(useUIStore.getState().floatDrag).toEqual({ kind: 'note', id: 7 })
  })

  it('short-circuits null → null', () => {
    let calls = 0
    const unsub = useUIStore.subscribe(() => { calls++ })
    useUIStore.getState().setFloatDrag(null)
    expect(calls).toBe(0)
    unsub()
  })

  it('short-circuits identical kind+id descriptors', () => {
    useUIStore.setState({ floatDrag: { kind: 'calendar', id: 3 } })
    let calls = 0
    const unsub = useUIStore.subscribe(() => { calls++ })
    useUIStore.getState().setFloatDrag({ kind: 'calendar', id: 3 })
    expect(calls).toBe(0)
    unsub()
  })

  it('updates when kind or id changes', () => {
    useUIStore.setState({ floatDrag: { kind: 'calendar', id: 3 } })
    useUIStore.getState().setFloatDrag({ kind: 'calendar', id: 4 })
    expect(useUIStore.getState().floatDrag).toEqual({ kind: 'calendar', id: 4 })
    useUIStore.getState().setFloatDrag({ kind: 'note', id: 4 })
    expect(useUIStore.getState().floatDrag).toEqual({ kind: 'note', id: 4 })
  })
})

describe('ui-store.setFloatAnnouncement', () => {
  it('sets a non-empty announcement', () => {
    useUIStore.getState().setFloatAnnouncement('Dragging note')
    expect(useUIStore.getState().floatAnnouncement).toBe('Dragging note')
  })

  it('short-circuits on identical text', () => {
    useUIStore.setState({ floatAnnouncement: 'Dropped in right rail' })
    let calls = 0
    const unsub = useUIStore.subscribe(() => { calls++ })
    useUIStore.getState().setFloatAnnouncement('Dropped in right rail')
    expect(calls).toBe(0)
    unsub()
  })

  it('replaces the prior announcement with a new one', () => {
    useUIStore.getState().setFloatAnnouncement('Dragging note')
    useUIStore.getState().setFloatAnnouncement('Dropped in right rail')
    expect(useUIStore.getState().floatAnnouncement).toBe('Dropped in right rail')
  })

  it('can be cleared with an empty string', () => {
    useUIStore.setState({ floatAnnouncement: 'Dragging note' })
    useUIStore.getState().setFloatAnnouncement('')
    expect(useUIStore.getState().floatAnnouncement).toBe('')
  })
})
