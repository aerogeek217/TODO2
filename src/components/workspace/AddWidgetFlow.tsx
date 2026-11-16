import { useState } from 'react'
import { BREAKDOWN_PRESET_LABELS, BREAKDOWN_PRESETS, breakdownPreset, type BreakdownPreset } from '../../models/chart-widgets'
import { WIDGET_KIND_GROUPS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../../models/workspace-layout'
import { afterLeavingEditors } from '../../stores/editor-leave'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import type { MenuEntry, MenuItemEntry } from '../shared/MenuPopover'
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
  anchor: { x: number; y: number }
  onClose: () => void
}

/**
 * Add widget from a cell (its strip's `+`; in the layout edit mode the
 * grip's Add widget… too). In the mode: where first, as a picture of the
 * cell (`addWherePicture`: its middle a tab, its sides a split, the bars
 * outside a row or column at the layout's edge; default Tab) —, then the
 * kinds; a pick adds that widget there (`useAddKind`). Outside the mode
 * (layout edit mode E4: edit mode changes the grid; what's inside a cell
 * changes in place) no picture: the kinds, each added as a tab of the cell.
 */
export function AddWidgetFlow({ cellId, initialWhere = 'tab', anchor, onClose }: AddWidgetFlowProps) {
  const editing = useWorkspaceStore((s) => s.editing != null)
  const [picked, setWhere] = useState<AddWhere>(initialWhere)
  const where: AddWhere = editing ? picked : 'tab'
  const addKind = useAddKind(addWhereTarget(cellId, where))
  const addBreakdown = useAddBreakdown(addWhereTarget(cellId, where))
  const lead: MenuEntry[] = editing ? [addWherePicture(where, setWhere)] : []
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
