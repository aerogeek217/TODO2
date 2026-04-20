import { useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  /**
   * 'dashboard' (default): defs already in the grid are filtered out, action pins.
   * 'canvas': every def is shown, action fires `onSelect(id)` and the caller
   *   decides what to do with it (typically: create an inset referencing it).
   */
  mode?: 'dashboard' | 'canvas'
  onSelect?: (listDefinitionId: number) => void
  onCreateNew: () => void
  onClose: () => void
  /** Dashboard mode: render a "Notes" pseudo-entry that triggers `onPinNotes`. */
  showNotesEntry?: boolean
  onPinNotes?: () => void
  /**
   * Dashboard mode: ids to hide (already in the "Your lists" grid). When
   * provided, overrides the legacy `pinnedToDashboard` filter so horizon-mapped
   * defs remain pickable even though they stay pinned for the ribbon.
   */
  excludeIds?: number[]
  /**
   * Dashboard mode: override for the pin action. When provided, fires instead
   * of the store's `setPinned(id, true)`. Used to append to
   * `settings.dashboardUserLists`.
   */
  onPin?: (listDefinitionId: number) => void
}

const WIDTH_PX = 280
const EST_HEIGHT_PX = 320
const MARGIN_PX = 8

export function ListDefinitionPickerPopup({ x, y, mode = 'dashboard', onSelect, onCreateNew, onClose, showNotesEntry = false, onPinNotes, excludeIds, onPin }: Props) {
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
    if (mode === 'canvas') return all
    if (excludeIds != null) {
      const excluded = new Set(excludeIds)
      return all.filter(d => d.id != null && !excluded.has(d.id))
    }
    return all.filter(d => !d.pinnedToDashboard)
  }, [listDefinitions, mode, excludeIds])

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  const headerLabel = mode === 'canvas' ? 'Add list to canvas' : 'Add to Dashboard'
  const emptyLabel = mode === 'canvas' ? 'No lists yet.' : 'All lists are already pinned.'
  const actionLabel = mode === 'canvas' ? 'Add' : 'Pin'

  const showNotes = mode === 'dashboard' && showNotesEntry && onPinNotes != null
  const isEmpty = items.length === 0 && !showNotes

  return createPortal(
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
              {showNotes && (
                <button
                  key="__notes__"
                  className={styles.item}
                  onClick={() => { onPinNotes?.(); onClose() }}
                >
                  <span className={styles.itemName}>Notes</span>
                  <span className={styles.itemAction}>Pin</span>
                </button>
              )}
              {items.map(d => (
                <button
                  key={d.id}
                  className={styles.item}
                  onClick={async () => {
                    if (mode === 'canvas') {
                      onSelect?.(d.id)
                    } else if (onPin) {
                      onPin(d.id as number)
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
    </div>,
    document.body
  )
}
