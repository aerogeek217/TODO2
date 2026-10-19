import { createPortal } from 'react-dom'
import { ListDefinitionPickerBody } from './ListDefinitionPickerBody'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  onSelect: (listDefinitionId: number) => void
  /** "Create new list…"; `layoutOnly` = This layout only was chosen (see `layoutId`). */
  onCreateNew: (layoutOnly: boolean) => void
  onClose: () => void
  /** Ids to hide from the picker. Omit to show every def. */
  excludeIds?: number[]
  /** Heading above the list. */
  header?: string
  /** The saved layout whose tab picks the list: its own lists are offered, and a new one may be made for it alone. */
  layoutId?: number
}

const WIDTH_PX = 280

export function ListDefinitionPickerPopup({ x, y, onSelect, onCreateNew, onClose, excludeIds, header = 'Add list', layoutId }: Props) {
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'point', x, y },
    open: true,
    closeOnScroll: false,
    closeOnResize: false,
    onClose,
  })

  return createPortal(
    <div
      ref={panelRef}
      className={styles.popup}
      style={{ ...style, width: WIDTH_PX }}
    >
      <ListDefinitionPickerBody
        header={header}
        actionLabel="Add"
        excludeIds={excludeIds}
        layoutId={layoutId}
        onPick={(id) => { onSelect(id); onClose() }}
        onCreateNew={(layoutOnly) => { onCreateNew(layoutOnly); onClose() }}
      />
    </div>,
    document.body
  )
}
