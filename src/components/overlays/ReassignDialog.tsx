import styles from './ReassignDialog.module.css'

interface ReassignDialogProps {
  taskTitle: string
  fromLabel: string
  toLabel: string
  attribute: 'person' | 'tag'
  onConfirm: () => void
  onCancel: () => void
}

export function ReassignDialog({
  taskTitle,
  fromLabel,
  toLabel,
  attribute,
  onConfirm,
  onCancel,
}: ReassignDialogProps) {
  const noun = attribute === 'person' ? 'person' : 'tag'

  return (
    <>
      <div className={styles.backdrop} onClick={onCancel} />
      <div className={styles.dialog}>
        <div className={styles.title}>Reassign {noun}</div>
        <div className={styles.body}>
          Move <strong>{taskTitle}</strong> from <strong>{fromLabel}</strong> to <strong>{toLabel}</strong>?
          <div className={styles.detail}>
            This will remove the <em>{fromLabel}</em> {noun} and add <em>{toLabel}</em>.
          </div>
        </div>
        <div className={styles.actions}>
          <button className={styles.cancelButton} onClick={onCancel}>Cancel</button>
          <button className={styles.confirmButton} onClick={onConfirm}>Reassign</button>
        </div>
      </div>
    </>
  )
}
