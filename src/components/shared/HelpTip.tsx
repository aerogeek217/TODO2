import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { InfoIcon } from './icons'
import { TooltipBubble } from './TooltipBubble'
import styles from './HelpTip.module.css'

/** How long the pointer rests on the ⓘ before its description opens (shorter than a label tooltip's: the icon is there to be read). */
export const HELP_TIP_DELAY_MS = 200

/**
 * An ⓘ after a label that shows its description: on hover (after
 * {@link HELP_TIP_DELAY_MS}), on keyboard focus, or pinned by a click (a
 * second click, Escape, leaving focus or a scroll closes it). The text is
 * also in the DOM, visually hidden, as the button's description — so a
 * screen reader reads it without opening anything. Touch opens it only by a
 * tap. Escape closes the tip and goes no further (a dialog behind stays).
 */
export function HelpTip({ label, text, className }: {
  /** What the ⓘ is about: its button reads `About <label>`. */
  label: string
  text: string
  className?: string
}) {
  const descId = useId()
  const tipId = useId()
  const buttonRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<number | null>(null)
  /** `hover`: closes when the pointer leaves; `pinned`: stays until a click, Escape, blur or scroll. */
  const [open, setOpen] = useState<'hover' | 'pinned' | null>(null)

  const cancel = useCallback(() => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])
  const hide = useCallback(() => {
    cancel()
    setOpen(null)
  }, [cancel])
  useEffect(() => cancel, [cancel])

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.button}${open ? ` ${styles.open}` : ''}${className ? ` ${className}` : ''}`}
        aria-label={`About ${label}`}
        aria-describedby={descId}
        aria-expanded={open != null}
        data-help-tip=""
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch' || open) return
          cancel()
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null
            setOpen('hover')
          }, HELP_TIP_DELAY_MS)
        }}
        onPointerLeave={() => {
          cancel()
          setOpen((o) => (o === 'hover' ? null : o))
        }}
        onClick={() => {
          cancel()
          // A hover-opened tip is pinned by the click rather than closed by it.
          setOpen((o) => (o === 'pinned' ? null : 'pinned'))
        }}
        onFocus={(e) => {
          // Keyboard focus only — a click focuses the button too, and pins it itself.
          let keyboard = true
          try { keyboard = e.currentTarget.matches(':focus-visible') } catch { /* old engines */ }
          if (keyboard) setOpen('pinned')
        }}
        onBlur={hide}
      >
        <InfoIcon size={13} />
      </button>
      <span id={descId} className={styles.hidden}>{text}</span>
      {open && <TooltipBubble id={tipId} anchorRef={buttonRef} text={text} prose consumeEscape onClose={hide} />}
    </>
  )
}
