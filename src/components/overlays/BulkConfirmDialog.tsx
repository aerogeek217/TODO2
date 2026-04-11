import type { BulkConfirmation } from '../../stores/ui-store'
import styles from './ReassignDialog.module.css'

interface BulkConfirmDialogProps {
  confirmation: BulkConfirmation
  onConfirm: () => void
  onCancel: () => void
}

const messages: Record<BulkConfirmation['action'], (count: number) => string> = {
  delete: (n) => n === 1 ? 'Delete this task?' : `Delete ${n} tasks?`,
  complete: (n) => n === 1 ? 'Mark this task as complete?' : `Mark ${n} tasks as complete?`,
  uncomplete: (n) => n === 1 ? 'Mark this task as incomplete?' : `Mark ${n} tasks as incomplete?`,
  custom: () => 'Are you sure?',
}

const titles: Record<BulkConfirmation['action'], (count: number) => string> = {
  delete: (n) => n === 1 ? 'Delete task' : 'Delete tasks',
  complete: (n) => n === 1 ? 'Complete task' : 'Complete tasks',
  uncomplete: (n) => n === 1 ? 'Uncomplete task' : 'Uncomplete tasks',
  custom: () => 'Confirm',
}

const confirmLabels: Record<BulkConfirmation['action'], string> = {
  delete: 'Delete',
  complete: 'Complete',
  uncomplete: 'Uncomplete',
  custom: 'Confirm',
}

export function BulkConfirmDialog({ confirmation, onConfirm, onCancel }: BulkConfirmDialogProps) {
  const title = confirmation.title ?? titles[confirmation.action](confirmation.ids.length)
  const message = confirmation.message ?? messages[confirmation.action](confirmation.ids.length)
  const confirmLabel = confirmation.confirmLabel ?? confirmLabels[confirmation.action]
  const cancelLabel = confirmation.cancelLabel ?? 'Cancel'

  return (
    <>
      <div className={styles.backdrop} onClick={onCancel} />
      <div className={styles.dialog}>
        <div className={styles.title}>{title}</div>
        <div className={styles.body}>{message}</div>
        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={onCancel}>{cancelLabel}</button>
          <button className={styles.confirmButton} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </>
  )
}
