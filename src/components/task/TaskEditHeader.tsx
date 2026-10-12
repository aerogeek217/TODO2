import type { AutocompleteRow, AutocompleteState } from '../../hooks/use-nlp-autocomplete'
import { NlpPopup } from '../shared/NlpPopup'
import styles from './TaskEditPopup.module.css'

interface TaskEditHeaderProps {
  isEdit: boolean
  isCompleted?: boolean
  title: string
  mode: 'edit' | 'create'
  titleRef: React.RefObject<HTMLInputElement | null>
  onToggleComplete: () => void
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onTitleBlur: () => void
  onTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onClose: () => void
  acState: AutocompleteState
  onAcPick: (row: AutocompleteRow) => void
  /** Draft mode: a dashed ring instead of the checkbox and a Draft badge. */
  isDraft?: boolean
}

export function TaskEditHeader({
  isEdit, isCompleted, title, mode, titleRef,
  onToggleComplete, onTitleChange, onTitleBlur, onTitleKeyDown,
  onClose, acState, onAcPick, isDraft = false,
}: TaskEditHeaderProps) {
  return (
    <div className={styles.header}>
      {isDraft && <span className={styles.draftRing} aria-hidden="true" />}
      {isEdit && (
        <input
          type="checkbox"
          className={styles.checkboxLarge}
          checked={isCompleted}
          onChange={onToggleComplete}
        />
      )}
      <div className={styles.titleWrapper}>
        <input
          ref={titleRef}
          className={styles.titleInput}
          value={title}
          maxLength={500}
          onChange={onTitleChange}
          onBlur={onTitleBlur}
          onKeyDown={onTitleKeyDown}
          placeholder={mode === 'create' ? 'New task… (@person #tag /command)' : 'Task title'}
        />
        {acState.visible && acState.view && (
          <NlpPopup
            view={acState.view}
            selectedIndex={acState.selectedIndex}
            onPick={onAcPick}
            className={styles.titlePopup}
            style={{ left: acState.caretLeft }}
          />
        )}
      </div>
      {isDraft && <span className={styles.draftBadge}>Draft</span>}
      <button className={styles.closeButton} onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  )
}
