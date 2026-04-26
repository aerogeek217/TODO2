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

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
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
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { useOrgStore } from '../../stores/org-store'
import { usePersonStore } from '../../stores/person-store'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useTagStore } from '../../stores/tag-store'
import { parseInput } from '../../services/natural-language-parser'
import { resolveInput } from '../../services/nlp-resolver'
import { resolveScheduled, type WeekStart } from '../../utils/effective-date'
import { resolvePersonColor } from '../../utils/person-color'
import styles from './QuickAddBar.module.css'

const POPUP_GAP_PX = 4
const POPUP_VIEWPORT_MARGIN_PX = 8
const POPUP_WIDTH_PX = 280

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
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const projects = useProjectStore((s) => s.projects)
  const tags = useTagStore((s) => s.tags)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)

  const internalParsed = useMemo<ParsedTokens>(
    () => runParse(raw, people, orgs, projects, weekStartsOn, new Date()),
    [raw, people, orgs, projects, weekStartsOn],
  )
  const parsed = parse ? parse(raw) : internalParsed

  // Autocomplete candidates — mirror InsertTrigger so the popup ranks people
  // (with org-derived color), orgs, projects, and tags identically across the
  // two surfaces. Tags sort alphabetically; the others keep store order.
  const acPeople = useMemo<AutocompleteItem[]>(
    () =>
      people.map((p) => ({
        id: p.id!,
        name: p.name,
        color: resolvePersonColor(p.id, personOrgMap, orgs),
        kind: 'person' as const,
      })),
    [people, personOrgMap, orgs],
  )
  const acOrgs = useMemo<AutocompleteItem[]>(
    () =>
      orgs.map((o) => ({ id: o.id!, name: o.name, color: o.color, kind: 'org' as const })),
    [orgs],
  )
  const acProjects = useMemo<AutocompleteItem[]>(
    () =>
      projects.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'project' as const })),
    [projects],
  )
  const acTags = useMemo<AutocompleteItem[]>(
    () =>
      [...tags]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((t) => ({ id: t.id!, name: t.name, color: t.color, kind: 'tag' as const })),
    [tags],
  )
  const ac = useNlpAutocomplete({
    people: acPeople,
    orgs: acOrgs,
    projects: acProjects,
    tags: acTags,
  })

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

  // Focus on open; reset (and dismiss any open popup) on close. Destructure
  // `dismiss` so the effect's deps are stable — the hook returns a fresh
  // `ac` object literal every render, but `ac.dismiss` is the same useCallback.
  const { dismiss: dismissAutocomplete } = ac
  useEffect(() => {
    if (open) {
      // Wait a paint so the portal node exists.
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setRaw('')
      setExpanded(false)
      setNotes('')
      dismissAutocomplete()
    }
  }, [open, dismissAutocomplete])

  // Popup placement state — anchored to the input rect + caret offset,
  // portal'd to body. Mirrors RuntimeFilterPicker's flip-above-when-clipping +
  // clamp-on-right-edge math; tracks scroll (capture) + resize while visible.
  const [popupPos, setPopupPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: POPUP_WIDTH_PX,
  })
  const popupRef = useRef<HTMLDivElement>(null)

  // Click-outside that also excludes the portal'd autocomplete popup. The
  // standard `useClickOutside` only checks one ref; mousedown listeners run in
  // capture phase, so a popup-side stopPropagation can't help — we have to
  // include `popupRef` in the contain check directly.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (surfaceRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      onClose()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open, onClose])

  const computePopupPosition = useCallback(() => {
    const input = inputRef.current
    if (!input) return
    const inputRect = input.getBoundingClientRect()
    const popupRect = popupRef.current?.getBoundingClientRect()
    const popupHeight = popupRect?.height ?? 0
    const width = POPUP_WIDTH_PX

    let top = inputRect.bottom + POPUP_GAP_PX
    if (popupHeight > 0 && top + popupHeight > window.innerHeight - POPUP_VIEWPORT_MARGIN_PX) {
      const flipped = inputRect.top - popupHeight - POPUP_GAP_PX
      if (flipped >= POPUP_VIEWPORT_MARGIN_PX) top = flipped
    }

    let left = inputRect.left + ac.state.caretLeft
    if (left + width > window.innerWidth - POPUP_VIEWPORT_MARGIN_PX) {
      left = Math.max(POPUP_VIEWPORT_MARGIN_PX, window.innerWidth - POPUP_VIEWPORT_MARGIN_PX - width)
    }
    if (left < POPUP_VIEWPORT_MARGIN_PX) left = POPUP_VIEWPORT_MARGIN_PX

    setPopupPos({ top, left, width })
  }, [ac.state.caretLeft])

  useLayoutEffect(() => {
    if (!ac.state.visible) return
    computePopupPosition()
  }, [ac.state.visible, ac.state.items.length, computePopupPosition])

  useEffect(() => {
    if (!ac.state.visible) return
    const handler = () => computePopupPosition()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [ac.state.visible, computePopupPosition])

  const handleSelectItem = (item?: AutocompleteItem) => {
    const input = inputRef.current
    if (!input) return
    const result = ac.applySelection(input.value, input.selectionStart ?? input.value.length, item)
    if (result) {
      setRaw(result.value)
      // Restore caret after React commits the new value.
      requestAnimationFrame(() => {
        if (!inputRef.current) return
        inputRef.current.setSelectionRange(result.cursor, result.cursor)
        inputRef.current.focus()
      })
    }
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Autocomplete-aware path — when the popup is visible the bar's outer
    // Esc/Tab/Enter handlers must not fire, so we stopPropagation on every
    // consumed key.
    if (ac.state.visible) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        ac.handleKeyDown(e)
        return
      }
      const isTagCreateNew =
        ac.state.trigger === '#' && ac.state.items.length === 0 && ac.state.query.length > 0
      if (e.key === 'Tab' || (e.key === 'Enter' && (ac.state.items.length > 0 || isTagCreateNew))) {
        e.preventDefault()
        e.stopPropagation()
        handleSelectItem()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        ac.dismiss()
        return
      }
    }
  }

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

  const popupHeader =
    ac.state.trigger === '#'
      ? 'Tags'
      : ac.state.trigger === '/'
        ? 'Projects'
        : ac.state.items.some((it) => it.kind === 'org')
          ? 'People & Orgs'
          : 'People'
  const isTagCreateNewVisible =
    ac.state.trigger === '#' && ac.state.items.length === 0 && ac.state.query.length > 0

  return (
    <>
      {createPortal(
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
            onChange={(e) => {
              setRaw(e.target.value)
              ac.handleInputChange(
                e.target.value,
                e.target.selectionStart ?? e.target.value.length,
                e.target,
              )
            }}
            onKeyDown={onInputKeyDown}
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
      )}
      {ac.state.visible &&
        createPortal(
          <div
            ref={popupRef}
            className={styles.popup}
            style={{ top: popupPos.top, left: popupPos.left, width: popupPos.width }}
            role="listbox"
            aria-label={popupHeader}
          >
            <div className={styles.popupHeader}>{popupHeader}</div>
            {ac.state.items.map((item, i) => (
              <button
                key={`${item.kind}-${item.id}`}
                type="button"
                className={`${styles.popupItem} ${i === ac.state.selectedIndex ? styles.selected : ''}`}
                role="option"
                aria-selected={i === ac.state.selectedIndex}
                onMouseDown={(e) => {
                  // Prevent the input from blurring (which would dismiss the popup
                  // before the click commits the selection).
                  e.preventDefault()
                  handleSelectItem(item)
                }}
              >
                {item.color && (
                  <span className={styles.chipDot} style={{ background: item.color }} />
                )}
                <span className={styles.popupBody}>
                  <span className={styles.popupName}>
                    {ac.state.trigger}
                    {item.name}
                  </span>
                  {item.kind === 'org' && <span className={styles.popupMeta}> (org)</span>}
                </span>
              </button>
            ))}
            {isTagCreateNewVisible && (
              <button
                type="button"
                className={`${styles.popupItem} ${styles.popupCreateNew}`}
                role="option"
                aria-selected={false}
                onMouseDown={(e) => {
                  e.preventDefault()
                  handleSelectItem()
                }}
              >
                <span className={styles.popupName}>
                  Press Enter to create #{ac.state.query}
                </span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────

function formatShort(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}
