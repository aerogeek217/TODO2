/**
 * QuickAddBar — keyboard-first task capture surface.
 *
 * P2: real parser + chip wiring. Live subscriptions to person / org / project /
 * settings stores feed `parseInput` → `resolveInput` on every keystroke; chips
 * render for every metadata field the resolver produces (person, org, project,
 * tag, schedule, deadline, recurrence). Tag chips show the parsed slug — the
 * tag-store resolve-or-create runs at submit (P4).
 *
 * Auto-derived chips are read-only feedback (no removable ×). To clear, edit
 * the title — same UX as `InsertTrigger`'s autocomplete preview. Autocomplete
 * popup wires in P3, submit + full-editor handoff in P4, status NLP in P6.
 *
 * Inline syntax (parsed live, removed from title, surfaced as chips):
 *   @person   /project   #tag   :status (P6)   natural dates ("tomorrow")
 *
 * Title input + notes textarea carry `data-shortcut-scope="none"` so global
 * keyboard shortcuts (`use-keyboard-shortcuts.ts`) don't fire while typing.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  Org,
  PersistedOrg,
  PersistedPerson,
  PersistedStatus,
  Person,
  Project,
  RecurrenceType,
} from '../../models'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useOrgStore } from '../../stores/org-store'
import { usePersonStore } from '../../stores/person-store'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { parseInput } from '../../services/natural-language-parser'
import { resolveInput } from '../../services/nlp-resolver'
import { resolveScheduled, type WeekStart } from '../../utils/effective-date'
import styles from './QuickAddBar.module.css'

// ─── Types ────────────────────────────────────────────────────────

/**
 * Parsed-token shape consumed by the bar's chip renderers. Numeric ids match
 * the codebase. P6 will populate `status` via the `:status` prefix. Tags stay
 * as slug strings — the tag-store resolve-or-create runs at submit (P4) so the
 * registry is the single source of truth for color/id.
 */
export type ParsedTokens = {
  /** Title with @/foo /bar #baz tokens stripped. */
  title: string
  status?: PersistedStatus
  people: PersistedPerson[]
  /** Orgs matched via the @-fallthrough path (`@name` that didn't match a person). */
  orgs: PersistedOrg[]
  project?: Project
  /** Lowercase tag slugs in first-seen order. */
  tags: string[]
  scheduledAt?: Date
  deadlineAt?: Date
  recurrence?: RecurrenceType
  /** Person names from `@` tokens that matched neither a person nor an org. */
  unmatchedPersons: string[]
  /** Project names from `/` tokens that didn't match any known project. */
  unmatchedProjects: string[]
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
  /**
   * Optional override for tests. The default pipeline subscribes to the live
   * person / org / project / settings stores and runs `parseInput` →
   * `resolveInput` over the raw input.
   */
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

function OrgChip({ org }: { org: PersistedOrg }) {
  return (
    <span className={styles.chip}>
      <span
        className={styles.chipDot}
        style={{ background: org.color ?? 'var(--color-accent)' }}
      />
      <span>@{org.name}</span>
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

const RECURRENCE_LABEL: Record<RecurrenceType, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Biweekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

function RecurrenceChip({ recurrence }: { recurrence: RecurrenceType }) {
  return (
    <span className={styles.chip}>
      <span style={{ fontSize: 10 }}>↻</span>
      <span>{RECURRENCE_LABEL[recurrence]}</span>
    </span>
  )
}

// ─── Pipeline ─────────────────────────────────────────────────────

const EMPTY_PARSED: ParsedTokens = {
  title: '',
  people: [],
  orgs: [],
  tags: [],
  unmatchedPersons: [],
  unmatchedProjects: [],
}

/**
 * Live pipeline: `parseInput` → `resolveInput` → entity lookup against the
 * person / org / project stores. Pure helper — receives stores as args so the
 * component-level `useMemo` can deps-cache it cleanly.
 */
function runParse(
  raw: string,
  people: Person[],
  orgs: Org[],
  projects: Project[],
  weekStartsOn: WeekStart,
  today: Date,
): ParsedTokens {
  if (raw.trim().length === 0) return EMPTY_PARSED
  const parsedInput = parseInput(raw)
  const resolved = resolveInput(parsedInput, people, projects, orgs)

  const peopleResolved: PersistedPerson[] = resolved.personIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is PersistedPerson => p?.id !== undefined)
  const orgsResolved: PersistedOrg[] = resolved.orgIds
    .map((id) => orgs.find((o) => o.id === id))
    .filter((o): o is PersistedOrg => o?.id !== undefined)
  const projectResolved =
    resolved.projectId !== undefined
      ? projects.find((p) => p.id === resolved.projectId)
      : undefined
  const scheduledAt = resolved.scheduledDate
    ? resolveScheduled(resolved.scheduledDate, today, weekStartsOn) ?? undefined
    : undefined

  return {
    title: resolved.title,
    people: peopleResolved,
    orgs: orgsResolved,
    project: projectResolved,
    tags: resolved.tags,
    scheduledAt,
    deadlineAt: resolved.dueDate,
    recurrence: resolved.recurrence,
    unmatchedPersons: resolved.unmatchedPersons,
    unmatchedProjects: resolved.unmatchedProjects,
  }
}

// ─── Component ────────────────────────────────────────────────────

export function QuickAddBar({
  open,
  onClose,
  onSubmit,
  onOpenFullEditor,
  defaultProject,
  parse,
}: QuickAddBarProps) {
  const [raw, setRaw] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)

  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)

  const internalParsed = useMemo<ParsedTokens>(
    () => runParse(raw, people, orgs, projects, weekStartsOn, new Date()),
    [raw, people, orgs, projects, weekStartsOn],
  )
  const parsed = parse ? parse(raw) : internalParsed

  const draft: QuickAddDraft = {
    ...parsed,
    project: parsed.project ?? defaultProject,
    notes,
  }

  const hasChips =
    !!draft.status ||
    draft.people.length > 0 ||
    draft.orgs.length > 0 ||
    !!draft.project ||
    draft.tags.length > 0 ||
    !!draft.scheduledAt ||
    !!draft.deadlineAt ||
    !!draft.recurrence

  const hasUnmatched =
    parsed.unmatchedPersons.length > 0 || parsed.unmatchedProjects.length > 0

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
              <PersonChip key={`person-${p.id}`} person={p} />
            ))}
            {draft.orgs.map((o) => (
              <OrgChip key={`org-${o.id}`} org={o} />
            ))}
            {draft.project && <ProjectChip project={draft.project} />}
            {draft.tags.map((t) => (
              <TagChip key={`tag-${t}`} tag={t} />
            ))}
            {draft.scheduledAt && <DateChip icon="📅" label={formatShort(draft.scheduledAt)} />}
            {draft.deadlineAt && <DateChip icon="🚩" label={formatShort(draft.deadlineAt)} />}
            {draft.recurrence && <RecurrenceChip recurrence={draft.recurrence} />}
            {!expanded && (
              <span className={styles.chipsHint}>
                <Kbd>⇥</Kbd> for more fields
              </span>
            )}
          </div>
        )}

        {/* Unmatched tokens hint */}
        {hasUnmatched && (
          <div className={styles.unmatchedHint}>
            <span>Unknown:</span>
            <span className={styles.unmatchedNames}>
              {[
                ...parsed.unmatchedPersons.map((n) => `@${n}`),
                ...parsed.unmatchedProjects.map((n) => `/${n}`),
              ].join(' ')}
            </span>
            {parsed.unmatchedPersons.length > 0 && (
              <span>— will be created on submit</span>
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
        {!hasChips && !hasUnmatched && !expanded && (
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
