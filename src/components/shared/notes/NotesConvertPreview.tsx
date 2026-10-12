import { useEffect, useId, useRef } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { DEFAULT_STATUS_ICON, type Person, type Status, type Tag } from '../../../models'
import type { ConvertLine } from '../../../services/note-lines'
import type { TaskDraft } from '../../../services/task-draft'
import { useTooltip } from '../../../hooks/use-tooltip'
import { formatFollowupDate, formatFollowupDay } from '../../../utils/followup'
import { CalendarIcon } from '../CommandIcons'
import { FollowupFlagIcon } from '../FollowupIcons'
import { StatusIcon } from '../StatusIcon'
import { TaskMarkers } from '../TaskMarkers'
import styles from './NotesConvert.module.css'

export interface PreviewRow {
  key: number
  line: ConvertLine
  draft: TaskDraft
  edited: boolean
}

export interface PreviewLookups {
  people: readonly Person[]
  tags: readonly Tag[]
  statuses: readonly Status[]
  /** The next follow-up a task gets by default. */
  defaultFollowup: Date
  today: Date
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function PencilIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.5l3 3L6 13H3v-3l7.5-7.5z" />
    </svg>
  )
}

function DraftChips({ draft, lookups }: { draft: TaskDraft; lookups: PreviewLookups }) {
  const { people, tags, statuses, defaultFollowup, today } = lookups
  const tagNames = [
    ...draft.tagIds.flatMap((id) => tags.find((t) => t.id === id)?.name ?? []),
    ...draft.newTags,
  ]
  const named = draft.personIds.flatMap((id) => people.find((p) => p.id === id) ?? [])
  const status = draft.statusId !== undefined ? statuses.find((s) => s.id === draft.statusId) : undefined
  return (
    <span className={styles.chips}>
      {tagNames.map((name) => <span key={`t-${name}`} className={styles.chip}>#{name}</span>)}
      {named.map((p) => (
        <span key={`p-${p.id}`} className={styles.chip}>
          <span className={styles.avatar} style={{ background: p.color ?? NEUTRAL_PERSON_COLOR }}>{p.initials}</span>
          {p.name}
        </span>
      ))}
      {draft.newPeople.map((name) => (
        <span key={`n-${name}`} className={styles.chip}>
          <span className={`${styles.avatar} ${styles.avatarNew}`} aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
          {name}
        </span>
      ))}
      {draft.dueDate && (
        <span className={styles.chip} data-tint="due"><CalendarIcon /> {formatFollowupDay(draft.dueDate, today)}</span>
      )}
      {draft.nextFollowupAt === undefined ? (
        <span className={`${styles.chip} ${styles.chipDefault}`} title="The default next follow-up">
          <FollowupFlagIcon /> {formatFollowupDate(defaultFollowup, today)}
        </span>
      ) : draft.nextFollowupAt ? (
        <span className={styles.chip} data-tint="followup"><FollowupFlagIcon /> {formatFollowupDate(draft.nextFollowupAt, today)}</span>
      ) : null}
      {status && (
        <span className={styles.chip}>
          <span style={{ color: status.color }}><StatusIcon icon={status.icon || DEFAULT_STATUS_ICON} filled /></span>
          {status.name}
        </span>
      )}
    </span>
  )
}

function DraftRowItem({ row, lookups, onEdit, onRemove, rowRef }: {
  row: PreviewRow
  lookups: PreviewLookups
  onEdit: () => void
  onRemove: () => void
  rowRef: (el: HTMLLIElement | null) => void
}) {
  const { triggerProps, tooltip } = useTooltip(`From line ${row.line.line}\n${row.line.text.trim()}`)
  const markerTodo = {
    urgent: row.draft.urgent,
    important: row.draft.important,
    focus: row.draft.focus,
    dueDate: row.draft.dueDate,
    isCompleted: false,
  }
  return (
    <li
      ref={rowRef}
      className={styles.row}
      tabIndex={0}
      data-draft-row
      aria-label={row.draft.title}
      onClick={onEdit}
      // Hover only: the dialog focuses a row as it opens, which mustn't pop a tooltip.
      onPointerEnter={triggerProps.onPointerEnter}
      onPointerLeave={triggerProps.onPointerLeave}
      onPointerDown={triggerProps.onPointerDown}
      aria-describedby={triggerProps['aria-describedby']}
    >
      <span className={styles.ring} aria-hidden="true" />
      <TaskMarkers todo={markerTodo} today={lookups.today} size={13} className={styles.markers} />
      <span className={styles.title}>{row.draft.title}</span>
      <DraftChips draft={row.draft} lookups={lookups} />
      {row.edited && <span className={styles.edited}>edited</span>}
      <span className={styles.rowActions}>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={`Edit "${row.draft.title}"`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onEdit() }}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className={styles.iconBtn}
          aria-label={`Remove "${row.draft.title}"`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
        >
          ×
        </button>
      </span>
      {tooltip}
    </li>
  )
}

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
  onRemove: (key: number) => void
  onCreate: () => void
  onCancel: () => void
}

/**
 * The convert preview: a modal list of drafts, one per bullet line, already
 * parsed. Nothing is stored until Create N tasks. ↑/↓ move, ⏎ edits a row,
 * Del removes it, Ctrl/⌘+⏎ creates, Esc cancels.
 */
export function NotesConvertPreview({
  rows, lookups, noteName, fromSelection, leftOut, busy, focusKey, editing,
  onEdit, onRemove, onCreate, onCancel,
}: NotesConvertPreviewProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const rowEls = useRef(new Map<number, HTMLLIElement>())

  useEffect(() => {
    if (editing) return
    const target = focusKey != null ? rowEls.current.get(focusKey) : undefined
    ;(target ?? rowEls.current.get(rows[0]?.key ?? -1) ?? dialogRef.current)?.focus()
  }, [focusKey, rows, editing])

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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // A modal: no key reaches the app's shortcuts or the surface below.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
      return
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (canCreate) onCreate()
      return
    }
    const key = focusedKey()
    const index = key == null ? -1 : rows.findIndex((r) => r.key === key)
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

  // Keep Tab inside the dialog.
  const trapTab = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab') return
    const items = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('[tabindex="0"], button:not([disabled]):not([tabindex="-1"])') ?? [])
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onCancel} />
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={(e) => { trapTab(e); handleKeyDown(e) }}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.dialogTitle}>Convert to tasks</h2>
          <span className={styles.countBadge}>{plural(rows.length, 'draft', 'drafts')}</span>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={onCancel}>×</button>
        </div>
        <p className={styles.subline}>{sourceName} · not saved yet · click a draft to edit it</p>
        <ul className={styles.list} aria-label="Drafts">
          {rows.length === 0 && <li className={styles.empty}>No drafts left</li>}
          {rows.map((row) => (
            <DraftRowItem
              key={row.key}
              row={row}
              lookups={lookups}
              onEdit={() => onEdit(row.key)}
              onRemove={() => onRemove(row.key)}
              rowRef={(el) => {
                if (el) rowEls.current.set(row.key, el)
                else rowEls.current.delete(row.key)
              }}
            />
          ))}
        </ul>
        <div className={styles.footer}>
          <span className={styles.footerNote}>{notes.join(' · ')}</span>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Cancel <kbd className={styles.kbd}>Esc</kbd>
          </button>
          <button type="button" className={styles.createBtn} disabled={!canCreate} onClick={onCreate}>
            Create {plural(rows.length, 'task', 'tasks')}
          </button>
        </div>
      </div>
    </>
  )
}
