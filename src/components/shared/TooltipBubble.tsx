import { useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import styles from './Tooltip.module.css'

const GAP_PX = 6
const VIEWPORT_MARGIN_PX = 8

/**
 * The tooltip panel `useTooltip` shows: portaled, below the trigger (above
 * when there's no room), centred and kept inside the viewport.
 */
export function TooltipBubble({ id, anchorRef, text, shortcut }: {
  id: string
  anchorRef: RefObject<HTMLElement | null>
  text: string
  shortcut?: string
}) {
  const bubbleRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    const bubble = bubbleRef.current
    if (!anchor || !bubble) return
    const a = anchor.getBoundingClientRect()
    const b = bubble.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    let top = a.bottom + GAP_PX
    if (top + b.height > vh - VIEWPORT_MARGIN_PX && a.top - GAP_PX - b.height >= VIEWPORT_MARGIN_PX) {
      top = a.top - GAP_PX - b.height
    }
    let left = a.left + a.width / 2 - b.width / 2
    left = Math.min(left, vw - VIEWPORT_MARGIN_PX - b.width)
    left = Math.max(left, VIEWPORT_MARGIN_PX)
    setPos({ left, top })
  }, [anchorRef, text, shortcut])

  const [first = '', ...rest] = text.split('\n')
  const multiLine = rest.length > 0
  return createPortal(
    <div
      ref={bubbleRef}
      id={id}
      role="tooltip"
      className={`${styles.tooltip} ${multiLine ? styles.multiLine : ''}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
      data-placed={pos ? 'true' : undefined}
    >
      <span className={styles.label}>
        {first}
        {shortcut && <span className={styles.shortcut}> {shortcut}</span>}
      </span>
      {rest.map((line, i) => <span key={i} className={styles.line}>{line}</span>)}
    </div>,
    document.body,
  )
}
