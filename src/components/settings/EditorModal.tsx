import { useId, type ReactNode } from 'react'
import { DialogFrame, type DialogInitialFocus, type DialogLayer } from '../shared/Dialog'
import styles from './EntityEditor.module.css'

export interface EditorModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  /** Extra panel class (e.g. a wider modal). */
  className?: string
  initialFocus?: DialogInitialFocus
  /** Default `dialog`; `nested` over any other dialog (opened from a picker in one). */
  layer?: DialogLayer
}

/**
 * The Settings editors' modal (People, Statuses, Tags, Theme colors,
 * Keyboard shortcuts, Quick-Add syntax): title + × over the editor, on the
 * shared dialog frame — Esc (an Esc an inline edit row handled stays its),
 * focus in / Tab wrap / focus back to the opener, a backdrop press, no app
 * shortcuts inside.
 */
export function EditorModal({ title, onClose, children, className, initialFocus, layer }: EditorModalProps) {
  const titleId = useId()
  return (
    <DialogFrame
      onClose={onClose}
      layer={layer}
      aria-labelledby={titleId}
      className={`${styles.modal} ${className ?? ''}`}
      initialFocus={initialFocus}
    >
      <div className={styles.header}>
        <div id={titleId} className={styles.title}>{title}</div>
        <button type="button" className={styles.closeBtn} onClick={onClose}>&times;</button>
      </div>
      {children}
    </DialogFrame>
  )
}
