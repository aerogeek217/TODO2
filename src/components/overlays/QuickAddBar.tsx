/**
 * QuickAddBar — keyboard-first task capture surface.
 *
 * P1 (current): component shell only — opens, closes, focuses, Esc + click-
 * outside dismiss. The `parse` prop is stubbed; no real chips render. Real
 * parser wires in P2, autocomplete in P3, submit in P4.
 *
 * Inline syntax (parsed live, removed from title, surfaced as chips — P2+):
 *   @person   /project   #tag   :status (P6)   natural dates ("tomorrow")
 *
 * Title input + notes textarea carry `data-shortcut-scope="none"` so global
 * keyboard shortcuts (`use-keyboard-shortcuts.ts`) don't fire while typing.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedPerson, PersistedStatus, Project } from '../../models'
import { useClickOutside } from '../../hooks/use-click-outside'
import styles from './QuickAddBar.module.css'

// ─── Types ────────────────────────────────────────────────────────

/**
 * Parsed-token shape produced by `parse(rawTitle)`. P1 keeps the field set
 * minimal — the handoff's `Status` / `Person` / `Project` aliases are
 * dropped and the matching `models/` types reused with numeric ids.
 *
 * P2 extends with `orgs` + `recurrence`. P6 adds `status`.
 */
export type ParsedTokens = {
  /** Title with @/foo /bar #baz tokens stripped. */
  title: string
  status?: PersistedStatus
  people: PersistedPerson[]
  project?: Project
  tags: string[]
  scheduledAt?: Date
  deadlineAt?: Date
}

export type QuickAddDraft = ParsedTokens & {
  notes?: string
}

export interface QuickAddBarProps {
  open: boolean
  onClose: () => void
  onSubmit: (draft: QuickAddDraft) => void
  /** Open the full task editor with the current draft (P4 wires). */
  onOpenFullEditor?: (draft: QuickAddDraft) => void
  /** Project to default to (canvas focus, current view, etc) — P4 threads. */
  defaultProject?: Project
  /** Replace with the real parser in P2. Stub returns title only. */
  parse?: (input: string) => ParsedTokens
}

// ─── Atoms ─────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className={styles.kbd}>{children}</span>
}

function StatusChip({ status }: { status: PersistedStatus }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipDot} style={{ background: status.color }} />
      <span>{status.name}</span>
    </span>
  )
}

function PersonChip({ person }: { person: PersistedPerson }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipAvatar}>{person.initials}</span>
      <span>@{person.name}</span>
    </span>
  )
}

function ProjectChip({ project }: { project: Project }) {
  return (
    <span className={styles.chip}>
      <span
        className={styles.chipDot}
        style={{ background: project.color ?? 'var(--color-accent)' }}
      />
      <span>/{project.name}</span>
    </span>
  )
}

function TagChip({ tag }: { tag: string }) {
  return (
    <span className={styles.chip}>
      <span>#{tag}</span>
    </span>
  )
}

function DateChip({ icon, label }: { icon: string; label: string }) {
  return (
    <span className={styles.chip}>
      <span style={{ fontSize: 10 }}>{icon}</span>
      <span>{label}</span>
    </span>
  )
}

// ─── Component ────────────────────────────────────────────────────

const STUB_PARSE = (s: string): ParsedTokens => ({
  title: s,
  people: [],
  tags: [],
})

