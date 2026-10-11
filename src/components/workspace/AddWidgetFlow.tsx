import { useRef, useState } from 'react'
import type { WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'
import { WidgetKindMenu } from '../shared/WidgetKindMenu'
import { ListDefinitionPickerPopup } from '../overlays/ListDefinitionPickerPopup'
import { useAddWidget } from './widget-hooks'

/** A list name not used by any saved list: "New list", "New list 2", … */
function freshListName(): string {
  const taken = new Set(useListDefinitionStore.getState().listDefinitions.map((d) => d.name.toLowerCase()))
  let name = 'New list'
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New list ${n}`
  return name
}

interface AddWidgetFlowProps {
  target: LayoutDropTarget
  anchor: { x: number; y: number }
  /** Skip the kind menu (e.g. a kind button was clicked); only `lens` needs this flow then. */
  kind?: WidgetKind
  onClose: () => void
}

/**
 * Adds a widget at `target`: picks the kind (unless `kind` is given), then —
 * for a list — which saved list to show ("Create new" makes a blank list and
 * opens the list editor on it). A list tab is never added without a list.
 */
export function AddWidgetFlow({ target, anchor, kind, onClose }: AddWidgetFlowProps) {
  const [step, setStep] = useState<'kind' | 'list'>(kind === 'lens' ? 'list' : 'kind')
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
          if (k === 'lens') {
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
      onCreateNew={() => {
        void useListDefinitionStore.getState().add({ name: freshListName() }).then((id) => {
          add('lens', target, id)
          useUIStore.getState().openListsEditor(id)
        })
      }}
      onClose={onClose}
    />
  )
}
