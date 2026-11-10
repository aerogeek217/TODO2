import { SAVE_UNREADABLE_TITLE, type EditorDraft } from './editor-draft'
import styles from './EditorFooter.module.css'

/**
 * A widget editor's foot (the Number's, a chart's, Project pulse's):
 * Discard · Save, as Edit list's Revert · Save list — the quiet button
 * first, the accent one last. Save is off while nothing changed or while a
 * filter expression doesn't read; Discard closes without writing.
 */
export function EditorFooter({ draft }: { draft: Pick<EditorDraft<object>, 'changed' | 'canSave' | 'save' | 'discard'> }) {
  const unreadable = draft.changed && !draft.canSave
  return (
    <footer className={styles.footer}>
      <span className={styles.note} aria-live="polite">{draft.changed ? 'Unsaved changes' : ''}</span>
      <button type="button" className={styles.button} onClick={draft.discard}>
        Discard
      </button>
      <button
        type="button"
        className={`${styles.button} ${styles.save}`}
        disabled={!draft.canSave}
        title={unreadable ? SAVE_UNREADABLE_TITLE : undefined}
        onClick={draft.save}
      >
        Save
      </button>
    </footer>
  )
}
