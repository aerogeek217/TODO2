import type { AutocompleteState, AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { NlpAutocomplete } from '../shared/NlpAutocomplete'
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
  onAcSelect: (item: AutocompleteItem) => void
}

export function TaskEditHeader({
  isEdit, isCompleted, title, mode, titleRef,
  onToggleComplete, onTitleChange, onTitleBlur, onTitleKeyDown,
  onClose, acState, onAcSelect,
}: TaskEditHeaderProps) {
  return (
    <div className={styles.header}>
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
          placeholder={mode === 'create' ? 'New task... (@person @org #tag /project p1 tomorrow)' : 'Task title'}
        />
        <NlpAutocomplete state={acState} onSelect={onAcSelect} />
      </div>
      <button className={styles.closeButton} onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  )
}
