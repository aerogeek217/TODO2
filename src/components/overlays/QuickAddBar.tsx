/**
 * QuickAddBar — keyboard-first task capture surface.
 *
 * Live subscriptions to person / status / tag stores feed
 * `parseInput` → `resolveInput` on every keystroke. Recognised tokens are
 * tinted in the field (a mirror behind the transparent input text,
 * `services/nlp-token-tints`), the chips row shows what the task will get,
 * and problem lines name commands that set nothing. Tag chips show the
 * parsed name — the tag-store resolve-or-create runs at submit.
 *
 * Each chip has a × (a mouse target, not a Tab stop) that edits the text:
 * it cuts the tokens the chip came from (`services/nlp-chip-edit`), or — on
 * the default follow-up — adds `/followup none`. A preset marker (an
 * Eisenhower quadrant's "+") is dropped from the preset instead. The focus
 * and the caret stay in the field.
 *
 * ⏎ always adds the task, even while the `@ # /` popup is open: a
 * half-typed token is completed to its best match first; an unreadable one
 * stays in the title as typed. Tab (or a click) picks a suggestion, and so
 * does ⏎ after ↑/↓. Text that is only tokens adds nothing and says so.
 *
 * Inline syntax (parsed live, removed from the title):
 *   @person   #tag   /focus /urgent /important /due /followup /repeat /status
 * Plain words are never read as dates.
 *
 * The bar sits on the command palette's backdrop (dimmed, blurred): a click
 * on it closes the bar and never reaches the app underneath. The `@ # /`
 * popup, its person / tag menu and the editors that menu opens stack above.
 *
 * Title input carries `data-shortcut-scope="none"` so global keyboard
 * shortcuts (`use-keyboard-shortcuts.ts`) don't fire while typing.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type {
  PersistedPerson,
  PersistedStatus,
  Person,
  RecurrenceType,
  Status,
} from '../../models'
import { DEFAULT_STATUS_ICON, MARKER_KEYS, type MarkerKey } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useNlpAutocomplete } from '../../hooks/use-nlp-autocomplete'
import {
  appendTextToken,
  FOLLOWUP_NONE_TOKEN,
  removeChip,
  type QuickAddChip,
  type TextEdit,
} from '../../services/nlp-chip-edit'
import { personItems, statusItems, tagItems } from '../../services/nlp-autocomplete'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { usePopoverAnchor, type PopoverAnchor } from '../../hooks/use-popover-anchor'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { parseInput, type CommandProblem } from '../../services/natural-language-parser'
import { resolveInput, type ResolvedInput } from '../../services/nlp-resolver'
import { DATE_ARGUMENT_HINT, REPEAT_FREQUENCIES } from '../../services/slash-commands'
import { tokenTints, type TintSpan } from '../../services/nlp-token-tints'
import { addFollowupInterval, formatFollowupDate, formatFollowupDay } from '../../utils/followup'
import { startOfToday } from '../../utils/date'
import { MARKER_LABELS } from '../../utils/markers'
import { CalendarIcon, RepeatGlyph } from '../shared/CommandIcons'
import { FollowupFlagIcon } from '../shared/FollowupIcons'
import { MarkerIcon } from '../shared/MarkerIcons'
import { NlpPopup } from '../shared/NlpPopup'
import { DialogLayerContext, MODAL_BACKDROP_ATTR } from '../shared/dialog-layer'
import { useBackdropPress } from '../shared/use-backdrop-press'
import { isInLayerAbove } from '../../utils/dom-layers'
import { StatusIcon } from '../shared/StatusIcon'
import styles from './QuickAddBar.module.css'

const POPUP_GAP_PX = 4
const POPUP_WIDTH_PX = 280

/** Each marker chip's tint (`data-tint`). */
const MARKER_CHIP_TINT: Record<MarkerKey, string> = { focus: 'accent', urgent: 'urgent', important: 'followup' }

// ─── Types ────────────────────────────────────────────────────────

/**
 * Parsed-token shape consumed by the bar's chip renderers. Tags stay as name
 * strings — the tag-store resolve-or-create runs at submit so the registry is
 * the single source of truth for color/id.
 */
