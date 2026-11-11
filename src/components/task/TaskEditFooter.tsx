import type { PersistedTodoItem } from '../../models'
import { useToday } from '../../hooks/use-today'
import { isFollowedUpToday } from '../../utils/followup'
import { MarkFollowedUpButton } from '../shared/followup/MarkFollowedUpButton'
import styles from './TaskEditPopup.module.css'

interface TaskEditFooterEditProps {
  mode: 'edit'
  todo: PersistedTodoItem
  onClose: () => void
  /** Mark followed up (the editor's rule: bulk-aware where the view says so). */
  onFollowedUp: () => void
  onCreate?: never
  titleValid?: never
}

interface TaskEditFooterCreateProps {
  mode: 'create'
  todo?: never
  onClose: () => void
  onFollowedUp?: never
  onCreate: () => void
  titleValid: boolean
  /** Draft mode: Save draft instead of Create task; nothing is stored. */
  isDraft?: boolean
}

type TaskEditFooterProps = TaskEditFooterEditProps | TaskEditFooterCreateProps

export function TaskEditFooter(props: TaskEditFooterProps) {
  const { mode, onClose } = props

  if (mode === 'edit') {
    return <EditFooter todo={props.todo} onClose={onClose} onFollowedUp={props.onFollowedUp} />
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
 * Edit mode's footer (task layout A): the one Mark followed up, then Done.
 * When the task was created and last modified is at the foot of the facts
 * rail; Duplicate, Make subtask of… and Delete are the header's ⋯ menu's.
 */
function EditFooter({ todo, onClose, onFollowedUp }: { todo: PersistedTodoItem; onClose: () => void; onFollowedUp: () => void }) {
  const today = useToday()
  return (
    <div className={styles.footer}>
      <MarkFollowedUpButton className={styles.footerFollowedUp} doneToday={isFollowedUpToday(todo, today)} onClick={onFollowedUp} />
      <button className={styles.saveButton} onClick={onClose}>
        Done
      </button>
    </div>
  )
}
