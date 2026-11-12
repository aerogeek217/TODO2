import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { PersistedPerson } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useFilterSettings } from '../../hooks/use-filter-settings'
import { useToday } from '../../hooks/use-today'
import { checkinRecipients } from '../../services/checkin-email/recipients'
import { checkinTaskCount, selectCheckinTasks } from '../../services/checkin-email/select'
import {
  buildCheckinContext,
  CHECKIN_INCLUDE_DEFAULTS,
  checkinCopiedStatus,
  checkinSubjectCopiedStatus,
  copyCheckinMessage,
  copyCheckinSubject,
  COPY_FAILED_NOTICE,
  prepareCheckin,
} from '../../services/checkin-email/person-checkin'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useStatusUpdateStore } from '../../stores/status-update-store'
import { useSubtaskStore } from '../../stores/subtask-store'
import { useUIStore } from '../../stores/ui-store'
import { isNoCheckinFilter } from '../../utils/checkin-settings'
import type { ListFilterField } from '../../stores/list-widget-store'
import { DialogFrame } from '../shared/Dialog'
import { PredicateChips } from '../shared/filters/PredicateChips'
import type { DateFilterHost } from '../shared/filters/DateFilterPanel'
import { CopyIcon } from '../shared/icons'
import { useTooltip } from '../shared/use-tooltip'
import styles from './CheckinDialog.module.css'

interface Status {
  text: string
  error?: boolean
}

