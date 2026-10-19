import type { ReactNode, RefObject } from 'react'
import styles from './ClearableField.module.css'

interface ClearableFieldProps {
  /** The text input (one `<input>`). */
  children: ReactNode
  /** The input's current text: the × shows only while there is some. */
  value: string
  /** Empties the field (the host's state). */
  onClear: () => void
  /** The input, focused again after a clear. */
  inputRef: RefObject<HTMLInputElement | null>
  /** The × button's name, e.g. `Clear search`. */
  label: string
  className?: string
}

/**
 * A text field with a round × at its right end while it has text (the
 * follow-up pill's ×). A click empties it and puts the focus back in the
 * field, so the picker around it stays open. The × is a mouse target only —
 * not a Tab stop; Esc and select-all + Backspace keep their meaning.
 */
export function ClearableField({ children, value, onClear, inputRef, label, className }: ClearableFieldProps) {
  const show = value.length > 0
  return (
    <div className={`${styles.field} ${className ?? ''}`} data-clearable={show ? '' : undefined}>
      {children}
      {show && (
        <button
          type="button"
          className={styles.clear}
          tabIndex={-1}
          aria-label={label}
          // The press keeps the focus (and the caret) in the field.
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.stopPropagation()
            onClear()
            inputRef.current?.focus()
          }}
        >
          &times;
        </button>
      )}
    </div>
  )
}
