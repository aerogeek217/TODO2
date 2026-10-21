import { WIDGET_KIND_SPECS, WIDGET_KINDS, widgetKindLabel, type WidgetKind } from '../../models/workspace-layout'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { WidgetKindIcon } from '../shared/icons'
import { createListThenEdit, NO_LIST_LAYOUT_REASON, useAddWidget, useListOwnerLayoutId } from './widget-hooks'

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
    if (layoutId != null) createListThenEdit((id) => add('lens', target, id), layoutId)
  }
}

/** The kinds that can't be added to the open layout yet, with why (a list, while the layout isn't stored). */
function useUnavailableKinds(): Partial<Record<WidgetKind, string>> | undefined {
  const layoutId = useListOwnerLayoutId()
  if (layoutId != null) return undefined
  return Object.fromEntries(WIDGET_KINDS.filter((k) => WIDGET_KIND_SPECS[k].showsList).map((k) => [k, NO_LIST_LAYOUT_REASON]))
}

interface AddWidgetFlowProps {
  target: LayoutDropTarget
  anchor: { x: number; y: number }
  onClose: () => void
}

/** The add-tab `+` menu: picks a kind and adds that widget at `target` (`useAddKind`). */
export function AddWidgetFlow({ target, anchor, onClose }: AddWidgetFlowProps) {
  const addKind = useAddKind(target)
  return (
    <WidgetKindMenu
      anchor={anchor}
      heading="Add widget"
      unavailableKinds={useUnavailableKinds()}
      onChangeKind={addKind}
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
 * One button per widget kind (an empty layout's tiles, an empty cell's row):
 * adds that widget at `target` (`useAddKind` — a list opens its Edit list).
 */
export function AddWidgetButtons({ target, buttonClassName, iconClassName, iconSize }: AddWidgetButtonsProps) {
  const addKind = useAddKind(target)
  const unavailable = useUnavailableKinds()
  return (
    <>
      {WIDGET_KINDS.map((kind) => (
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
    </>
  )
}
