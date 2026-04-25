import { useEffect } from 'react'
import { useSettingsStore } from '../stores/settings-store'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { createLensSlot, useCanvasRailsStore } from '../stores/canvas-rails-store'
import type { RailsState } from '../models/canvas-rails'

/**
 * Hydrate the rails store on first mount and persist updates back through
 * `settings.canvasRails`. When no persisted layout exists, seeds a default
 * right-side lens slot pointing at the `thisweek` horizon list. List
 * definitions must be loaded before seeding so the seed lens has a real
 * `listDefinitionId` (the seed picks the canonical thisweek def).
 */
export function useDefaultRails(): RailsState {
  const horizonSlots = useSettingsStore((s) => s.horizonSlots)
  const persistedRails = useSettingsStore((s) => s.canvasRails)
  const setCanvasRails = useSettingsStore((s) => s.setCanvasRails)
  const listDefinitionsLoaded = useListDefinitionStore((s) => s.listDefinitions.length > 0)
  const { rails, hydrated, hydrate } = useCanvasRailsStore()

  useEffect(() => {
    if (hydrated) return
    if (!listDefinitionsLoaded) return
    const hasPersisted = persistedRails && (persistedRails.left || persistedRails.right || persistedRails.top || persistedRails.bottom)
    if (hasPersisted) {
      hydrate(persistedRails)
      return
    }
    const thisweekId = horizonSlots?.thisweek
    const slot = createLensSlot(thisweekId)
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
