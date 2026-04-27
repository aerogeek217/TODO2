import { createPortal } from 'react-dom'
import { ListDefinitionPickerBody } from './ListDefinitionPickerBody'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  onSelect: (listDefinitionId: number) => void
  onCreateNew: () => void
  onClose: () => void
  /** Ids to hide from the picker. Omit to show every def. */
  excludeIds?: number[]
}

const WIDTH_PX = 280

export function ListDefinitionPickerPopup({ x, y, onSelect, onCreateNew, onClose, excludeIds }: Props) {
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
        header="Add list to canvas"
        actionLabel="Add"
        excludeIds={excludeIds}
        onPick={(id) => { onSelect(id); onClose() }}
        onCreateNew={() => { onCreateNew(); onClose() }}
      />
    </div>,
    document.body
  )
}
