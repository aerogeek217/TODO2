import { createPortal } from 'react-dom'
import { ListDefinitionPickerBody } from './ListDefinitionPickerBody'
import type { CopySource } from '../../hooks/use-copy-sources'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  onSelect: (listDefinitionId: number) => void
  /** "Create new list…" (a new list of the layout); omit to offer none. */
  onCreateNew?: () => void
  /** "Copy of ›" (a copy of any layout's list, or the Eisenhower's, for the layout); omit to offer none. */
  onCopyOf?: (source: CopySource) => void
  onClose: () => void
  /** Ids to hide from the picker. Omit to show every def. */
  excludeIds?: number[]
  /** Heading above the list. */
  header?: string
  /** The stored layout whose tab picks the list: the lists it owns are offered. */
  layoutId?: number
}

const WIDTH_PX = 280

export function ListDefinitionPickerPopup({ x, y, onSelect, onCreateNew, onCopyOf, onClose, excludeIds, header = 'Add list', layoutId }: Props) {
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
        onCreateNew={onCreateNew ? () => { onCreateNew(); onClose() } : undefined}
        onCopyOf={onCopyOf ? (source) => { onCopyOf(source); onClose() } : undefined}
      />
    </div>,
    document.body
  )
}