const tasksLabel = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`
/** The check-in is per person: its filter has no People field. */
const CHECKIN_OMIT_FIELDS: readonly ListFilterField[] = ['people']
/** A check-in takes open tasks only, so its date panel leaves Completed out. */
const CHECKIN_DATE_HOST: DateFilterHost = { omit: ['completed'] }

/**
 * The check-in dialog (`ui-store.checkinDialog`), opened from the Review
 * widget's Check-in button for the filter's people. Left: the people — one
 * per person with open tasks, plus the people it was opened for — as a
 * single-select list (↑ / ↓), then Which tasks (the saved check-in filter,
 * written at once: `settings-store.checkinTaskFilter`) and Include (dialog
 * state). Right: the selected person's message — its subject with Copy
 * subject, the body in a sandboxed frame — and **Copy**, which puts the body
 * on the clipboard as rich HTML + plain text. Copying records nothing: no
 * follow-up, no undo entry (the reply import's Record a follow-up does that).
 *
 * Mounted by the workspace page, which loads every task, their people and
 * tags and the statuses this reads.
 */
export function CheckinDialog() {
  const state = useUIStore((s) => s.checkinDialog)
  if (!state) return null
  return <CheckinDialogPanel openedFor={state.personIds} />
}

function CheckinDialogPanel({ openedFor }: { openedFor: number[] }) {
  // A new open request while open (another entry point): start afresh.
  const [opened, setOpened] = useState(openedFor)
  const [selectedId, setSelectedId] = useState<number | null>(openedFor[0] ?? null)
  const [copied, setCopied] = useState<ReadonlySet<number>>(() => new Set())
  const [status, setStatus] = useState<Status | null>(null)
  if (opened !== openedFor) {
    setOpened(openedFor)
    setSelectedId(openedFor[0] ?? null)
    setCopied(new Set())
    setStatus(null)
  }
  const [includeNotes, setIncludeNotes] = useState(CHECKIN_INCLUDE_DEFAULTS.includeNotes)
  const [includeOthers, setIncludeOthers] = useState(CHECKIN_INCLUDE_DEFAULTS.includeOthers)

  const close = useUIStore((s) => s.closeCheckinDialog)
  const openImport = useUIStore((s) => s.openCheckinImport)
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const statusUpdatesByTodo = useStatusUpdateStore((s) => s.byTodo)
  const subtasksByTodo = useSubtaskStore((s) => s.byTodo)
  const filter = useSettingsStore((s) => s.checkinTaskFilter)
  const filterSettings = useFilterSettings()
  const today = useToday()

  const titleId = useId()
  const listRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLButtonElement>(null)

  const recipients = useMemo(
    () => checkinRecipients(people, todos, assignedPeopleMap, opened),
    [people, todos, assignedPeopleMap, opened],
  )
  const buildCtx = useMemo(() => buildCheckinContext({
    todos, today, assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo, subtasksByTodo, filterSettings,
  }), [todos, today, assignedPeopleMap, assignedTagsMap, statuses, statusUpdatesByTodo, subtasksByTodo, filterSettings])

  const countFor = useCallback(
    (p: PersistedPerson) => checkinTaskCount(selectCheckinTasks(p, filter, buildCtx)),
    [filter, buildCtx],
  )
  const filtered = !isNoCheckinFilter(filter)
  const selected = recipients.find((p) => p.id === selectedId) ?? recipients[0]

  const build = useCallback(
    (p: PersistedPerson) => prepareCheckin(p, filter, buildCtx, { includeNotes, includeOthers }, new Date()),
    [filter, buildCtx, includeNotes, includeOthers],
  )
  const prepared = useMemo(() => (selected ? build(selected) : null), [selected, build])
  const hasTasks = prepared != null && prepared.taskIds.length > 0

  // On open: Copy when the selected person's message has tasks, else the people list.
  const [initialFocus] = useState(() => (hasTasks ? copyRef : listRef))

  const select = (p: PersistedPerson) => {
    setSelectedId(p.id)
    requestAnimationFrame(() => {
      listRef.current?.querySelector(`[data-checkin-row="${p.id}"]`)?.scrollIntoView({ block: 'nearest' })
    })
  }

  const onListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!selected || recipients.length === 0) return
    const at = recipients.findIndex((p) => p.id === selected.id)
    const to = e.key === 'ArrowDown' ? Math.min(at + 1, recipients.length - 1)
      : e.key === 'ArrowUp' ? Math.max(at - 1, 0)
        : e.key === 'Home' ? 0
          : e.key === 'End' ? recipients.length - 1
            : null
    if (to == null) return
    e.preventDefault()
    const next = recipients[to]
    if (next) select(next)
  }

  const copy = async () => {
    if (!selected) return
    // Built afresh for the click (today's date in its footer); the clipboard
    // write starts before any `await`, inside the click's user gesture.
    const now = build(selected)
    if (now.taskIds.length === 0) return
    const ok = await copyCheckinMessage(now.email)
    if (!ok) {
      setStatus({ text: COPY_FAILED_NOTICE, error: true })
      return
    }
    setCopied((prev) => new Set(prev).add(selected.id))
    setStatus({ text: checkinCopiedStatus(selected.name) })
  }

  const copySubject = async () => {
    if (!selected || !prepared) return
    const ok = await copyCheckinSubject(prepared.email)
    setStatus(ok ? { text: checkinSubjectCopiedStatus(selected.name) } : { text: COPY_FAILED_NOTICE, error: true })
  }

  const subjectTip = useTooltip('Copy subject')
  const noTasksText = selected
    ? (filtered ? 'No open tasks match Which tasks.' : `${selected.name} has no open tasks.`)
    : ''
  const optionId = (id: number) => `${titleId}-person-${id}`

  return (
    <DialogFrame
      onClose={close}
      layer="overlay"
      initialFocus={initialFocus}
      aria-labelledby={titleId}
      className={styles.dialog}
      data={{ 'checkin-dialog': '' }}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>Task check-ins</h2>
        <button type="button" className={styles.closeBtn} aria-label="Close" onClick={close}>×</button>
      </div>

      <div className={styles.body}>
        <div className={styles.side}>
          <section className={styles.group}>
            <div id={`${titleId}-people`} className={styles.groupLabel}>People</div>
            {recipients.length === 0
              ? <div className={styles.empty}>Nobody has open tasks assigned.</div>
              : (
                <div
                  ref={listRef}
                  role="listbox"
                  tabIndex={0}
                  className={styles.people}
                  aria-labelledby={`${titleId}-people`}
                  aria-activedescendant={selected ? optionId(selected.id) : undefined}
                  onKeyDown={onListKeyDown}
                  data-testid="checkin-people"
                >
                  {recipients.map((p) => {
                    const isSelected = p.id === selected?.id
                    return (
                      <div
                        key={p.id}
                        id={optionId(p.id)}
                        role="option"
                        aria-selected={isSelected}
                        className={`${styles.person} ${isSelected ? styles.personSelected : ''}`}
                        data-checkin-row={p.id}
                        onClick={() => select(p)}
                      >
                        <span className={styles.avatar} style={{ background: p.color ?? NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                          {p.initials || p.name.slice(0, 2).toUpperCase()}
                        </span>
                        <span className={styles.who}>
                          <span className={styles.name}>{p.name}</span>
                          <span className={styles.count} data-checkin-count="">
                            {tasksLabel(countFor(p))}
                            {copied.has(p.id) && <span className={styles.copiedMark}> · Copied ✓</span>}
                          </span>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
          </section>

          <section className={styles.group} aria-labelledby={`${titleId}-filter`}>
            <div id={`${titleId}-filter`} className={styles.groupLabel}>Which tasks · remembered for every check-in</div>
            <div className={styles.filterLine} data-testid="checkin-filter">
              <PredicateChips
                predicate={filter}
                onChange={(next) => { void useSettingsStore.getState().setCheckinTaskFilter(next) }}
                addLabel="Add a filter to the check-in"
                layout="stack"
                allowDone={false}
                omitFields={CHECKIN_OMIT_FIELDS}
                dateHost={CHECKIN_DATE_HOST}
                inDialog
                before={filtered ? undefined : <span className={styles.noFilter}>All open tasks</span>}
              />
            </div>
          </section>

          <section className={styles.group}>
            <div className={styles.groupLabel}>Include</div>
            <label className={styles.check}>
              <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
              Task notes
            </label>
            <label className={styles.check}>
              <input type="checkbox" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} />
              Other people on the task
            </label>
          </section>
        </div>

        <div className={styles.message} data-testid="checkin-message">
          {selected && prepared && (
            <>
              <div className={styles.subjectLine}>
                <span className={styles.groupLabel}>Subject</span>
                <span className={styles.subject} data-testid="checkin-subject">{prepared.email.subject}</span>
                <button
                  type="button"
                  className={styles.iconBtn}
                  aria-label="Copy subject"
                  disabled={!hasTasks}
                  {...subjectTip.triggerProps}
                  onClick={() => { void copySubject() }}
                >
                  <CopyIcon size={14} />
                </button>
                {subjectTip.tooltip}
              </div>
              {hasTasks
                ? (
                  <iframe
                    className={styles.frame}
                    title={`Check-in for ${selected.name}`}
                    sandbox=""
                    // Out of the Tab order: keys inside a frame never reach the dialog's
                    // focus trap, so a Tab out of it would leave the dialog.
                    tabIndex={-1}
                    srcDoc={previewDocument(prepared.email.html)}
                  />
                )
                : <div className={styles.noTasks} data-testid="checkin-no-tasks">{noTasksText}</div>}
            </>
          )}
          <div className={styles.copyRow}>
            <button
              ref={copyRef}
              type="button"
              className={styles.copyBtn}
              aria-label="Copy message"
              disabled={!hasTasks}
              data-checkin-copy=""
              onClick={() => { void copy() }}
            >
              <CopyIcon size={14} />
              Copy
            </button>
          </div>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.status} role="status" aria-live="polite">
          {status && (
            <span className={status.error ? styles.statusError : undefined} data-checkin-status="">{status.text}</span>
          )}
        </div>
        <button type="button" className={styles.linkBtn} onClick={() => openImport()}>Paste a reply…</button>
        <button type="button" className={styles.footerBtn} onClick={close}>Done</button>
      </div>
    </DialogFrame>
  )
}

/** The message as a full HTML document for the frame: no scripts, nothing fetched. */
function previewDocument(html: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<style>body{margin:0;padding:20px 24px;background:#ffffff;color:#242424}</style>',
    `</head><body>${html}</body></html>`,
  ].join('')
}