export function QuickAddBar({
  open,
  onClose,
  onSubmit,
  onOpenFullEditor,
  defaultProject,
  parse = STUB_PARSE,
}: QuickAddBarProps) {
  const [raw, setRaw] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const parsed = parse(raw)
  const draft: QuickAddDraft = {
    ...parsed,
    project: parsed.project ?? defaultProject,
    notes,
  }

  const hasChips =
    !!draft.status ||
    draft.people.length > 0 ||
    !!draft.project ||
    draft.tags.length > 0 ||
    !!draft.scheduledAt ||
    !!draft.deadlineAt

  // Focus on open; reset on close.
  useEffect(() => {
    if (open) {
      // Wait a paint so the portal node exists.
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setRaw('')
      setExpanded(false)
      setNotes('')
    }
  }, [open])

  useClickOutside(surfaceRef, onClose, open)

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      setExpanded((v) => !v)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (draft.title.trim().length === 0) return
      onSubmit(draft)
      onClose()
    }
  }

  if (!open) return null

  return createPortal(
    <div className={`${styles.overlay} ${styles.open}`} onClick={onClose}>
      <div
        ref={surfaceRef}
        className={`${styles.surface} ${styles.focused}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        role="dialog"
        aria-label="Quick add task"
      >
        {/* Title row */}
        <div className={styles.titleRow}>
          <span className={styles.plus}>+</span>
          <input
            ref={inputRef}
            className={styles.titleInput}
            placeholder="New task…"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            data-shortcut-scope="none"
          />
          <button
            className={styles.submitBtn}
            onClick={() => {
              if (draft.title.trim().length === 0) return
              onSubmit(draft)
              onClose()
            }}
            disabled={draft.title.trim().length === 0}
          >
            Create<span className={styles.kbd}>↵</span>
          </button>
        </div>

        {/* Chips row */}
        {hasChips && (
          <div className={`${styles.chipsRow} ${expanded ? styles.withDivider : ''}`}>
            {draft.status && <StatusChip status={draft.status} />}
            {draft.people.map((p) => (
              <PersonChip key={p.id} person={p} />
            ))}
            {draft.project && <ProjectChip project={draft.project} />}
            {draft.tags.map((t) => (
              <TagChip key={t} tag={t} />
            ))}
            {draft.scheduledAt && <DateChip icon="📅" label={formatShort(draft.scheduledAt)} />}
            {draft.deadlineAt && <DateChip icon="🚩" label={formatShort(draft.deadlineAt)} />}
            {!expanded && (
              <span className={styles.chipsHint}>
                <Kbd>⇥</Kbd> for more fields
              </span>
            )}
          </div>
        )}

        {/* Expanded fields */}
        {expanded && (
          <>
            <div className={styles.expanded}>
              <div className={styles.fieldGrid}>
                <div className={styles.fieldLabel}>Schedule</div>
                <div>
                  <button
                    className={`${styles.fieldButton} ${!draft.scheduledAt ? styles.empty : ''}`}
                  >
                    {draft.scheduledAt ? `📅 ${formatShort(draft.scheduledAt)}` : '＋ Set schedule'}
                  </button>
                </div>
                <div className={styles.fieldLabel}>Deadline</div>
                <div>
                  <button
                    className={`${styles.fieldButton} ${!draft.deadlineAt ? styles.empty : ''}`}
                  >
                    {draft.deadlineAt ? `🚩 ${formatShort(draft.deadlineAt)}` : '＋ Set deadline'}
                  </button>
                </div>
                <div className={styles.fieldLabel}>Tags</div>
                <div>
                  <button
                    className={`${styles.fieldButton} ${draft.tags.length === 0 ? styles.empty : ''}`}
                  >
                    {draft.tags.length > 0
                      ? draft.tags.map((t) => `#${t}`).join(' ')
                      : '＋ Add tag'}
                  </button>
                </div>
                <div className={`${styles.fieldLabel} ${styles.alignTop}`}>Notes</div>
                <textarea
                  className={styles.notesInput}
                  placeholder="Notes (optional)…"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  data-shortcut-scope="none"
                />
              </div>
            </div>
            <div className={styles.footer}>
              <span>
                <Kbd>⇥</Kbd> collapse
              </span>
              <span>
                <Kbd>↵</Kbd> create
              </span>
              <span className={styles.spacer} />
              {onOpenFullEditor && (
                <a
                  className={styles.openFull}
                  onClick={() => {
                    onOpenFullEditor(draft)
                    onClose()
                  }}
                >
                  Open full editor →
                </a>
              )}
            </div>
          </>
        )}

        {/* Hint when empty + collapsed */}
        {!hasChips && !expanded && (
          <div className={styles.hintRow}>
            <span>Inline shortcuts:</span>
            <span>
              <Kbd>@</Kbd> person
            </span>
            <span>
              <Kbd>/</Kbd> project
            </span>
            <span>
              <Kbd>#</Kbd> tag
            </span>
            <span style={{ opacity: 0.7 }}>
              or natural dates: <i>tomorrow, fri 3pm</i>
            </span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
