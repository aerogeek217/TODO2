import { useCallback, useState } from 'react'
import type { SlotKind } from '../models/canvas-rails'
import { useCanvasRailsStore } from '../stores/canvas-rails-store'
import { useCanvasStore } from '../stores/canvas-store'
import { convertFloatingKind } from '../services/float-kind-switch'

/**
 * Shared plumbing for the five floating canvas widgets (note / calendar /
 * horizons / taskboard / list-inset). Collapses the ~50 LOC of
 * `handleClose` / `handleDock` / `handleChangeKind` + `kindAnchor` state that
 * each node previously duplicated.
 *
 * Returns:
 *   - `headerProps`  — spread directly into `<WidgetHeader>` (close/dock/title-click).
 *   - bare handlers  — for callers that need to compose extra behaviour
 *                      (`ListInsetNode` extends `onClose` to clear runtime-filter state).
 *   - `kindAnchor` + `setKindAnchor` — caller renders `<WidgetKindMenu>` itself
 *     since lens variants thread `pickListForLens` / `onEditList` /
 *     `secondaryLabel` while the simpler kinds don't.
 */
export interface UseFloatingWidgetOpts {
  kind: SlotKind
  id: number | undefined
  rect: { x: number; y: number; width: number; height: number }
  onDelete: (id: number) => void
  /** For `'lens'`: the listDefinitionId to seed the docked slot. Ignored for other kinds. */
  dockSeed?: number
}

export interface UseFloatingWidgetResult {
  headerProps: {
    onClose: () => void
    onDock: () => void
    onTitleClick: (anchor: { x: number; y: number }) => void
    titleMenuOpen: boolean
  }
  handleClose: () => void
  handleDock: () => void
  handleChangeKind: (nextKind: SlotKind) => Promise<void>
  kindAnchor: { x: number; y: number } | null
  setKindAnchor: (anchor: { x: number; y: number } | null) => void
}

export function useFloatingWidget(opts: UseFloatingWidgetOpts): UseFloatingWidgetResult {
  const { kind, id, rect, onDelete, dockSeed } = opts
  const [kindAnchor, setKindAnchor] = useState<{ x: number; y: number } | null>(null)

  const handleClose = useCallback(() => {
    if (id == null) return
    onDelete(id)
  }, [id, onDelete])

  const handleDock = useCallback(() => {
    if (id == null) return
    useCanvasRailsStore.getState().createAndDockSlot(kind, dockSeed)
    onDelete(id)
  }, [id, kind, dockSeed, onDelete])

  const handleChangeKind = useCallback(async (nextKind: SlotKind) => {
    if (id == null) return
    if (nextKind === kind) return
    const canvasId = useCanvasStore.getState().selectedCanvasId
    if (canvasId == null) return
    await convertFloatingKind({
      sourceKind: kind,
      sourceId: id,
      canvasId,
      rect,
      nextKind,
    })
  }, [kind, id, rect])

  return {
    headerProps: {
      onClose: handleClose,
      onDock: handleDock,
      onTitleClick: setKindAnchor,
      titleMenuOpen: kindAnchor !== null,
    },
    handleClose,
    handleDock,
    handleChangeKind,
    kindAnchor,
    setKindAnchor,
  }
}
