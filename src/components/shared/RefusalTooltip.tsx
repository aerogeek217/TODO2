import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import tooltipStyles from './Tooltip.module.css'
import styles from './RefusalTooltip.module.css'

/** Offset from the pointer (below the lifted row). */
const REFUSAL_OFFSET = { x: 4, y: 26 }

/** A point in the viewport. */
export interface ViewportPoint {
  x: number
  y: number
}

/**
 * The tooltip of a refused drop (`Can’t move to …` / why / what to change):
 * beside the pointer, below the lifted row, shown at once, kept inside
 * `boundsRef`'s box. Follows `pointer`; with `followPointer` it follows the
 * pointer's moves itself from there (so its widget doesn't re-render on
 * every move).
 */
export function RefusalTooltip({ lines, pointer, boundsRef, followPointer = false, testId }: {
  lines: readonly string[]
  pointer: ViewportPoint
  boundsRef: React.RefObject<HTMLElement | null>
  followPointer?: boolean
  testId: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [moved, setMoved] = useState<ViewportPoint | null>(null)
  useEffect(() => {
    if (!followPointer) return
    const onMove = (e: PointerEvent) => setMoved({ x: e.clientX, y: e.clientY })
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [followPointer])
  const at = (followPointer ? moved : null) ?? pointer
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const b = el.getBoundingClientRect()
    const box = boundsRef.current?.getBoundingClientRect()
    const right = box ? box.right : window.innerWidth
    const bottom = box ? box.bottom : window.innerHeight
    let left = at.x + REFUSAL_OFFSET.x
    let top = at.y + REFUSAL_OFFSET.y
    if (left + b.width > right) left = Math.max(box?.left ?? 0, at.x - REFUSAL_OFFSET.x - b.width)
    if (top + b.height > bottom) top = Math.max(box?.top ?? 0, at.y - REFUSAL_OFFSET.y - b.height)
    setPos((prev) => (prev && prev.left === left && prev.top === top ? prev : { left, top }))
  }, [at.x, at.y, boundsRef, lines])
  const [first, ...rest] = lines
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className={`${tooltipStyles.tooltip} ${tooltipStyles.multiLine} ${styles.refusal}`}
      style={pos ?? { left: -9999, top: -9999 }}
      data-placed={pos ? 'true' : undefined}
      data-testid={testId}
    >
      <span>{first}</span>
      {rest.map((line, i) => <span key={i} className={tooltipStyles.line}>{line}</span>)}
    </div>,
    document.body,
  )
}
