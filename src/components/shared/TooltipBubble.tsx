import type { RefObject } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './Tooltip.module.css'

const GAP_PX = 6

/**
 * The tooltip panel `useTooltip` (and `HelpTip`) shows: portaled and placed by
 * `usePopoverAnchor` — centred below the trigger (above when there's no room),
 * kept inside the viewport. Escape, a scroll or a window resize closes it.
 * `prose`: a description in plain sentences — wider, regular weight, no label line.
 */
export function TooltipBubble({ id, anchorRef, text, shortcut, labelLines = 1, prose = false, consumeEscape = false, onClose }: {
  id: string
  anchorRef: RefObject<HTMLElement | null>
  text: string
  shortcut?: string
  /** How many of the text's first lines are the label; the rest are muted. */
  labelLines?: number
  /** A description in sentences: wider, regular weight, every line alike. */
  prose?: boolean
  /** The Escape that closes it goes no further (a dialog behind it stays open). */
  consumeEscape?: boolean
  onClose: () => void
}) {
  const { panelRef, style, placed } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: anchorRef },
    open: true,
    placement: 'bottom-center',
    offset: GAP_PX,
    closeOnOutsideClick: false,
    consumeEscape,
    onClose,
    contentKey: `${text}|${shortcut ?? ''}`,
  })

  if (prose) {
    return createPortal(
      <div
        ref={panelRef}
        id={id}
        role="tooltip"
        className={`${styles.tooltip} ${styles.prose}`}
        style={{ left: style.left, top: style.top }}
        data-placed={placed ? 'true' : undefined}
      >
        {text}
      </div>,
      document.body,
    )
  }
  const lines = text.split('\n')
  const first = lines.slice(0, labelLines).join('\n')
  const rest = lines.slice(labelLines)
  const multiLine = lines.length > 1
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
