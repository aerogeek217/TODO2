import { useEffect, useMemo, useRef } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  onCreateNew: () => void
  onClose: () => void
}

const WIDTH_PX = 280
const EST_HEIGHT_PX = 320
const MARGIN_PX = 8

export function ListDefinitionPickerPopup({ x, y, onCreateNew, onClose }: Props) {
  const popupRef = useRef<HTMLDivElement>(null)
  const { listDefinitions, setPinned } = useListDefinitionStore()

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

  const unpinned = useMemo(
    () => [...listDefinitions].filter(d => !d.pinnedToDashboard).sort((a, b) => a.sortOrder - b.sortOrder),
    [listDefinitions],
  )

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  return (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left: Math.max(MARGIN_PX, clampedX), top: Math.max(MARGIN_PX, clampedY), width: WIDTH_PX }}
    >
      <div className={styles.header}>Add to Dashboard</div>
      {unpinned.length === 0 ? (
        <div className={styles.empty}>All lists are already pinned.</div>
      ) : (
        <div className={styles.list}>
          {unpinned.map(d => (
            <button
              key={d.id}
              className={styles.item}
              onClick={async () => { await setPinned(d.id, true); onClose() }}
            >
              <span className={styles.itemName}>{d.name}</span>
              <span className={styles.itemAction}>Pin</span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.footer}>
        <button className={styles.createBtn} onClick={() => { onCreateNew(); onClose() }}>
          + Create new list…
        </button>
      </div>
    </div>
  )
}
