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
 *    layout and at least one list definition exists (a database without list
 *    definitions shows no default rail). The seed is a right-rail lens slot
 *    with no list picked — the slot shows its "pick a list" placeholder.
 */
export function useDefaultRails(): RailsState {
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
    const slot = createLensSlot()
    hydrate({
      left: null,
      right: { orientation: 'vertical', slots: [slot] },
      top: null,
      bottom: null,
    })
  }, [hydrated, hydrate, listDefinitionsLoaded, persistedRails])

  useEffect(() => {
    if (!hydrated) return
    setCanvasRails(rails)
  }, [rails, hydrated, setCanvasRails])

  return rails
}
