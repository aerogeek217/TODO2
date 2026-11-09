import { useState } from 'react'
import { BREAKDOWN_PRESET_LABELS, BREAKDOWN_PRESETS, breakdownPreset, type BreakdownPreset } from '../../models/chart-widgets'
import { WIDGET_KIND_GROUPS, WIDGET_KIND_SPECS, WIDGET_KINDS, widgetKindLabel, widgetKindsOf, type WidgetKind } from '../../models/workspace-layout'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import type { MenuEntry, MenuItemEntry } from '../shared/MenuPopover'
import { ADD_WHERE_OPTIONS, addWhereTarget, isAddWhere, type AddWhere } from './add-widget-where'
import { WidgetKindIcon } from '../shared/icons'
import { createListThenEdit, NO_LIST_LAYOUT_REASON, useAddWidget, useListOwnerLayoutId } from './widget-hooks'
import styles from './AddWidgetFlow.module.css'

/**
 * Adds a widget of `kind` at `target`. A list widget gets a new blank list
 * of the open layout and opens its Edit list at once (`createListThenEdit`)
 * — copying another list's setup is Edit list's Copy from…. Nothing for a
 * list while the open layout isn't stored (`layoutId` undefined): it can't
 * own a list yet.
 */
function useAddKind(target: LayoutDropTarget): (kind: WidgetKind) => void {
  const add = useAddWidget()
  const layoutId = useListOwnerLayoutId()
  return (kind) => {
    if (!WIDGET_KIND_SPECS[kind].showsList) {
      add(kind, target)
      return
    }
    if (layoutId != null) void createListThenEdit((id) => add('lens', target, id), layoutId)
  }
}

/** Adds a Breakdown from a preset at `target` (D26 P8, `breakdownPreset`): its editor opens at once. */
function useAddBreakdown(target: LayoutDropTarget): (preset: BreakdownPreset) => void {
  const add = useAddWidget()
  return (preset) => {
    add('breakdown', target, undefined, { breakdown: breakdownPreset(preset) })
  }
}

/** Breakdown's presets as menu items (People · Tags · Status · Custom). */
function breakdownPresetItems(addBreakdown: (preset: BreakdownPreset) => void): MenuItemEntry[] {
  return BREAKDOWN_PRESETS.map((preset) => ({
    kind: 'item',
    label: BREAKDOWN_PRESET_LABELS[preset],
    onSelect: () => addBreakdown(preset),
  }))
}

/** The kinds that can't be added to the open layout yet, with why (a list, while the layout isn't stored). */
function useUnavailableKinds(): Partial<Record<WidgetKind, string>> | undefined {
  const layoutId = useListOwnerLayoutId()
  if (layoutId != null) return undefined
  return Object.fromEntries(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].showsList).map((k) => [k, NO_LIST_LAYOUT_REASON]))
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
 * Add widget from a cell (its ⋯ menu, its strip's `+`): where first — Tab ·
 * Right · Below · Row · Column (`addWhereTarget`) —, then the kinds; a pick
 * adds that widget there (`useAddKind`).
 */
export function AddWidgetFlow({ cellId, initialWhere = 'tab', anchor, onClose }: AddWidgetFlowProps) {
  const [where, setWhere] = useState<AddWhere>(initialWhere)
  const addKind = useAddKind(addWhereTarget(cellId, where))
  const addBreakdown = useAddBreakdown(addWhereTarget(cellId, where))
  const lead: MenuEntry[] = [{
    kind: 'segmented',
    label: 'Where',
    options: ADD_WHERE_OPTIONS,
    value: where,
    onChange: (value) => { if (isAddWhere(value)) setWhere(value) },
  }]
  return (
    <WidgetKindMenu
      anchor={anchor}
      heading="Add widget"
      unavailableKinds={useUnavailableKinds()}
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
 * by group under its caption (Tasks, Numbers & charts): adds that widget at
 * `target` (`useAddKind` — a list opens its Edit list).
 */
export function AddWidgetButtons({ target, buttonClassName, iconClassName, iconSize }: AddWidgetButtonsProps) {
  const addKindOnly = useAddKind(target)
  const addBreakdown = useAddBreakdown(target)
  // A Breakdown's button adds a Custom one (its editor opens).
  const addKind = (kind: WidgetKind) => (kind === 'breakdown' ? addBreakdown('custom') : addKindOnly(kind))
  const unavailable = useUnavailableKinds()
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
                disabled={unavailable?.[kind] != null}
                title={unavailable?.[kind]}
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
