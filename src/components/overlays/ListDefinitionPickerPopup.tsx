import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useListDefinitionStore } from '../../stores/list-definition-store'
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
  const { listDefinitions } = useListDefinitionStore()

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

  const items = useMemo(() => {
    const all = [...listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    if (excludeIds == null) return all
    const excluded = new Set(excludeIds)
    return all.filter(d => d.id != null && !excluded.has(d.id))
  }, [listDefinitions, excludeIds])

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  const isEmpty = items.length === 0

  return createPortal(
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left: Math.max(MARGIN_PX, clampedX), top: Math.max(MARGIN_PX, clampedY), width: WIDTH_PX }}
    >
      <div className={styles.header}>Add list to canvas</div>
      {isEmpty ? (
        <div className={styles.emptyCta}>
          <button
            type="button"
            className={styles.primaryCreateBtn}
            onClick={() => { onCreateNew(); onClose() }}
            autoFocus
          >
            + Create new list…
          </button>
        </div>
      ) : (
        <>
          <div className={styles.list}>
            {items.map(d => (
              <button
                key={d.id}
                className={styles.item}
                onClick={() => { onSelect(d.id as number); onClose() }}
              >
                <span className={styles.itemName}>{d.name}</span>
                <span className={styles.itemAction}>Add</span>
              </button>
            ))}
          </div>
          <div className={styles.footer}>
            <button className={styles.createBtn} onClick={() => { onCreateNew(); onClose() }}>
              + Create new list…
            </button>
          </div>
        </>
      )}
    </div>,
    document.body
  )
}
