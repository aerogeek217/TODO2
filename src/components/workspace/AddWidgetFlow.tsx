import { useRef, useState } from 'react'
import { WIDGET_KIND_SPECS, WIDGET_KINDS, widgetKindLabel, type WidgetKind } from '../../models/workspace-layout'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../overlays/ListDefinitionPickerPopup'
import { WidgetKindIcon } from '../shared/icons'
import { createListThenEdit, useAddWidget } from './widget-hooks'

interface AddWidgetFlowProps {
  target: LayoutDropTarget
  anchor: { x: number; y: number }
  /** Skip the kind menu (a kind button was clicked); only a kind that shows a list needs this flow then. */
  kind?: WidgetKind
  onClose: () => void
}

/**
 * Adds a widget at `target`: picks the kind (unless `kind` is given), then —
 * for a list — which saved list to show ("Create new" makes a blank list and
 * opens that list's editor). A list tab is never added without a list.
 */
export function AddWidgetFlow({ target, anchor, kind, onClose }: AddWidgetFlowProps) {
  const [step, setStep] = useState<'kind' | 'list'>(kind != null && WIDGET_KIND_SPECS[kind].showsList ? 'list' : 'kind')
  // The kind menu closes itself after a pick; picking "List" moves on to the
  // list picker instead of ending the flow.
  const movingOnRef = useRef(false)
  const add = useAddWidget()

  if (step === 'kind') {
    return (
      <WidgetKindMenu
        anchor={anchor}
        heading="Add widget"
        onChangeKind={(k) => {
          if (WIDGET_KIND_SPECS[k].showsList) {
            movingOnRef.current = true
            setStep('list')
            return
          }
          add(k, target)
        }}
        onClose={() => { if (!movingOnRef.current) onClose() }}
      />
    )
  }

  return (
    <ListDefinitionPickerPopup
      x={anchor.x}
      y={anchor.y}
      header="Add list"
      onSelect={(id) => { add('lens', target, id) }}
      onCreateNew={() => createListThenEdit((id) => add('lens', target, id))}
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
 * adds that widget at `target`, or — for a kind that shows a list — opens
 * the list picker under the button first.
 */
export function AddWidgetButtons({ target, buttonClassName, iconClassName, iconSize }: AddWidgetButtonsProps) {
  const add = useAddWidget()
  const [listFlow, setListFlow] = useState<{ kind: WidgetKind; anchor: { x: number; y: number } } | null>(null)
  return (
    <>
      {WIDGET_KINDS.map((kind) => (
        <button
          key={kind}
          type="button"
          className={buttonClassName}
          onClick={(e) => {
            if (WIDGET_KIND_SPECS[kind].showsList) {
              const r = e.currentTarget.getBoundingClientRect()
              setListFlow({ kind, anchor: { x: r.left, y: r.bottom + 4 } })
              return
            }
            add(kind, target)
          }}
        >
          <span className={iconClassName}><WidgetKindIcon kind={kind} size={iconSize} /></span>
          {widgetKindLabel(kind)}
        </button>
      ))}
      {listFlow && (
        <AddWidgetFlow kind={listFlow.kind} target={target} anchor={listFlow.anchor} onClose={() => setListFlow(null)} />
      )}
    </>
  )
}
