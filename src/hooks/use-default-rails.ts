import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { createLensSlot, useCanvasRailsStore } from '../stores/canvas-rails-store'
import type { RailsState } from '../models/canvas-rails'

function hasPersistedRails(rails: RailsState | null | undefined): rails is RailsState {
  return !!rails && !!(rails.left || rails.right || rails.top || rails.bottom)
}

/**
 * Hydrate the rails store on first mount and persist updates back through
 * `settings.canvasRails`. Two independent paths land into `hydrate()`:
 *
 * 1. **Persisted hydration** (first effect) runs as soon as `canvasRails`
 *    settings carry at least one non-empty rail. It does NOT depend on the
 *    list-definition store — saved slots already carry their `listDefinitionId`
 *    references, so a slow IDB read on `listDefinitions` cannot block the
 *    user's saved layout from rendering.
 * 2. **Default seed** (second effect) only fires when there's no persisted
 *    layout. It needs `listDefinitionsLoaded` because the seed lens picks the
 *    canonical thisweek horizon def, and that lookup wants a real id.
 */
export function useDefaultRails(): RailsState {
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const persistedRails = useSettingsStore((s) => s.canvasRails)
  const setCanvasRails = useSettingsStore((s) => s.setCanvasRails)
  const listDefinitionsLoaded = useListDefinitionStore((s) => s.listDefinitions.length > 0)
  const { rails, hydrated, hydrate } = useCanvasRailsStore()

  useEffect(() => {
    if (hydrated) return
    if (!hasPersistedRails(persistedRails)) return
    hydrate(persistedRails)
  }, [hydrated, hydrate, persistedRails])

  useEffect(() => {
    if (hydrated) return
    if (hasPersistedRails(persistedRails)) return
    if (!listDefinitionsLoaded) return
    // First seeded horizon (post-P6: index 0 of the `horizonSlots` ordered
    // array; pre-P6: the `thisweek` map entry — flattened to index 0 by the
    // legacy iteration order).
    const firstHorizonId = horizonSlots[0]
    const slot = createLensSlot(firstHorizonId)
    hydrate({
      left: null,
      right: { orientation: 'vertical', slots: [slot] },
      top: null,
      bottom: null,
    })
  }, [hydrated, hydrate, horizonSlots, listDefinitionsLoaded, persistedRails])

  useEffect(() => {
    if (!hydrated) return
    setCanvasRails(rails)
  }, [rails, hydrated, setCanvasRails])

  return rails
}
