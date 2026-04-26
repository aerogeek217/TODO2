import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { db } from '../../../../data/database'
import { HorizonsSlotContent } from '../../../../components/canvas/rails/HorizonsSlotContent'
import { useTodoStore } from '../../../../stores/todo-store'
import { usePersonStore } from '../../../../stores/person-store'
import { useOrgStore } from '../../../../stores/org-store'
import { useTagStore } from '../../../../stores/tag-store'
import { useStatusStore } from '../../../../stores/status-store'
import { useListDefinitionStore } from '../../../../stores/list-definition-store'
import { useSettingsStore } from '../../../../stores/settings-store'

beforeEach(async () => {
  await db.delete()
  await db.open()
  useTodoStore.setState({ todos: [], loading: false, error: null })
  usePersonStore.setState({ people: [], assignedPeopleMap: new Map(), loading: false, error: null })
  useOrgStore.setState({ orgs: [], assignedOrgsMap: new Map(), personOrgMap: new Map(), loading: false, error: null })
  useTagStore.setState({ tags: [], assignedTagsMap: new Map(), loading: false, error: null })
  useStatusStore.setState({ statuses: [], loading: false, error: null })
  useListDefinitionStore.setState({ listDefinitions: [] })
  useSettingsStore.setState({ horizonSlots: [], selectedHorizonDefId: null })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('HorizonsSlotContent — midnight rollover', () => {
  it('reschedules the day-key timer when the clock advances past midnight', () => {
    // Anchor just before midnight so advancing a minute crosses the day boundary.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16, 23, 59, 50))

    render(<HorizonsSlotContent />)

    // Exactly one rolling-midnight timer is pending after mount.
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      // Cross midnight; the pending timer fires and the effect re-runs with
      // the new dayKey, scheduling a fresh timer for the next midnight.
      vi.advanceTimersByTime(60 * 1000)
    })

    // The fired timer got replaced by a fresh one — still exactly one pending.
    expect(vi.getTimerCount()).toBe(1)

    // Advance an hour; the fresh timer is far in the future (next midnight),
    // so nothing fires — proves the callback re-evaluated `new Date()` past
    // midnight rather than re-scheduling against the stale "now".
    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000)
    })
    expect(vi.getTimerCount()).toBe(1)
  })

  it('unmounting clears the pending midnight timer', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 16, 12, 0, 0))

    const { unmount } = render(<HorizonsSlotContent />)
    expect(vi.getTimerCount()).toBe(1)

    act(() => {
      unmount()
    })

    expect(vi.getTimerCount()).toBe(0)
  })
})
