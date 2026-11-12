import styles from './CellFace.module.css'

/**
 * The small face's keyboard way to its widget open larger (the widget
 * popup): a button over the body, seen only when focused (a click passes
 * through it to the face, whose click the body takes).
 */
export function SmallFaceOpener({ title, open, onOpen }: { title: string; open: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      className={styles.opener}
      aria-label={`Open ${title}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      data-face-opener=""
      onClick={(e) => {
        // The body's own click would open it again.
        e.preventDefault()
        onOpen()
      }}
    />
  )
}
