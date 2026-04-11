import type { PersistedTodoItem } from '../../models'
import { formatDate, formatRelativeTime } from '../../utils/date'
import styles from './TaskEditPopup.module.css'

interface TaskEditFooterEditProps {
  mode: 'edit'
  todo: PersistedTodoItem
  onDelete: () => void
  onDuplicate?: () => void
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
}

type TaskEditFooterProps = TaskEditFooterEditProps | TaskEditFooterCreateProps

export function TaskEditFooter(props: TaskEditFooterProps) {
  const { mode, onClose } = props

  if (mode === 'edit') {
    const { todo, onDelete, onDuplicate } = props
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
