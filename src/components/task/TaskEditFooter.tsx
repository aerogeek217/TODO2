import type { ReactNode } from 'react'
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
  /** The follow-up fields (`FollowupEditorGroup`), before Mark followed up. */
  followup: ReactNode
  onCreate?: never
  titleValid?: never
}

interface TaskEditFooterCreateProps {
  mode: 'create'
  todo?: never
  onClose: () => void
  onFollowedUp?: never
  /** The follow-up fields (`FollowupEditorGroup`), before Cancel. */
  followup: ReactNode
  onCreate: () => void
  titleValid: boolean
  /** Draft mode: Save draft instead of Create task; nothing is stored. */
  isDraft?: boolean
}

type TaskEditFooterProps = TaskEditFooterEditProps | TaskEditFooterCreateProps

/**
 * The task editor's footer (task layout B): the follow-up fields
 * (`Last [date] · Next [date] [1w][2w][1m][3m]`), then edit mode's Mark
 * followed up and Done, or create mode's Cancel and Create task (a draft's
 * Save draft, after its note). Its width is the container the fields' fold
 * is measured on (`TaskEditPopup.module.css`); on a phone it wraps.
 */
export function TaskEditFooter(props: TaskEditFooterProps) {
  const { mode, onClose, followup } = props

  if (mode === 'edit') {
    return <EditFooter todo={props.todo} onClose={onClose} onFollowedUp={props.onFollowedUp} followup={followup} />
  }

  if (props.isDraft) {
    return (
      <div className={`${styles.footer} ${styles.draftFooter}`} data-task-footer="">
        <span className={styles.draftNote}>Nothing is saved until you create the tasks</span>
        {followup}
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
    <div className={`${styles.footer} ${styles.createFooter}`} data-task-footer="">
      {followup}
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
 * Edit mode's footer: the follow-up fields, the one Mark followed up, then
 * Done. When the task was created and last modified is the header's;
 * Duplicate, Make subtask of… and Delete are the header's ⋯ menu's.
 */
function EditFooter({ todo, onClose, onFollowedUp, followup }: {
  todo: PersistedTodoItem
  onClose: () => void
  onFollowedUp: () => void
  followup: ReactNode
}) {
  const today = useToday()
  return (
    <div className={styles.footer} data-task-footer="">
      {followup}
      <MarkFollowedUpButton className={styles.footerFollowedUp} doneToday={isFollowedUpToday(todo, today)} onClick={onFollowedUp} />
      <button className={styles.saveButton} onClick={onClose}>
        Done
      </button>
    </div>
  )
}
