import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useDefaultRails } from '../../hooks/use-default-rails'
import { useCanvasRailsStore } from '../../stores/canvas-rails-store'
import { useSettingsStore } from '../../stores/settings-store'
import { emptyPredicate, useListDefinitionStore } from '../../stores/list-definition-store'
import { EMPTY_RAILS } from '../../models/canvas-rails'
import type { RailsState } from '../../models/canvas-rails'
import type { PersistedListDefinition } from '../../models/list-definition'

/**
 * `useDefaultRails` has two independent hydration paths:
 *
 *   1. **persisted** — runs as soon as `settings.canvasRails` carries a
 *      non-empty rail. Must NOT depend on the list-definition store, because
 *      saved slots already carry their `listDefinitionId` references.
 *   2. **default seed** — only fires when no persisted layout exists. Needs
 *      `listDefinitionsLoaded` because the seed lens picks the canonical
 *      thisweek horizon def.
 *
 * 6.5.1 (real-browser-testing plan) split the original combined effect so
 * a slow IDB read on `listDefinitions` cannot delay persisted hydration —
 * a real user with persisted rails state but a not-yet-loaded
 * `listDefinitionStore` previously rendered an empty canvas frame for one
 * tick instead of their saved layout.
 */

function makeDef(overrides: { id: number; name: string }): PersistedListDefinition {
  return {
    id: overrides.id,
    name: overrides.name,
    sortOrder: 0,
    pinnedToDashboard: false,
    favorited: false,
    membership: { kind: 'custom', predicate: emptyPredicate() },
    sort: { kind: 'sort-order' },
    grouping: { kind: 'none' },
  }
}

const persistedSeed: RailsState = {
  left: { orientation: 'vertical', slots: [{ id: 'persisted-slot', tabs: [{ id: 'persisted-tab', type: 'notes' }], activeTabId: 'persisted-tab' }] },
  right: null,
  top: null,
  bottom: null,
}

beforeEach(() => {
  useCanvasRailsStore.setState({ rails: EMPTY_RAILS, hydrated: false, pendingFocusSlotId: null })
  useSettingsStore.setState({ canvasRails: null, horizonSlots: {} })
  useListDefinitionStore.setState({ listDefinitions: [] })
})

describe('useDefaultRails', () => {
  it('hydrates from persisted rails immediately, even before list-defs load', () => {
    useSettingsStore.setState({ canvasRails: persistedSeed })
    // listDefinitions intentionally empty — the persisted path must not block on it.

    renderHook(() => useDefaultRails())

    const after = useCanvasRailsStore.getState()
    expect(after.hydrated).toBe(true)
    expect(after.rails.left?.slots[0]?.id).toBe('persisted-slot')
  })

  it('seeds the default right-side lens once list-defs load and there is no persisted layout', () => {
    const lenseDef = makeDef({ id: 42, name: 'This week' })
    useSettingsStore.setState({ canvasRails: null, horizonSlots: { thisweek: 42 } })
    useListDefinitionStore.setState({ listDefinitions: [lenseDef] })

    renderHook(() => useDefaultRails())

    const after = useCanvasRailsStore.getState()
    expect(after.hydrated).toBe(true)
    expect(after.rails.right?.slots).toHaveLength(1)
    expect(after.rails.right?.slots[0]?.tabs[0]?.type).toBe('lens')
    expect(after.rails.right?.slots[0]?.tabs[0]?.listDefinitionId).toBe(42)
  })

  it('does not hydrate when there is no persisted layout and list-defs are still loading', () => {
    useSettingsStore.setState({ canvasRails: null })
    useListDefinitionStore.setState({ listDefinitions: [] })

    renderHook(() => useDefaultRails())

    expect(useCanvasRailsStore.getState().hydrated).toBe(false)
  })

  it('treats a persisted layout with all sides null as not-persisted (falls through to default seed)', () => {
    const emptyPersisted: RailsState = { left: null, right: null, top: null, bottom: null }
    const lenseDef = makeDef({ id: 7, name: 'This week' })
    useSettingsStore.setState({ canvasRails: emptyPersisted, horizonSlots: { thisweek: 7 } })
    useListDefinitionStore.setState({ listDefinitions: [lenseDef] })

    renderHook(() => useDefaultRails())

    const after = useCanvasRailsStore.getState()
    expect(after.hydrated).toBe(true)
    // Default seed fired (right rail with thisweek lens), not the all-null persisted layout.
    expect(after.rails.right?.slots[0]?.tabs[0]?.listDefinitionId).toBe(7)
  })
})