export type ParsedTokens = {
  /** Title with every recognised token stripped. */
  title: string
  status?: PersistedStatus
  people: PersistedPerson[]
  /** Tag names in first-seen order. */
  tags: string[]
  deadlineAt?: Date
  recurrence?: RecurrenceType
  /** Person names from `@` tokens that didn't match any known person. */
  unmatchedPersons: string[]
  /** The `/status` name when it matched no status. */
  unmatchedStatuses: string[]
  urgent?: boolean
  important?: boolean
  focus?: boolean
  /** From `/followup <date|interval>`. */
  nextFollowupAt?: Date
  /** `/followup none`. */
  followupNone?: boolean
  /** Commands that set nothing (problem lines). */
  problems?: CommandProblem[]
}

export type QuickAddDraft = ParsedTokens & {
  /** Unparsed input as the user typed it — used by the Details / Tab handoff
   * so `TaskEditPopup` can re-run its own NLP on mount. */
  rawTitle: string
  /** Preset markers whose chip was removed: the task doesn't get them from
   * the defaults of where it is added. */
  removedPresetMarkers?: MarkerKey[]
  /** Resolver output (people / tags / status / dates / markers /
   * recurrence) — what `services/create-task.createQuickAddTask` creates the
   * task from on submit. */
  resolved: ResolvedInput
}

export interface QuickAddPreset {
  urgent?: boolean
  important?: boolean
  focus?: boolean
  source?: string
}

export interface QuickAddBarProps {
  open: boolean
  onClose: () => void
  /**
   * Creates the task. The bar closes at once, or — for a promise — once it
   * resolves `true`; `false` (the task couldn't be stored) keeps the bar open
   * with the text as typed, to try again.
   */
  onSubmit: (draft: QuickAddDraft) => void | Promise<boolean>
  /** Open the full task editor with the current draft. Parent decides what
   * "open" means (typically: stash draft on `ui-store.quickAddDraft` and
   * dispatch `openCreatePopup`). The bar does NOT call `onClose` after this
   * — the parent owns the close-vs-handoff sequencing. */
  onOpenFullEditor?: (draft: QuickAddDraft) => void
  /** Pre-fill `rawTitle` on open. Read on the closed→open transition;
   * subsequent draft changes don't re-seed. */
  initialDraft?: { rawTitle: string }
  /**
   * What the task gets whatever is typed (e.g. an Eisenhower quadrant's
   * "+": its Urgent / Important flags), shown as chips — a marker chip's ×
   * drops it (`QuickAddDraft.removedPresetMarkers`) —, plus `source` —
   * where the task is being added (`Adding to Schedule`, no ×).
   */
  preset?: QuickAddPreset
  /**
   * Optional override for tests. The default pipeline subscribes to the live
   * person / status stores and runs `parseInput` →
   * `resolveInput` over the raw input.
   */
  parse?: (input: string) => ParsedTokens
}

// ─── Chips ─────────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className={styles.kbd}>{children}</span>
}

const RECURRENCE_LABEL: Record<RecurrenceType, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  biweekly: 'Every 2 weeks',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

/** `Every Mon` for weekly from a Monday due date; the frequency otherwise. */
function repeatLabel(recurrence: RecurrenceType, due: Date): string {
  if (recurrence === 'weekly') return `Every ${due.toLocaleDateString('en-US', { weekday: 'short' })}`
  return RECURRENCE_LABEL[recurrence]
}

/** What a chip's × does: remove what the chip came from, or (the default follow-up) say "none". */
type ChipRemoval = QuickAddChip | { kind: 'defaultFollowup' }

/**
 * A chip's ×: a mouse target only (Tab is the Details hand-off); the press
 * keeps the focus and the caret in the field.
 */
