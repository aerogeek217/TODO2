import { useState } from 'react'
import { BREAKDOWN_PRESET_LABELS, BREAKDOWN_PRESETS, breakdownPreset, type BreakdownPreset } from '../../models/chart-widgets'
import { WIDGET_KIND_GROUPS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../../models/workspace-layout'
import { afterLeavingEditors } from '../../stores/editor-leave'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { MenuPopover, type MenuEntry, type MenuItemEntry } from '../shared/MenuPopover'
import { addWherePicture, addWhereTarget, type AddWhere } from './add-widget-where'
import { WidgetKindIcon } from '../shared/icons'
import { addKindAt, useAddWidget, useListOwnerLayoutId } from './widget-hooks'
import styles from './AddWidgetFlow.module.css'

/**
 * Adds a widget of `kind` at `target`; no editor opens. A list widget gets
 * a new blank list of the open layout (`createListAndTab`) — copying another
 * list's setup is Edit list's Copy from…. Nothing for a list before the
 * workspace has opened a layout (`layoutId` undefined).
 *
 * An open editor holding changes (Edit list, a widget editor) is asked
 * first — Save / Discard / Keep editing (`editor-leave`) —, as on every
 * other way out of it: the new widget may take its tab's place in the cell.
 * A press would have asked already; this is the keyboard's way here (the
 * palette's Add Widget ›, a menu opened with the keys). Keep editing adds
 * nothing.
 */
function useAddKind(target: LayoutDropTarget): (kind: WidgetKind) => void {
  const add = useAddWidget()
  const layoutId = useListOwnerLayoutId()
  return (kind) => afterLeavingEditors(() => addKindAt(kind, target, add, layoutId))
}

/** Adds a Breakdown from a preset at `target` (D26 P8, `breakdownPreset`); no editor opens, and an open one with changes is asked first (`useAddKind`). */
function useAddBreakdown(target: LayoutDropTarget): (preset: BreakdownPreset) => void {
  const add = useAddWidget()
  return (preset) => afterLeavingEditors(() => {
    add('breakdown', target, undefined, { breakdown: breakdownPreset(preset) })
  })
}

/** Breakdown's presets as menu items (People · Tags · Status · Custom). */
function breakdownPresetItems(addBreakdown: (preset: BreakdownPreset) => void): MenuItemEntry[] {
  return BREAKDOWN_PRESETS.map((preset) => ({
    kind: 'item',
    label: BREAKDOWN_PRESET_LABELS[preset],
    onSelect: () => addBreakdown(preset),
  }))
}

interface AddWidgetFlowProps {
  /** The cell it is added from. */
  cellId: string
  /** Where it goes until the user picks another (default a tab). */
  initialWhere?: AddWhere
  /** The kind, already chosen (the palette's Add Widget › kind): only where is asked. */
  kind?: WidgetKind
  anchor: { x: number; y: number }
  onClose: () => void
}

/**
 * Add widget from a cell (its ⋯ menu, its strip's `+`): where first, as a
 * picture of the cell (`addWherePicture`: its middle a tab, its sides a
 * split, the bars outside a row or column at the layout's edge; default
 * Tab) —, then the kinds; a pick adds that widget there (`useAddKind`).
 * With `kind` chosen, the picture is followed by `Add <kind>` (a
 * Breakdown's presets) instead of the kinds.
 */
export function AddWidgetFlow({ cellId, initialWhere = 'tab', kind, anchor, onClose }: AddWidgetFlowProps) {
  const [where, setWhere] = useState<AddWhere>(initialWhere)
  const addKind = useAddKind(addWhereTarget(cellId, where))
  const addBreakdown = useAddBreakdown(addWhereTarget(cellId, where))
  const lead: MenuEntry[] = [addWherePicture(where, setWhere)]
  if (kind) {
    const add: MenuEntry[] = kind === 'breakdown'
      ? [{ kind: 'label', text: widgetKindLabel(kind) }, ...breakdownPresetItems(addBreakdown)]
      : [{ kind: 'item', label: `Add ${widgetKindLabel(kind)}`, icon: <WidgetKindIcon kind={kind} />, onSelect: () => addKind(kind) }]
    return <MenuPopover point={anchor} label="Add widget" width={248} restoreFocus entries={[...lead, { kind: 'separator' }, ...add]} onClose={onClose} />
  }
  return (
    <WidgetKindMenu
      anchor={anchor}
      heading="Add widget"
      onChangeKind={addKind}
      leadEntries={lead}
      kindPresets={{ breakdown: breakdownPresetItems(addBreakdown) }}
      onClose={onClose}
    />
  )
}

/** The Where picker the palette asked for (`ui-store.addWidgetRequest`), while its cell is in the open layout. */
export function AddWidgetRequestHost() {
  const request = useUIStore((s) => s.addWidgetRequest)
  const cellThere = useWorkspaceStore((s) => request != null && s.working?.cells.some((c) => c.id === request.cellId) === true)
  if (!request || !cellThere) return null
  return (
    <AddWidgetFlow
      key={`${request.cellId}:${request.kind}`}
      cellId={request.cellId}
      kind={request.kind}
      anchor={request.anchor}
      onClose={() => useUIStore.getState().clearAddWidgetRequest()}
    />
  )
}

interface AddWidgetButtonsProps {
  target: LayoutDropTarget
  buttonClassName: string | undefined
  iconClassName: string | undefined
  iconSize?: number
}

/**
 * One button per widget kind (an empty layout's tiles, an empty cell's row),
 * by group under its caption (Tasks, Insights): adds that widget at
 * `target` (`useAddKind`; no editor opens).
 */
export function AddWidgetButtons({ target, buttonClassName, iconClassName, iconSize }: AddWidgetButtonsProps) {
  const addKindOnly = useAddKind(target)
  const addBreakdown = useAddBreakdown(target)
  // A Breakdown's button adds a Custom one.
  const addKind = (kind: WidgetKind) => (kind === 'breakdown' ? addBreakdown('custom') : addKindOnly(kind))
  return (
    <>
      {WIDGET_KIND_GROUPS.map(({ group, label }) => (
        <div key={group} className={styles.group} role="group" aria-label={label} data-widget-group={group}>
          <span className={styles.caption} aria-hidden="true">{label}</span>
          <div className={styles.buttons}>
            {widgetKindsOf(group).map((kind) => (
              <button
                key={kind}
                type="button"
                className={buttonClassName}
                onClick={() => addKind(kind)}
              >
                <span className={iconClassName}><WidgetKindIcon kind={kind} size={iconSize} /></span>
                {widgetKindLabel(kind)}
              </button>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
