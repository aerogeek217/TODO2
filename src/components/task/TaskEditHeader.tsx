import type { AutocompleteState } from '../../hooks/use-nlp-autocomplete'
import { NlpAutocomplete } from '../shared/NlpAutocomplete'
import styles from './TaskEditPopup.module.css'

interface TaskEditHeaderProps {
  isEdit: boolean
  isCompleted?: boolean
  title: string
  isStarred: boolean
  mode: 'edit' | 'create'
  titleRef: React.RefObject<HTMLInputElement | null>
  onToggleComplete: () => void
  onTitleChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onTitleBlur: () => void
  onTitleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  onToggleStar: () => void
  onClose: () => void
  acState: AutocompleteState
  onAcSelect: (item: { id: number; name: string }) => void
}

export function TaskEditHeader({
  isEdit, isCompleted, title, isStarred, mode, titleRef,
  onToggleComplete, onTitleChange, onTitleBlur, onTitleKeyDown,
  onToggleStar, onClose, acState, onAcSelect,
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
          placeholder={mode === 'create' ? 'New task... (@person #tag /project p1 tomorrow)' : 'Task title'}
        />
        <NlpAutocomplete state={acState} onSelect={onAcSelect} />
      </div>
      <button
        className={`${styles.starButton} ${isStarred ? styles.starActive : ''}`}
        onClick={onToggleStar}
        aria-label={isStarred ? 'Unstar task' : 'Star task'}
      >
        {isStarred ? '★' : '☆'}
      </button>
      <button className={styles.closeButton} onClick={onClose} aria-label="Close">
        ×
      </button>
    </div>
  )
}
