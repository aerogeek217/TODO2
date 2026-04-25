import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ListDefinitionPickerBody } from './ListDefinitionPickerBody'
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
const EST_HEIGHT_PX = 320
const MARGIN_PX = 8

export function ListDefinitionPickerPopup({ x, y, onSelect, onCreateNew, onClose, excludeIds }: Props) {
  const popupRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) onClose()
    }
    const keyHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler, true)
    document.addEventListener('keydown', keyHandler, true)
    return () => {
      document.removeEventListener('mousedown', handler, true)
      document.removeEventListener('keydown', keyHandler, true)
    }
  }, [onClose])

  useEffect(() => {
    if (!popupRef.current) return
    const rect = popupRef.current.getBoundingClientRect()
    if (rect.right > window.innerWidth) {
      popupRef.current.style.left = `${window.innerWidth - rect.width - MARGIN_PX}px`
    }
    if (rect.bottom > window.innerHeight) {
      popupRef.current.style.top = `${window.innerHeight - rect.height - MARGIN_PX}px`
    }
  }, [x, y])

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  return createPortal(
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left: Math.max(MARGIN_PX, clampedX), top: Math.max(MARGIN_PX, clampedY), width: WIDTH_PX }}
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
