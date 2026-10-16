import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './Tooltip.module.css'

const GAP_PX = 6

/**
 * The tooltip panel `useTooltip` shows: portaled and placed by
 * `usePopoverAnchor` — centred below the trigger (above when there's no room),
 * kept inside the viewport. Escape, a scroll or a window resize closes it.
 */
export function TooltipBubble({ id, anchorRef, text, shortcut, onClose }: {
  id: string
  anchorRef: RefObject<HTMLElement | null>
  text: string
  shortcut?: string
  onClose: () => void
}) {
  const { panelRef, style, placed } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'bottom-center',
    offset: GAP_PX,
    closeOnOutsideClick: false,
    onClose,
    contentKey: `${text}|${shortcut ?? ''}`,
  })

  const [first = '', ...rest] = text.split('\n')
  const multiLine = rest.length > 0
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="tooltip"
      className={`${styles.tooltip} ${multiLine ? styles.multiLine : ''}`}
      style={{ left: style.left, top: style.top }}
      data-placed={placed ? 'true' : undefined}
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
