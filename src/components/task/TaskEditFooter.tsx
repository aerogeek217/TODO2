import type { PersistedTodoItem } from '../../models'
import { formatDate, formatRelativeTime } from '../../utils/date'
import styles from './TaskEditPopup.module.css'

interface TaskEditFooterEditProps {
  mode: 'edit'
  todo: PersistedTodoItem
  onDelete: () => void
  onDuplicate?: () => void
  /** "Make subtask of…": the task becomes a line of another task's checklist (cr28). */
  onMakeSubtaskOf?: () => void
  onClose: () => void
  onCreate?: never
  titleValid?: never
}

interface TaskEditFooterCreateProps {
  mode: 'create'
  todo?: never
  onDelete?: never
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
    const { todo, onDelete, onDuplicate, onMakeSubtaskOf } = props
    return <EditFooter todo={todo} onDelete={onDelete} onDuplicate={onDuplicate} onMakeSubtaskOf={onMakeSubtaskOf} onClose={onClose} />
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

interface EditFooterProps {
  todo: PersistedTodoItem
  onDelete: () => void
  onDuplicate?: () => void
  onMakeSubtaskOf?: () => void
  onClose: () => void
}

function EditFooter({ todo, onDelete, onDuplicate, onMakeSubtaskOf, onClose }: EditFooterProps) {
  return (
    <div className={styles.footer}>
      <span className={styles.timestamps}>
        Created {formatDate(todo.createdAt)} · Modified {formatRelativeTime(todo.modifiedAt)}
      </span>
      <div className={styles.footerActions}>
        {onDuplicate && (
          <button className={styles.duplicateButton} onClick={onDuplicate}>
            Duplicate
          </button>
        )}
        {onMakeSubtaskOf && (
          <button className={styles.duplicateButton} onClick={onMakeSubtaskOf}>
            Make subtask of…
          </button>
        )}
        <button className={styles.deleteButton} onClick={onDelete}>
          Delete
        </button>
        <button className={styles.saveButton} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
