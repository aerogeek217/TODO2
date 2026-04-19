import { useEffect, useMemo, useRef } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  /**
   * 'dashboard' (default): only unpinned defs are shown, action pins.
   * 'canvas': every def is shown, action fires `onSelect(id)` and the caller
   *   decides what to do with it (typically: create an inset referencing it).
   */
  mode?: 'dashboard' | 'canvas'
  onSelect?: (listDefinitionId: number) => void
  onCreateNew: () => void
  onClose: () => void
}

const WIDTH_PX = 280
const EST_HEIGHT_PX = 320
const MARGIN_PX = 8

export function ListDefinitionPickerPopup({ x, y, mode = 'dashboard', onSelect, onCreateNew, onClose }: Props) {
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

  const items = useMemo(() => {
    const all = [...listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    return mode === 'canvas' ? all : all.filter(d => !d.pinnedToDashboard)
  }, [listDefinitions, mode])

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  const headerLabel = mode === 'canvas' ? 'Add list to canvas' : 'Add to Dashboard'
  const emptyLabel = mode === 'canvas' ? 'No lists yet.' : 'All lists are already pinned.'
  const actionLabel = mode === 'canvas' ? 'Add' : 'Pin'

  const isEmpty = items.length === 0

  return (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left: Math.max(MARGIN_PX, clampedX), top: Math.max(MARGIN_PX, clampedY), width: WIDTH_PX }}
    >
      <div className={styles.header}>{headerLabel}</div>
      {isEmpty && mode === 'dashboard' ? (
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
          {isEmpty ? (
            <div className={styles.empty}>{emptyLabel}</div>
          ) : (
            <div className={styles.list}>
              {items.map(d => (
                <button
                  key={d.id}
                  className={styles.item}
                  onClick={async () => {
                    if (mode === 'canvas') {
                      onSelect?.(d.id)
                    } else {
                      await setPinned(d.id, true)
                    }
                    onClose()
                  }}
                >
                  <span className={styles.itemName}>{d.name}</span>
                  <span className={styles.itemAction}>{actionLabel}</span>
                </button>
              ))}
            </div>
          )}
          <div className={styles.footer}>
            <button className={styles.createBtn} onClick={() => { onCreateNew(); onClose() }}>
              + Create new list…
            </button>
          </div>
        </>
      )}
    </div>
  )
}
