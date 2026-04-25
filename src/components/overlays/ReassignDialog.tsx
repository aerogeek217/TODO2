import { ConfirmDialog } from '../shared/Dialog'
import styles from './ReassignDialog.module.css'

interface ReassignDialogProps {
  taskTitle: string
  fromLabel: string
  toLabel: string
  onConfirm: () => void
  onCancel: () => void
}

export function ReassignDialog({
  taskTitle,
  fromLabel,
  toLabel,
  onConfirm,
  onCancel,
}: ReassignDialogProps) {
  const noun = 'person'

  return (
    <ConfirmDialog
      open
      title={`Reassign ${noun}`}
      message={
        <>
          Move <strong>{taskTitle}</strong> from <strong>{fromLabel}</strong> to <strong>{toLabel}</strong>?
          <div className={styles.detail}>
            This will remove the <em>{fromLabel}</em> {noun} and add <em>{toLabel}</em>.
          </div>
        </>
      }
      confirmLabel="Reassign"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  )
}
