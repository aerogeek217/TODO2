import { useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { nextScopedSelection, type ScopedRow } from '../utils/scoped-selection'
import { useLatestRef } from './use-latest-ref'
import { useScopedSelectionRelease } from './use-scoped-selection-release'

/** The modifier keys of a row click. */
export interface RowSelectMods {
  shift: boolean
  ctrl: boolean
}

export interface WidgetSelection {
  /** This widget owns the selection. */
  inScope: boolean
  selectedIds: ReadonlySet<number>
  /** The keyboard cursor's row, while this widget owns the selection. */
  cursorKey: string | null
  /** A row click: one task, Ctrl toggles, Shift selects the range from the anchor. */
  onSelect: (key: string, todoId: number, mods: RowSelectMods) => void
  /**
   * The widget's click handler: a click on its own element (or on one of
   * `emptyAreas`) — empty space, not a row — clears its selection.
   */
  clearOnEmptySpace: (e: React.MouseEvent, ...emptyAreas: Array<Element | null>) => void
}

/**
 * Row selection for a widget that lists tasks (list, Eisenhower, dashboard):
 * one widget owns the selection at a time (`scope` = its tab id), rows are
 * addressed by occurrence (`utils/scoped-selection`), and the selection goes
 * when the widget unmounts. `getRows` returns the rows in display order at
 * the time of a click.
 */
export function useWidgetSelection(scope: string, getRows: () => readonly ScopedRow[]): WidgetSelection {
  const inScope = useUIStore((s) => s.selectionScope === scope)
  useScopedSelectionRelease(scope)
  const selectedIds = useUIStore((s) => s.selectedTodoIds)
  const cursorKey = useUIStore((s) => (s.selectionScope === scope ? s.selectionCursorKey : null))
  const getRowsRef = useLatestRef(getRows)

  const onSelect = useCallback((key: string, _todoId: number, mods: RowSelectMods) => {
    const ui = useUIStore.getState()
    const next = nextScopedSelection(
      { scope: ui.selectionScope, ids: ui.selectedTodoIds, anchorKey: ui.selectionAnchorKey },
      scope,
      getRowsRef.current(),
      key,
      mods.shift ? 'range' : mods.ctrl ? 'toggle' : 'one',
    )
    if (next) ui.setScopedSelection(scope, next)
  }, [scope, getRowsRef])

  const clearOnEmptySpace = useCallback((e: React.MouseEvent, ...emptyAreas: Array<Element | null>) => {
    const ui = useUIStore.getState()
    if (ui.selectionScope !== scope) return
    if (e.target === e.currentTarget || emptyAreas.some((el) => el != null && el === e.target)) ui.clearSelection()
  }, [scope])

  return { inScope, selectedIds, cursorKey, onSelect, clearOnEmptySpace }
}
