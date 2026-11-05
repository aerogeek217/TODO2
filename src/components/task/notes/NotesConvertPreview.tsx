import { useEffect, useId, useRef } from 'react'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import type { TaskDraft } from '../../../services/task-draft'
import { useSettingsStore } from '../../../stores/settings-store'
import { DialogFrame } from '../../shared/Dialog'
import { TaskRowGrid } from '../TaskRowGrid'
import { convertActionLabel, plural } from './convert-action-label'
import { DraftTaskRow, type PreviewLookups, type PreviewRow } from './DraftTaskRow'
import styles from './NotesConvert.module.css'

export type { PreviewLookups, PreviewRow } from './DraftTaskRow'

export interface NotesConvertPreviewProps {
  rows: readonly PreviewRow[]
  lookups: PreviewLookups
  /** The note's heading, when it has one. */
  noteName: string | null
  fromSelection: boolean
  /** Drafts removed from the preview. */
  leftOut: number
  busy: boolean
  /** Row to focus (after an edit closes, or a removal). */
  focusKey: number | null
  /** A draft is open in the editor on top: focus stays there. */
  editing: boolean
  onEdit: (key: number) => void
  onChange: (key: number, draft: TaskDraft) => void
  onCheck: (key: number, checked: boolean) => void
  onRemove: (key: number) => void
  onCreate: () => void
  onCancel: () => void
  /** Esc, the backdrop, ×. Default: `onCancel`. */
  onDismiss?: () => void
}

/**
 * The convert preview: a modal list of drafts, one per bullet line, already
 * parsed, on task rows edited in place (`DraftTaskRow`). Nothing is stored
 * and the note isn't touched until the button confirms. ↑/↓ move, ⏎ opens a
 * row's editor, Del removes it, Ctrl/⌘+⏎ confirms. Cancel drops everything;
 * Esc, the backdrop and × are `onDismiss`, which may ask first.
 */
export function NotesConvertPreview({
  rows, lookups, noteName, fromSelection, leftOut, busy, focusKey, editing,
  onEdit, onChange, onCheck, onRemove, onCreate, onCancel, onDismiss = onCancel,
}: NotesConvertPreviewProps) {
  const removeConverted = useSettingsStore((s) => s.removeConvertedLines)
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<number, HTMLLIElement>())

  // On open, after the editor closes and after a removal; an edit in a row leaves the focus where it is.
  const rowsRef = useLatestRef(rows)
  const rowCount = rows.length
  useEffect(() => {
    if (editing) return
    const target = focusKey != null ? rowEls.current.get(focusKey) : undefined
    ;(target ?? rowEls.current.get(rowsRef.current[0]?.key ?? -1) ?? dialogRef.current)?.focus()
  }, [focusKey, rowCount, editing, rowsRef])

  const newPeople = [...new Set(rows.flatMap((r) => r.draft.newPeople))]
  const sourceName = fromSelection
    ? (noteName ? `From your selection in "${noteName}"` : 'From your selection')
    : (noteName ? `From the note "${noteName}"` : 'From the note')
  const notes = [
    newPeople.length > 0 ? `New ${newPeople.length === 1 ? 'person' : 'people'}: ${newPeople.join(', ')} — created with the tasks` : null,
    leftOut > 0 ? `${plural(leftOut, 'line', 'lines')} left out` : null,
  ].filter((n): n is string => n !== null)
  const canCreate = rows.length > 0 && !busy

  const focusedKey = (): number | null => {
    const active = document.activeElement
    for (const [key, el] of rowEls.current) if (el === active || el.contains(active)) return key
    return null
  }

  // The list's keys; Esc, Tab and the backdrop are the frame's.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (canCreate) onCreate()
      return
    }
    const key = focusedKey()
    const index = key == null ? -1 : rows.findIndex((r) => r.key === key)
    // A picker portaled from a row: its keys are its own, though React bubbles them here.
    if (!(e.target instanceof Node) || !dialogRef.current?.contains(e.target)) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[e.key === 'ArrowDown' ? Math.min(rows.length - 1, index + 1) : Math.max(0, index - 1)]
      if (next) rowEls.current.get(next.key)?.focus()
      return
    }
    if (key == null) return
    if (e.key === 'Enter' && (e.target as HTMLElement).hasAttribute('data-draft-row')) {
      e.preventDefault()
      onEdit(key)
    } else if (e.key === 'Delete') {
      e.preventDefault()
      onRemove(key)
    }
  }

  return (
    <DialogFrame
      onClose={onDismiss}
      aria-labelledby={titleId}
      className={styles.dialog}
      panelRef={dialogRef}
      onKeyDown={handleKeyDown}
      // Opened from inside a notes surface (the task editor's notes): its keys stay here.
      stopKeys
      // The draft editor on top isn't an `aria-modal` dialog: while it is
      // open, an Esc with nothing focused is its, not the preview's.
      escapeBelongsElsewhere={() => editing}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.dialogTitle}>Convert to tasks</h2>
        <span className={styles.countBadge}>{plural(rows.length, 'draft', 'drafts')}</span>
        <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onDismiss}>×</button>
      </div>
      <p className={styles.subline}>{sourceName} · not saved yet · click a title to rename, double-click for every detail</p>
      <TaskRowGrid className={styles.list}>
        <ul className={styles.items} aria-label="Drafts">
          {rows.length === 0 && <li className={styles.empty}>No drafts left</li>}
          {rows.map((row) => (
            <DraftTaskRow
              key={row.key}
              row={row}
              lookups={lookups}
              onChange={(draft) => onChange(row.key, draft)}
              onCheck={(checked) => onCheck(row.key, checked)}
              onEdit={() => onEdit(row.key)}
              onRemove={() => onRemove(row.key)}
              rowRef={(el) => {
                if (el) rowEls.current.set(row.key, el)
                else rowEls.current.delete(row.key)
              }}
            />
          ))}
        </ul>
      </TaskRowGrid>
      <div className={styles.footer}>
        <span className={styles.footerNote}>{notes.join(' · ')}</span>
        <button type="button" className={styles.cancelBtn} onClick={onCancel}>
          Cancel <kbd className={styles.kbd}>Esc</kbd>
        </button>
        <button type="button" className={styles.createBtn} disabled={!canCreate} onClick={onCreate}>
          {convertActionLabel(rows, removeConverted)}
        </button>
      </div>
    </DialogFrame>
  )
}