function ChipRemove({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      className={styles.chipRemove}
      tabIndex={-1}
      aria-label={label}
      title={label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
    >
      &times;
    </button>
  )
}

function PersonChip({ person, onRemove }: { person: PersistedPerson; onRemove: () => void }) {
  return (
    <span className={styles.chip}>
      <span className={styles.chipAvatar} style={{ background: person.color ?? NEUTRAL_PERSON_COLOR }}>
        {person.initials}
      </span>
      <span>@{person.name}</span>
      <ChipRemove label={`Remove @${person.name}`} onRemove={onRemove} />
    </span>
  )
}

function NewPersonChip({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className={styles.chip}>
      <span className={`${styles.chipAvatar} ${styles.chipAvatarNew}`} aria-hidden="true">
        {name.charAt(0).toUpperCase()}
      </span>
      <span>@{name}</span>
      <ChipRemove label={`Remove @${name}`} onRemove={onRemove} />
    </span>
  )
}

/** Names typed more than once (any case) show one chip — the task gets one person. */
function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  return names.filter((n) => {
    const key = n.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function ParsedChips({ draft, preset, defaultFollowup, today, onRemove }: {
  draft: QuickAddDraft
  preset?: QuickAddPreset
  defaultFollowup: Date
  today: Date
  onRemove: (chip: ChipRemoval) => void
}) {
  return (
    <div className={styles.chipsRow} role="group" aria-label="What the task gets">
      {MARKER_KEYS.filter((key) => draft[key] || preset?.[key]).map((key) => (
        <span key={`marker-${key}`} className={`${styles.chip} ${styles.markerChip}`} data-tint={MARKER_CHIP_TINT[key]}>
          <MarkerIcon marker={key} /> {MARKER_LABELS[key]}
          <ChipRemove label={`Remove ${MARKER_LABELS[key]}`} onRemove={() => onRemove({ kind: 'marker', marker: key })} />
        </span>
      ))}
      {draft.tags.map((t) => (
        <span key={`tag-${t}`} className={styles.chip}>
          #{t}
          <ChipRemove label={`Remove #${t}`} onRemove={() => onRemove({ kind: 'tag', name: t })} />
        </span>
      ))}
      {draft.people.map((p) => (
        <PersonChip key={`person-${p.id}`} person={p} onRemove={() => onRemove({ kind: 'person', personId: p.id })} />
      ))}
      {uniqueNames(draft.unmatchedPersons).map((n) => (
        <NewPersonChip key={`new-${n}`} name={n} onRemove={() => onRemove({ kind: 'newPerson', name: n })} />
      ))}
      {draft.deadlineAt && (
        <span className={styles.chip} data-tint="due">
          <CalendarIcon /> {formatFollowupDay(draft.deadlineAt, today)}
          <ChipRemove label="Remove due date" onRemove={() => onRemove({ kind: 'command', command: 'due' })} />
        </span>
      )}
      {draft.followupNone ? (
        <span className={`${styles.chip} ${styles.chipRing}`}>
          <FollowupFlagIcon /> No follow-up
          <ChipRemove label="Use the default follow-up" onRemove={() => onRemove({ kind: 'command', command: 'followup' })} />
        </span>
      ) : draft.nextFollowupAt ? (
        <span className={styles.chip} data-tint="followup">
          <FollowupFlagIcon /> {formatFollowupDate(draft.nextFollowupAt, today)}
          <ChipRemove label="Use the default follow-up" onRemove={() => onRemove({ kind: 'command', command: 'followup' })} />
        </span>
      ) : (
        <span className={`${styles.chip} ${styles.chipDefault}`}>
          <FollowupFlagIcon /> {formatFollowupDate(defaultFollowup, today)}
          <span className={styles.chipDefaultNote}> · default</span>
          <ChipRemove label="No follow-up" onRemove={() => onRemove({ kind: 'defaultFollowup' })} />
        </span>
      )}
      {draft.recurrence && draft.deadlineAt && (
        <span className={styles.chip} data-tint="accent">
          <RepeatGlyph /> {repeatLabel(draft.recurrence, draft.deadlineAt)}
          <ChipRemove label="Remove repeat" onRemove={() => onRemove({ kind: 'command', command: 'repeat' })} />
        </span>
      )}
      {draft.status && (
        <span className={`${styles.chip} ${styles.statusChip}`}>
          <span style={{ color: draft.status.color }}><StatusIcon icon={draft.status.icon || DEFAULT_STATUS_ICON} filled /></span>
          {draft.status.name}
          <ChipRemove label="Remove status" onRemove={() => onRemove({ kind: 'command', command: 'status' })} />
        </span>
      )}
      {preset?.source && <span className={styles.chipsSource}>Adding to {preset.source}</span>}
    </div>
  )
}

function hasPreset(preset: QuickAddPreset | undefined): boolean {
  return preset != null && (preset.urgent === true || preset.important === true || preset.focus === true || !!preset.source)
}

/** One line per command that sets nothing. */
function problemLine(p: CommandProblem): { label: string; explain: string; error?: boolean } {
  const first = p.command ? `the first /${p.command} counts` : ''
  switch (p.kind) {
    case 'unknown': return { label: 'Unknown command:', explain: '— stays in the title' }
    case 'duplicate': return { label: 'Repeated:', explain: `— stays in the title; ${first}` }
    case 'ignored': return { label: 'Ignored:', explain: '— repeating needs a /due date' }
    case 'unmatched': return { label: 'Unknown status:', explain: '— stays in the title', error: true }
    case 'unreadable':
      if (p.command === 'due' || p.command === 'followup') {
        return { label: "Can't read date:", explain: `— try ${DATE_ARGUMENT_HINT[p.command]}`, error: true }
      }
      if (p.command === 'repeat') {
        return { label: "Can't read repeat:", explain: `— try ${REPEAT_FREQUENCIES.join(', ')}`, error: true }
      }
      return { label: "Can't read status:", explain: '— add a status name', error: true }
  }
}

/** The field's text with tinted token spans (the mirror behind the input). */
function TintedText({ text, spans }: { text: string; spans: TintSpan[] }) {
  const out: React.ReactNode[] = []
  let at = 0
  for (const s of spans) {
    if (s.start < at || s.end > text.length) continue
    if (s.start > at) out.push(text.slice(at, s.start))
    out.push(<span key={s.start} className={styles.tint} data-tint={s.tint}>{text.slice(s.start, s.end)}</span>)
    at = s.end
  }
  out.push(text.slice(at))
  // A trailing space would collapse; keep the mirror as wide as the input text.
  return <>{out}{'​'}</>
}

// ─── Pipeline ─────────────────────────────────────────────────────

const EMPTY_PARSED: ParsedTokens = {
  title: '',
  people: [],
  tags: [],
  unmatchedPersons: [],
  unmatchedStatuses: [],
}

const EMPTY_RESOLVED: ResolvedInput = {
  title: '',
  personIds: [],
  unmatchedPersons: [],
  tags: [],
  unmatchedStatuses: [],
}

/**
 * Live pipeline: `parseInput` → `resolveInput` → entity lookup against the
 * person / status stores. Pure helper — receives stores as args so the
 * component-level `useMemo` can deps-cache it cleanly. Returns the chip
 * shape (display), the underlying `ResolvedInput` (submit feeds it to
 * `createQuickAddTask`) and the parse (token tints).
 */
function runParse(
  raw: string,
  people: Person[],
  statuses: Status[],
): { parsed: ParsedTokens; resolved: ResolvedInput; input: ReturnType<typeof parseInput> | null } {
  if (raw.trim().length === 0) return { parsed: EMPTY_PARSED, resolved: EMPTY_RESOLVED, input: null }
  const parsedInput = parseInput(raw)
  const resolved = resolveInput(parsedInput, people, statuses)

  const peopleResolved: PersistedPerson[] = resolved.personIds
    .map((id) => people.find((p) => p.id === id))
    .filter((p): p is PersistedPerson => p?.id !== undefined)
  const statusResolved =
    resolved.statusId !== undefined
      ? statuses.find((s): s is PersistedStatus => s.id === resolved.statusId)
      : undefined
  return {
    parsed: {
      title: resolved.title,
      status: statusResolved,
      people: peopleResolved,
      tags: resolved.tags,
      deadlineAt: resolved.dueDate,
      recurrence: resolved.recurrence,
      unmatchedPersons: resolved.unmatchedPersons,
      unmatchedStatuses: resolved.unmatchedStatuses,
      urgent: resolved.urgent,
      important: resolved.important,
      focus: resolved.focus,
      nextFollowupAt: resolved.nextFollowupAt,
      followupNone: resolved.followupNone,
      problems: resolved.problems,
    },
    resolved,
    input: parsedInput,
  }
}

/**
 * The autocomplete popup's anchor: the input's box from the caret column to
 * its right edge, in the viewport. `usePopoverAnchor` puts the popup below it
 * at the caret, above it when it would clip the bottom edge, and ends it at
 * the input's right edge when it would clip the right one. Null until the
 * input is mounted.
 */
function measurePopupAnchor(input: HTMLInputElement | null, caretLeft: number): PopupAnchorRect | null {
  if (!input) return null
  const r = input.getBoundingClientRect()
  return { left: r.left + caretLeft, top: r.top, right: r.right, bottom: r.bottom }
}

interface PopupAnchorRect { left: number; top: number; right: number; bottom: number }

const sameRect = (a: PopupAnchorRect | null, b: PopupAnchorRect | null) =>
  a === b || (!!a && !!b && a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom)

const OFFSCREEN: PopoverAnchor = { kind: 'point', x: -9999, y: -9999 }

// ─── Component ────────────────────────────────────────────────────

export function QuickAddBar({
  open,
  onClose,
  onSubmit,
  onOpenFullEditor,
  initialDraft,
  preset,
  parse,
}: QuickAddBarProps) {
  const [raw, setRaw] = useState('')
  /** ⏎ was pressed on text that is only tokens: the "No title" line shows until the text changes. */
  const [titleMissing, setTitleMissing] = useState(false)
  /** Preset markers whose chip × was pressed, until the bar closes. */
  const [removedPresetMarkers, setRemovedPresetMarkers] = useState<MarkerKey[]>([])
  /** Where the caret goes once a chip × has changed the text. */
  const pendingCaretRef = useRef<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  // A press that starts and ends on the backdrop closes the bar (not a text
  // drag out of the bar); the press keeps the focus in the input.
  const backdropPress = useBackdropPress(onClose, { keepFocus: true })

  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const followupInterval = useSettingsStore((s) => s.followupDefaultInterval)

  const internalRun = useMemo(
    () => runParse(raw, people, statuses),
    [raw, people, statuses],
  )
  const parsed = parse ? parse(raw) : internalRun.parsed
  // Test override (`parse`) only produces `ParsedTokens`; default to the live
  // resolver output otherwise so submit always has a valid `ResolvedInput`.
  const resolved = internalRun.resolved

  // Autocomplete candidates. Tags sort alphabetically; the others keep store order.
  const acPeople = useMemo(() => personItems(people), [people])
  const acTags = useMemo(() => tagItems(tags), [tags])
  const acStatuses = useMemo(() => statusItems(statuses), [statuses])
  const ac = useNlpAutocomplete({
    people: acPeople,
    tags: acTags,
    statuses: acStatuses,
    commands: true,
    enterSubmits: true,
    onApply: (value, cursor) => {
      setTitleMissing(false)
      const input = inputRef.current
      if (input && input.value === value) {
        input.focus()
        input.setSelectionRange(cursor, cursor)
        return
      }
      // The caret goes in once React has committed the new value, before the
      // next key press (the layout effect on `raw`): placed a frame later, it
      // would move back over keys typed meanwhile.
      pendingCaretRef.current = cursor
      setRaw(value)
    },
  })

  const removedPreset = removedPresetMarkers.length > 0 ? { removedPresetMarkers } : {}
  const draft: QuickAddDraft = {
    ...parsed,
    rawTitle: raw,
    resolved,
    ...removedPreset,
  }
  /** The draft for `text` (the current one when it's what is typed). */
  const draftFor = (text: string): QuickAddDraft => {
    if (text === raw) return draft
    const run = runParse(text, people, statuses)
    return { ...(parse ? parse(text) : run.parsed), rawTitle: text, resolved: run.resolved, ...removedPreset }
  }
  /** The preset without the markers whose chip was removed. */
  const shownPreset = useMemo<QuickAddPreset | undefined>(() => {
    if (!preset || removedPresetMarkers.length === 0) return preset
    const next: QuickAddPreset = { ...preset }
    for (const key of removedPresetMarkers) delete next[key]
    return next
  }, [preset, removedPresetMarkers])

  // The token the popup is open on: tinted as "being typed"; its problem
  // (e.g. `/due` with no argument yet) isn't listed while the popup shows it.
  const view = ac.state.visible ? ac.state.view : null
  const active = view
    ? { start: view.anchor, end: view.to, error: view.rows.some((r) => r.kind === 'error') }
    : undefined
  const tints = internalRun.input ? tokenTints(internalRun.input, resolved, active) : []
  const problems = (parsed.problems ?? []).filter(
    (p) => !active || p.end < active.start || p.start > active.end,
  )

  // Focus on open; reset (and dismiss any open popup) on close. Destructure
  // `dismiss` so the effect's deps are stable — the hook returns a fresh
  // `ac` object literal every render, but `ac.dismiss` is the same useCallback.
  // `initialDraft` is read on the closed→open transition only; later changes
  // don't re-seed (e.g. when the parent stashes a handoff draft to ui-store
  // while the bar is closed, that draft feeds the popup, not the bar).
  const { dismiss: dismissAutocomplete } = ac
  const initialDraftRef = useLatestRef(initialDraft)
  useEffect(() => {
    if (open) {
      const seed = initialDraftRef.current
      if (seed) {
        setRaw(seed.rawTitle)
      }
      // Wait a paint so the portal node exists.
      requestAnimationFrame(() => inputRef.current?.focus())
    } else {
      setRaw('')
      setTitleMissing(false)
      setRemovedPresetMarkers([])
      dismissAutocomplete()
    }
  }, [open, dismissAutocomplete, initialDraftRef])

  // A pick or a chip × changed the text: put the caret where the edit says.
  useLayoutEffect(() => {
    const caret = pendingCaretRef.current
    const input = inputRef.current
    if (caret == null || !input) return
    pendingCaretRef.current = null
    input.focus()
    input.setSelectionRange(caret, caret)
  }, [raw])

  // Keep the tint mirror scrolled with the input's text.
  const syncMirror = useCallback(() => {
    if (mirrorRef.current && inputRef.current) mirrorRef.current.scrollLeft = inputRef.current.scrollLeft
  }, [])
  useLayoutEffect(() => { syncMirror() }, [raw, syncMirror])

  // Popup placement — `usePopoverAnchor` against the input's box from the
  // caret column (`measurePopupAnchor`), portal'd to body. The rect is static
  // to the hook, so it is re-measured here on scroll (capture) and resize
  // while the popup is visible; the hook re-places on the popup's own size
  // changes.
  const [popupAnchor, setPopupAnchor] = useState<PopupAnchorRect | null>(null)
  const popupRef = useRef<HTMLDivElement | null>(null)

  // A press outside the bar and its backdrop (the backdrop closes on its own
  // click) closes the bar. The backdrop covers the page, so this is only
  // portaled UI above it — the snackbar, a tooltip — never the autocomplete
  // popup or the layers it opens. Capture phase, so a popup-side
  // stopPropagation can't help — `popupRef` is checked directly.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (overlayRef.current?.contains(target)) return
      if (popupRef.current?.contains(target)) return
      // A person's / tag's menu from the popup, or the editor / confirm it opened.
      if (surfaceRef.current && isInLayerAbove(surfaceRef.current, target)) return
      onClose()
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [open, onClose])

  const measureAnchor = useCallback(() => {
    const next = measurePopupAnchor(inputRef.current, ac.state.caretLeft)
    setPopupAnchor((prev) => (sameRect(prev, next) ? prev : next))
  }, [ac.state.caretLeft])

  useLayoutEffect(() => {
    if (!ac.state.visible) return
    measureAnchor()
  }, [ac.state.visible, measureAnchor])

  useEffect(() => {
    if (!ac.state.visible) return
    window.addEventListener('scroll', measureAnchor, true)
    window.addEventListener('resize', measureAnchor)
    return () => {
      window.removeEventListener('scroll', measureAnchor, true)
      window.removeEventListener('resize', measureAnchor)
    }
  }, [ac.state.visible, measureAnchor])

  // Keys belong to the input (`useNlpAutocomplete`); the bar's own
  // outside-click handler above covers the popup.
  const { panelRef: popupPanelRef, style: popupStyle } = usePopoverAnchor({
    anchor: popupAnchor ? { kind: 'rect', ...popupAnchor } : OFFSCREEN,
    open: ac.state.visible,
    offset: POPUP_GAP_PX,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    closeOnOutsideClick: false,
    observeSize: true,
    onClose: () => {},
  })
  const setPopupEl = useCallback((el: HTMLDivElement | null) => {
    popupRef.current = el
    popupPanelRef(el)
  }, [popupPanelRef])

  /** A chip's ×: edit the text (and drop a preset marker), keeping the caret in the field. */
  const onRemoveChip = (chip: ChipRemoval) => {
    const input = inputRef.current
    input?.focus()
    const caret = input?.selectionStart ?? raw.length
    if (chip.kind === 'marker' && preset?.[chip.marker] === true) {
      const marker = chip.marker
      setRemovedPresetMarkers((keys) => (keys.includes(marker) ? keys : [...keys, marker]))
    }
    let edit: TextEdit | null = null
    if (chip.kind === 'defaultFollowup') edit = appendTextToken(raw, FOLLOWUP_NONE_TOKEN, caret)
    else if (internalRun.input) edit = removeChip(raw, internalRun.input, chip, people, caret)
    if (!edit || edit.text === raw) return
    ac.dismiss()
    pendingCaretRef.current = edit.caret
    setRaw(edit.text)
    setTitleMissing(false)
  }

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // While the popup is open its keys never reach the bar's Esc / Tab / ⏎.
    if (ac.handleKeyDown(e, inputRef.current)) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // A submit in flight: a second Enter waits for it.
  const submittingRef = useRef(false)
  // Bumped each time the bar closes: a submit that settles after that
  // belongs to an earlier opening and must not close the bar shown now.
  const openingRef = useRef(0)
  useEffect(() => {
    if (!open) openingRef.current++
  }, [open])
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'Tab') {
      e.preventDefault()
      if (onOpenFullEditor) onOpenFullEditor(draft)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (submittingRef.current) return
      // A token the popup is open on is completed to its best match.
      const text = ac.completeForSubmit(raw)
      ac.dismiss()
      if (text !== raw) setRaw(text)
      const submitted = draftFor(text)
      if (submitted.title.trim().length === 0) {
        if (text.trim().length > 0) setTitleMissing(true)
        return
      }
      const result = onSubmit(submitted)
      if (!(result instanceof Promise)) {
        onClose()
        return
      }
      submittingRef.current = true
      const opening = openingRef.current
      void result
        .then((created) => {
          if (created && openingRef.current === opening) onClose()
        })
        .catch((err: unknown) => {
          // The bar stays open with the text; Enter tries again.
          console.warn('[quick-add] the task could not be created', err)
        })
        .finally(() => { submittingRef.current = false })
    }
  }

  if (!open) return null

  const today = startOfToday()
  const defaultFollowup = addFollowupInterval(today, followupInterval)

  return (
    <>
      {createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      data-testid="quickadd-backdrop"
      {...{ [MODAL_BACKDROP_ATTR]: '' }}
      {...backdropPress}
    >
      <div
        ref={surfaceRef}
        className={`${styles.surface} ${styles.focused}`}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKey}
        role="dialog"
        aria-label="Quick add task"
      >
        {/* Title row — the input over its tint mirror */}
        <div className={styles.titleRow}>
          <div className={styles.field}>
            <div ref={mirrorRef} className={styles.mirror} aria-hidden="true" data-testid="quickadd-mirror">
              <TintedText text={raw} spans={tints} />
            </div>
            <input
              ref={inputRef}
              className={styles.titleInput}
              placeholder="New task…"
              value={raw}
              onChange={(e) => {
                setRaw(e.target.value)
                setTitleMissing(false)
                ac.handleInputChange(
                  e.target.value,
                  e.target.selectionStart ?? e.target.value.length,
                  e.target,
                )
              }}
              onSelect={(e) => {
                const input = e.currentTarget
                syncMirror()
                // Moving the caret into / out of a token updates the popup.
                ac.handleInputChange(input.value, input.selectionStart ?? input.value.length, input)
              }}
              onScroll={syncMirror}
              onKeyDown={onInputKeyDown}
              data-shortcut-scope="none"
              spellCheck={false}
            />
          </div>
        </div>

        {/* Chips row — what the task will get */}
        {(raw.trim().length > 0 || hasPreset(shownPreset)) && (
          <ParsedChips
            draft={draft}
            preset={shownPreset}
            defaultFollowup={defaultFollowup}
            today={today}
            onRemove={onRemoveChip}
          />
        )}

        {/* `@name` that matches nobody — the person is created on submit */}
        {parsed.unmatchedPersons.length > 0 && (
          <div className={styles.problemLine}>
            <span className={styles.problemLabel}>{parsed.unmatchedPersons.length === 1 ? 'New person:' : 'New people:'}</span>
            <span className={styles.newPersonNames}>
              {parsed.unmatchedPersons.map((n) => `@${n}`).join(' ')}
            </span>
            <span>— created when you add the task</span>
          </div>
        )}

        {/* ⏎ on text that is only tokens */}
        {titleMissing && (
          <div className={styles.problemLine} role="alert">
            <span className={styles.problemLabel}>No title:</span>
            <span>— type what the task is; @ # / only add details</span>
          </div>
        )}

        {/* Commands that set nothing */}
        {problems.map((p) => {
          const line = problemLine(p)
          return (
            <div key={`${p.kind}-${p.start}`} className={styles.problemLine}>
              <span className={styles.problemLabel}>{line.label}</span>
              <span className={line.error ? styles.problemTokenError : styles.problemToken}>{p.raw}</span>
              <span>{line.explain}</span>
            </div>
          )
        })}

        {/* Footer row — syntax hints + Details + keyboard hints */}
        <div className={styles.footerRow}>
          <div className={styles.nlpHints}>
            <span><Kbd>@</Kbd> person</span>
            <span aria-hidden="true">·</span>
            <span><Kbd>#</Kbd> tag</span>
            <span aria-hidden="true">·</span>
            <span><Kbd>/</Kbd> command</span>
          </div>
          <div className={styles.actionCluster}>
            <button
              className={styles.detailsBtn}
              onClick={() => onOpenFullEditor?.(draft)}
              disabled={!onOpenFullEditor}
            >
              Details <span className={styles.kbd}>Tab</span>
            </button>
            <span className={styles.hintCluster}>
              <span><Kbd>⏎</Kbd> add</span>
              <span aria-hidden="true">·</span>
              <span><Kbd>Esc</Kbd> close</span>
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
      )}
      {ac.state.visible && ac.state.view &&
        createPortal(
          // The bar sits on the dialog tier: a person's / tag's menu leaves out
          // Show tasks (the task dialog couldn't show above it).
          <DialogLayerContext.Provider value="dialog">
            <NlpPopup
              view={ac.state.view}
              selectedIndex={ac.state.selectedIndex}
              onPick={(row) => ac.select(row, inputRef.current)}
              popupRef={setPopupEl}
              className={styles.popup}
              style={{ top: popupStyle.top, left: popupStyle.left, width: POPUP_WIDTH_PX }}
              entityMenu={{ keyTarget: () => inputRef.current }}
            />
          </DialogLayerContext.Provider>,
          document.body,
        )}
    </>
  )
}
