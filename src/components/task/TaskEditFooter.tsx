import type { PersistedTodoItem } from '../../models'
import { formatDate, formatRelativeTime } from '../../utils/date'
import styles from './TaskEditPopup.module.css'

interface TaskEditFooterEditProps {
  mode: 'edit'
  todo: PersistedTodoItem
  onClose: () => void
  onCreate?: never
  titleValid?: never
}

interface TaskEditFooterCreateProps {
  mode: 'create'
  todo?: never
  onClose: () => void
  onCreate: () => void
  titleValid: boolean
  /** Draft mode: Save draft instead of Create task; nothing is stored. */
  isDraft?: boolean
}

type TaskEditFooterProps = TaskEditFooterEditProps | TaskEditFooterCreateProps

export function TaskEditFooter(props: TaskEditFooterProps) {
  const { mode, onClose } = props

  if (mode === 'edit') {
    return <EditFooter todo={props.todo} onClose={onClose} />
  }

  if (props.isDraft) {
    return (
      <div className={`${styles.createFooter} ${styles.draftFooter}`}>
        <span className={styles.draftNote}>Nothing is saved until you create the tasks</span>
        <button className={styles.cancelButton} onClick={onClose}>
          Cancel <kbd className={styles.footerKbd}>Esc</kbd>
        </button>
        <button
          className={styles.saveButton}
          disabled={!props.titleValid}
          onClick={props.onCreate}
        >
          Save draft
        </button>
      </div>
    )
  }

  return (
    <div className={styles.createFooter}>
      <button className={styles.cancelButton} onClick={onClose}>Cancel</button>
      <button
        className={styles.saveButton}
        disabled={!props.titleValid}
        onClick={props.onCreate}
      >
        Create task
      </button>
    </div>
  )
}

/**
 * Edit mode's footer (board BJ): when the task was created and last
 * modified, then Done. Duplicate, Make subtask of… and Delete are the
 * header's ⋯ menu's.
 */
function EditFooter({ todo, onClose }: { todo: PersistedTodoItem; onClose: () => void }) {
  return (
    <div className={styles.footer}>
      <span className={styles.timestamps}>
        Created {formatDate(todo.createdAt)} · Modified {formatRelativeTime(todo.modifiedAt)}
      </span>
      <button className={styles.saveButton} onClick={onClose}>
        Done
      </button>
    </div>
  )
}
