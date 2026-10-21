import { useCallback } from 'react'
import { useUIStore } from '../stores/ui-store'
import { nextScopedSelection, type ScopedRow } from '../utils/scoped-selection'
import { useLatestRef } from './use-latest-ref'
import { useScopedSelectionRelease } from './use-scoped-selection-release'

const NO_IDS: ReadonlySet<number> = new Set()

/** The modifier keys of a row click. */
export interface RowSelectMods {
  shift: boolean
  ctrl: boolean
}

export interface WidgetSelection {
  /** This widget owns the selection. */
  inScope: boolean
  /** The selected tasks while this widget owns the selection, else none. */
  selectedIds: ReadonlySet<number>
  /** The keyboard cursor's row, while this widget owns the selection. */
  cursorKey: string | null
  /** A row click: one task, Ctrl toggles, Shift selects the range from the anchor. */
  onSelect: (key: string, todoId: number, mods: RowSelectMods) => void
}

/**
 * Row selection for a widget that lists tasks (list, Eisenhower, dashboard):
 * one widget owns the selection at a time (`scope` = its tab id), rows are
 * addressed by occurrence (`utils/scoped-selection`), and the selection goes
 * when the widget unmounts. `getRows` returns the rows in display order at
 * the time of a click. A click outside the rows clears the selection
 * (`use-clear-selection-on-outside-click`, mounted by the workspace).
 */
export function useWidgetSelection(scope: string, getRows: () => readonly ScopedRow[]): WidgetSelection {
  const inScope = useUIStore((s) => s.selectionScope === scope)
  useScopedSelectionRelease(scope)
  // Another widget's selection clicks don't render this one.
  const selectedIds = useUIStore((s) => (s.selectionScope === scope ? s.selectedTodoIds : NO_IDS))
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

  return { inScope, selectedIds, cursorKey, onSelect }
}
