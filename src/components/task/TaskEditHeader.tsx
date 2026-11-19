import { useRef, useState, type ReactNode } from 'react'
import type { AutocompleteRow, AutocompleteState } from '../../hooks/use-nlp-autocomplete'
import { NlpPopup } from '../shared/NlpPopup'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { DialogCloseButton } from '../shared/DialogCloseButton'
import { MoreIcon } from '../shared/icons'
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
  /** The pointer moved over a popup row: it becomes the highlighted one. */
  onAcHighlight?: (index: number) => void
  /** Draft mode: a dashed ring instead of the checkbox and a Draft badge. */
  isDraft?: boolean
  /** The ⋯ menu's entries (edit mode: Duplicate, Make subtask of…, Delete); none: no ⋯. */
  menuEntries?: readonly MenuEntry[]
  /** Muted, before the ⋯ / × (edit mode: `Created 11/01 · Modified today`); it gives way first when the header is narrow. */
  meta?: ReactNode
}

export function TaskEditHeader({
  isEdit, isCompleted, title, mode, titleRef,
  onToggleComplete, onTitleChange, onTitleBlur, onTitleKeyDown,
  onClose, acState, onAcPick, onAcHighlight, isDraft = false, menuEntries, meta,
}: TaskEditHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const moreRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={styles.header}>
      {isDraft && <span className={styles.draftRing} aria-hidden="true" />}
      {isEdit && (
        <input
          type="checkbox"
          className={styles.checkboxLarge}
          checked={isCompleted}
          onChange={onToggleComplete}
          aria-label={isCompleted ? 'Mark incomplete' : 'Mark complete'}
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
          placeholder={mode === 'create' ? 'New task… (@person #tag !status /command)' : 'Task title'}
        />
        {acState.visible && acState.view && (
          <NlpPopup
            view={acState.view}
            selectedIndex={acState.selectedIndex}
            onPick={onAcPick}
            onHighlight={onAcHighlight}
            className={styles.titlePopup}
            style={{ left: acState.caretLeft }}
          />
        )}
      </div>
      {isDraft && <span className={styles.draftBadge}>Draft</span>}
      {meta != null && <span className={styles.headerMeta} data-task-meta="">{meta}</span>}
      {menuEntries && menuEntries.length > 0 && (
        <>
          <button
            ref={moreRef}
            type="button"
            className={styles.headerButton}
            aria-label="More actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <MoreIcon size={16} />
          </button>
          {menuOpen && (
            <MenuPopover
              anchorRef={moreRef}
              placement="bottom-end"
              label="Task actions"
              entries={menuEntries}
              width={200}
              onClose={() => setMenuOpen(false)}
            />
          )}
        </>
      )}
      {/* The ⋯'s class, so the two match. */}
      <DialogCloseButton size={30} className={styles.headerButton} onClick={onClose} />
    </div>
  )
}
