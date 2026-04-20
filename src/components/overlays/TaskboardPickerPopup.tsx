import { useEffect, useMemo, useRef, useState } from 'react'
import { useTaskboardStore } from '../../stores/taskboard-store'
import styles from './ListDefinitionPickerPopup.module.css'

interface Props {
  x: number
  y: number
  currentTaskboardId?: number
  onSelect: (taskboardId: number) => void
  onClose: () => void
}

const WIDTH_PX = 280
const EST_HEIGHT_PX = 260
const MARGIN_PX = 8

export function TaskboardPickerPopup({ x, y, currentTaskboardId, onSelect, onClose }: Props) {
  const popupRef = useRef<HTMLDivElement>(null)
  const boards = useTaskboardStore((s) => s.boards)
  const createBoard = useTaskboardStore((s) => s.createBoard)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

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
    return Array.from(boards.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [boards])

  const clampedX = Math.min(x, window.innerWidth - WIDTH_PX - MARGIN_PX)
  const clampedY = Math.min(y, window.innerHeight - EST_HEIGHT_PX - MARGIN_PX)

  const handleCreate = async () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const id = await createBoard(trimmed)
    onSelect(id)
    onClose()
  }

  return (
    <div
      ref={popupRef}
      className={styles.popup}
      style={{ left: Math.max(MARGIN_PX, clampedX), top: Math.max(MARGIN_PX, clampedY), width: WIDTH_PX }}
    >
      <div className={styles.header}>Choose taskboard</div>
      {items.length === 0 ? (
        <div className={styles.empty}>No taskboards yet.</div>
      ) : (
        <div className={styles.list}>
          {items.map(b => b.id != null && (
            <button
              key={b.id}
              className={styles.item}
              onClick={() => { onSelect(b.id!); onClose() }}
            >
              <span className={styles.itemName}>{b.name}</span>
              <span className={styles.itemAction}>
                {b.id === currentTaskboardId ? '✓' : 'Pick'}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className={styles.footer}>
        {creating ? (
          <form
            onSubmit={(e) => { e.preventDefault(); void handleCreate() }}
            style={{ display: 'flex', gap: 4 }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Taskboard name"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="submit" disabled={!name.trim()}>Create</button>
          </form>
        ) : (
          <button className={styles.createBtn} onClick={() => setCreating(true)}>
            + Create new taskboard…
          </button>
        )}
      </div>
    </div>
  )
}
