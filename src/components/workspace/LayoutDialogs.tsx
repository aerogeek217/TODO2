import { useRef, useState } from 'react'
import { Dialog, DialogActions, DialogBody } from '../shared/Dialog'
import { LAYOUT_NAME_MAX } from '../../models/workspace-layout'
import { deleteLayoutMessage } from './delete-layout-message'
import styles from './LayoutDialogs.module.css'

interface UnsavedChangesDialogProps {
  layoutName: string
  /** What the user is about to do, e.g. `You’re switching to “Daily”.` */
  lead: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** "Save changes to layout …?" — Save / Discard / Cancel before leaving a layout with unsaved changes. */
export function UnsavedChangesDialog({ layoutName, lead, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const saveRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open onClose={onCancel} title={`Save changes to layout “${layoutName}”?`} initialFocusRef={saveRef} nested>
      <DialogBody>
        {lead} If you don’t save, your changes to “{layoutName}” will be lost.
      </DialogBody>
      <DialogActions className={styles.actions}>
        <button type="button" className={styles.dangerGhost} onClick={onDiscard}>Discard</button>
        <span className={styles.spacer} />
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button ref={saveRef} type="button" className={styles.primary} onClick={onSave}>Save layout</button>
      </DialogActions>
    </Dialog>
  )
}

interface LayoutNameDialogProps {
  title: string
  confirmLabel: string
  initialName: string
  /** The empty field's hint (New layout, which starts empty). */
  placeholder?: string
  onConfirm: (name: string) => void
  onCancel: () => void
}

/** "New layout…" / "Save as new layout…" / "Rename…": one name field, prefilled and selected; empty can't be confirmed. */
export function LayoutNameDialog({ title, confirmLabel, initialName, placeholder, onConfirm, onCancel }: LayoutNameDialogProps) {
  const [name, setName] = useState(initialName)
  const inputRef = useRef<HTMLInputElement>(null)
  const trimmed = name.trim()
  const submit = () => { if (trimmed) onConfirm(trimmed) }
  return (
    <Dialog open onClose={onCancel} title={title} initialFocusRef={inputRef} nested>
      <form
        onSubmit={(e) => { e.preventDefault(); submit() }}
        className={styles.form}
      >
        <label className={styles.label}>
          Name
          <input
            ref={inputRef}
            className={styles.input}
            value={name}
            placeholder={placeholder}
            maxLength={LAYOUT_NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        <DialogActions>
          <button type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
          <button type="submit" className={styles.primary} disabled={!trimmed}>{confirmLabel}</button>
        </DialogActions>
      </form>
    </Dialog>
  )
}

interface DeleteLayoutDialogProps {
  layoutName: string
  /** How many of its lists go with it. */
  ownedLists?: number
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteLayoutDialog({ layoutName, ownedLists = 0, onConfirm, onCancel }: DeleteLayoutDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  return (
    <Dialog open onClose={onCancel} title={`Delete layout “${layoutName}”?`} initialFocusRef={cancelRef} nested>
      <DialogBody>{deleteLayoutMessage(ownedLists)}</DialogBody>
      <DialogActions>
        <button ref={cancelRef} type="button" className={styles.ghost} onClick={onCancel}>Cancel</button>
        <button type="button" className={styles.danger} onClick={onConfirm}>Delete layout</button>
      </DialogActions>
    </Dialog>
  )
}
