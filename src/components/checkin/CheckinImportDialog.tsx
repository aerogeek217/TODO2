import { useId, useMemo, useRef, useState } from 'react'
import type { PersistedPerson } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import {
  applyCheckinUpdates,
  checkinChangeKey,
  defaultCheckinSelection,
  selectedCheckinUpdates,
} from '../../services/checkin-reply/apply'
import {
  diffCheckinReply,
  type CheckinChange,
  type CheckinReplyDiff,
  type CheckinTaskDiff,
  type NotesDiffLine,
} from '../../services/checkin-reply/diff'
import { parseCheckinReply, type CheckinReplyInput } from '../../services/checkin-reply/parse'
import { advanceRecurring } from '../../services/recurrence'
import { usePersonStore } from '../../stores/person-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { DialogFrame } from '../shared/Dialog'
import styles from './CheckinImportDialog.module.css'
import { collapseWhitespace } from '../../utils/text'
import { byName } from '../../utils/sort-order'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const sameName = (a: string, b: string) => collapseWhitespace(a).toLocaleLowerCase() === collapseWhitespace(b).toLocaleLowerCase()

const FIELD_LABEL: Record<CheckinChange['field'], string> = {
  completed: 'Completed',
  progress: 'Progress',
  notes: 'Notes',
}

interface ReadReply {
  diff: CheckinReplyDiff
  /** Update boxes whose Ref line was deleted (skipped). */
  orphanUpdates: number
}

/** Reads a paste into the proposed changes, or says why it can't be read. */
function readPaste(input: CheckinReplyInput): { reply: ReadReply } | { error: string } {
  if ((input.html ?? '').trim() === '' && input.plain.trim() === '') {
    return { error: 'There was no text to read. Copy the reply in your mail app and paste it again.' }
  }
  const parsed = parseCheckinReply(input)
  if (!parsed.ok) {
    return { error: `This paste is too large to read (over ${Math.round(parsed.limit / (1024 * 1024))} MB). Copy just the reply and paste again.` }
  }
  if (parsed.reply.blocks.length === 0) {
    return { error: 'No task updates were found. Copy the whole reply, including each task’s Ref line, and paste again.' }
  }
  const diff = diffCheckinReply(parsed.reply, { todos: useTodoStore.getState().todos })
  return { reply: { diff, orphanUpdates: parsed.reply.orphanUpdates } }
}

/**
 * The check-in reply import dialog (`ui-store.checkinImportOpen`): the user
 * pastes a reply to a check-in email, reviews each proposed change (all
 * ticked except on tasks changed in the app since the email, and emptied
 * notes) and applies the ticked ones as one undoable step — optionally
 * recording a follow-up on every task that changed.
 *
 * The paste is read from the `paste` event's `text/html` and `text/plain`
 * flavours (no clipboard permission needed). Nothing pasted is rendered as
 * HTML: titles, values and the notes diff are plain text.
 *
 * Mounted by the workspace page, which loads every task and the people.
 */
export function CheckinImportDialog() {
  const open = useUIStore((s) => s.checkinImportOpen)
  if (!open) return null
  return <CheckinImportPanel />
}

function CheckinImportPanel() {
  const close = useUIStore((s) => s.closeCheckinImport)
  const allPeople = usePersonStore((s) => s.people)
  const people = useMemo(
    () => allPeople.flatMap((p): PersistedPerson[] => (p.id != null ? [{ ...p, id: p.id }] : [])),
    [allPeople],
  )

  const [reply, setReply] = useState<ReadReply | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set())
  const [recordFollowup, setRecordFollowup] = useState(true)
  const [pickedPersonId, setPickedPersonId] = useState<number | null>(null)
  const [applying, setApplying] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const pasteRef = useRef<HTMLTextAreaElement>(null)

  const footerPerson = useMemo(() => {
    const name = reply?.diff.personName
    return name ? people.find((p) => sameName(p.name, name)) ?? null : null
  }, [reply, people])
  const person: PersistedPerson | null = footerPerson
    ?? (pickedPersonId != null ? people.find((p) => p.id === pickedPersonId) ?? null : null)

  const updates = useMemo(() => (reply ? selectedCheckinUpdates(reply.diff, selected) : []), [reply, selected])
  const selectedCount = updates.reduce((n, u) => n + u.changeCount, 0)

  const read = (input: CheckinReplyInput) => {
    const result = readPaste(input)
    if ('error' in result) {
      setError(result.error)
      return
    }
    setError(null)
    setApplyError(null)
    setReply(result.reply)
    setSelected(defaultCheckinSelection(result.reply.diff))
    setPickedPersonId(null)
    requestAnimationFrame(() => panelRef.current?.focus())
  }

  const onPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const plain = e.clipboardData.getData('text/plain')
    read({ ...(html ? { html } : {}), plain })
  }

  const pasteAgain = () => {
    setReply(null)
    setError(null)
    setApplyError(null)
    setSelected(new Set())
    setPickedPersonId(null)
    requestAnimationFrame(() => pasteRef.current?.focus())
  }

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const apply = async () => {
    if (!person || selectedCount === 0 || applying) return
    setApplying(true)
    setApplyError(null)
    try {
      await applyCheckinUpdates(updates, { recordFollowup, personName: person.name })
      close()
    } catch {
      setApplying(false)
      setApplyError('Couldn’t apply every change. Undo takes back the ones that were applied.')
    }
  }

  const applyLabel = reply ? `Apply ${plural(selectedCount, 'change')}` : 'Apply changes'
  const applyBlocked = !reply ? undefined : !person ? 'Choose who replied first' : selectedCount === 0 ? 'Nothing is ticked' : undefined

  return (
    <DialogFrame
      onClose={close}
      layer="overlay"
      initialFocus={pasteRef}
      aria-labelledby={titleId}
      className={styles.dialog}
      data={{ 'checkin-import': '' }}
      panelRef={panelRef}
    >
      <div className={styles.header}>
        <h2 id={titleId} className={styles.title}>Import task update</h2>
        <button type="button" className={styles.closeBtn} aria-label="Close" onClick={close}>×</button>
      </div>

      {reply && (
        <ReplySummary
          reply={reply}
          person={person}
          footerPerson={footerPerson}
          people={people}
          pickedPersonId={pickedPersonId}
          onPick={setPickedPersonId}
          onPasteAgain={pasteAgain}
        />
      )}

      <div className={styles.body}>
        {!reply && (
          <>
            <textarea
              ref={pasteRef}
              className={styles.pasteTarget}
              aria-label="Paste the reply here"
              aria-describedby={`${titleId}-help`}
              placeholder="Paste the reply here (Ctrl+V)"
              value=""
              onChange={() => {}}
              onPaste={onPaste}
              spellCheck={false}
              data-checkin-paste=""
            />
            <p id={`${titleId}-help`} className={styles.help}>
              Open the person’s reply to a check-in email, select all of it (Ctrl+A), copy it (Ctrl+C) and paste it here.
              Nothing changes until you review the changes and apply them.
            </p>
            {error && <div className={styles.error} role="alert">{error}</div>}
          </>
        )}

        {reply && (
          <ReplyChanges
            reply={reply}
            selected={selected}
            onToggle={toggle}
            recordFollowup={recordFollowup}
            onRecordFollowup={setRecordFollowup}
            followupId={`${titleId}-followup`}
          />
        )}
        {applyError && <div className={styles.error} role="alert">{applyError}</div>}
      </div>

      <div className={styles.footer}>
        <span className={styles.hint}>You can undo this after applying.</span>
        <button type="button" className={styles.footerBtn} onClick={close}>Cancel</button>
        <button
          type="button"
          className={styles.applyBtn}
          disabled={!reply || applyBlocked !== undefined || applying}
          title={applyBlocked}
          onClick={() => { void apply() }}
          data-checkin-apply=""
        >
          {applyLabel}
        </button>
      </div>
    </DialogFrame>
  )
}

function ReplySummary({ reply, person, footerPerson, people, pickedPersonId, onPick, onPasteAgain }: {
  reply: ReadReply
  person: PersistedPerson | null
  footerPerson: PersistedPerson | null
  people: PersistedPerson[]
  pickedPersonId: number | null
  onPick: (id: number | null) => void
  onPasteAgain: () => void
}) {
  const { diff } = reply
  const pickId = useId()
  const counts = [
    `${diff.tasks.length} of ${plural(diff.blockCount, 'task')} matched by Ref`,
    `${plural(diff.changeCount, 'change')} found`,
    ...(diff.staleCount > 0 ? [`${plural(diff.staleCount, 'task')} changed since the email was sent`] : []),
  ].join(' · ')
  const sortedPeople = useMemo(() => [...people].sort(byName), [people])

  return (
    <div className={styles.summary} data-checkin-summary="">
      <div className={styles.summaryRow}>
        {person
          ? (
            <span className={styles.avatar} style={{ background: person.color ?? NEUTRAL_PERSON_COLOR }} aria-hidden="true">
              {person.initials || person.name.slice(0, 2).toUpperCase()}
            </span>
          )
          : <span className={`${styles.avatar} ${styles.avatarEmpty}`} aria-hidden="true">?</span>}
        <div className={styles.summaryText}>
          {footerPerson
            ? <div className={styles.replyFrom}>Reply from {footerPerson.name}</div>
            : (
              <label className={styles.replyFrom} htmlFor={pickId}>
                Reply from
                <select
                  id={pickId}
                  className={`${styles.personPick} ${pickedPersonId == null ? styles.personPickMissing : ''}`}
                  value={pickedPersonId ?? ''}
                  required
                  onChange={(e) => onPick(e.target.value === '' ? null : Number(e.target.value))}
                >
                  <option value="">Choose a person…</option>
                  {sortedPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            )}
          <div className={styles.counts}>{counts}</div>
        </div>
        <button type="button" className={styles.againBtn} onClick={onPasteAgain}>Paste again</button>
      </div>
      {footerPerson
        ? <div className={styles.note}>The person and send date come from the email’s “Check-in for …” footer.</div>
        : diff.personName
          ? <div className={styles.warn}>The footer names “{diff.personName}”, who isn’t one of your people. Choose who replied.</div>
          : <div className={styles.warn}>No “Check-in for …” footer was found. Choose who replied.</div>}
      {!diff.sentDate && (
        <div className={styles.warn}>
          Without the footer’s send date, tasks changed in the app since the email can’t be flagged. Check each change before applying.
        </div>
      )}
    </div>
  )
}

function ReplyChanges({ reply, selected, onToggle, recordFollowup, onRecordFollowup, followupId }: {
  reply: ReadReply
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
  recordFollowup: boolean
  onRecordFollowup: (on: boolean) => void
  followupId: string
}) {
  const { diff, orphanUpdates } = reply
  const shown = diff.tasks.filter((t) => t.changes.length > 0 || t.completedSinceSent)
  const unchanged = diff.tasks.filter((t) => t.changes.length === 0 && !t.completedSinceSent)

  return (
    <>
      {shown.map((task) => (
        <TaskCard key={task.todo.id} task={task} selected={selected} onToggle={onToggle} />
      ))}
      {shown.length === 0 && <div className={styles.note}>No changes to apply: the reply matches the tasks as they are now.</div>}
      {unchanged.length > 0 && shown.length > 0 && (
        <div className={styles.note} data-checkin-unchanged="">
          No changes in {plural(unchanged.length, 'other task')}: {unchanged.map((t) => t.todo.title).join(' · ')}
        </div>
      )}
      {(diff.unmatched.length > 0 || orphanUpdates > 0) && (
        <ul className={styles.unmatched} data-checkin-unmatched="">
          {diff.unmatched.map((u) => (
            <li key={u.ref}>
              {u.reason === 'ambiguous' ? 'Matches several tasks: ' : 'Not found: '}
              <span className={styles.ref}>{u.ref}</span>
              {u.title ? ` “${u.title}”` : ''}
            </li>
          ))}
          {orphanUpdates > 0 && (
            <li>{orphanUpdates === 1 ? 'An update box without its Ref line was skipped.' : `${orphanUpdates} update boxes without their Ref line were skipped.`}</li>
          )}
        </ul>
      )}
      {shown.some((t) => t.changes.length > 0) && (
        <label className={styles.followup} htmlFor={followupId}>
          <input
            id={followupId}
            type="checkbox"
            className={styles.checkbox}
            checked={recordFollowup}
            onChange={(e) => onRecordFollowup(e.target.checked)}
          />
          <span>
            Record a follow-up on these tasks{' '}
            <span className={styles.followupHint}>
              (Last follow-up → today; Next follow-up moves by your default interval, the same as “Followed up”)
            </span>
          </span>
        </label>
      )}
    </>
  )
}

function TaskCard({ task, selected, onToggle }: {
  task: CheckinTaskDiff
  selected: ReadonlySet<string>
  onToggle: (key: string) => void
}) {
  const { todo } = task
  return (
    <section className={styles.card} aria-label={todo.title} data-checkin-task={todo.id}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{todo.title}</span>
        <span className={styles.ref}>{task.ref}</span>
      </div>
      {task.completedSinceSent
        ? <div className={styles.note}>Completed in the app since this email was sent. Nothing to apply.</div>
        : task.stale && <div className={styles.warn}>Changed in the app since this email was sent. Check before applying.</div>}
      {task.changes.map((change) => {
        const key = checkinChangeKey(todo.id, change.field)
        return (
          <ChangeRow
            key={key}
            change={change}
            repeats={change.field === 'completed' && advanceRecurring(todo) !== null}
            checked={selected.has(key)}
            onToggle={() => onToggle(key)}
          />
        )
      })}
    </section>
  )
}

function ChangeRow({ change, repeats, checked, onToggle }: {
  change: CheckinChange
  repeats: boolean
  checked: boolean
  onToggle: () => void
}) {
  const id = useId()
  return (
    <div className={styles.change} data-checkin-change={change.field}>
      <input id={id} type="checkbox" className={styles.checkbox} checked={checked} onChange={onToggle} />
      <label htmlFor={id} className={styles.changeLabel}>{FIELD_LABEL[change.field]}</label>
      <div className={`${styles.changeBody} ${checked ? '' : styles.changeOff}`}>
        {change.field === 'completed' && (
          <div className={styles.fromTo}>
            <span className={styles.from}><span className={`${styles.dot} ${styles.dotOpen}`} />Open</span>
            <span className={styles.arrow} aria-hidden="true">→</span>
            <span className={styles.to}><span className={`${styles.dot} ${styles.dotDone}`} />Completed</span>
            {repeats && <span className={styles.note}>Repeats, so it moves to its next due date.</span>}
          </div>
        )}
        {change.field === 'progress' && (
          <div className={styles.fromTo}>
            <span className={styles.from}>{change.from.trim() === '' ? '—' : change.from}</span>
            <span className={styles.arrow} aria-hidden="true">→</span>
            <span className={styles.to}>{change.to}</span>
          </div>
        )}
        {change.field === 'notes' && (
          <>
            {change.emptied && <div className={styles.warn}>The reply’s Notes are empty: applying removes the task’s notes.</div>}
            <NotesDiff lines={change.lines} />
          </>
        )}
      </div>
    </div>
  )
}

const SIGN: Record<NotesDiffLine['op'], string> = { '=': ' ', '-': '−', '+': '+' }
const SIGN_LABEL: Record<NotesDiffLine['op'], string | undefined> = { '=': undefined, '-': 'Removed: ', '+': 'Added: ' }

/** The notes line diff, as text: unchanged lines muted, removed struck, added accented. */
function NotesDiff({ lines }: { lines: readonly NotesDiffLine[] }) {
  return (
    <div className={styles.diff} data-checkin-notes-diff="">
      {lines.map((line, i) => (
        <div
          key={i}
          className={`${styles.line} ${line.op === '-' ? styles.lineRemoved : line.op === '+' ? styles.lineAdded : ''}`}
          data-op={line.op}
        >
          <span className={styles.sign} aria-hidden="true">{SIGN[line.op]}</span>
          <span className={styles.lineText}>
            {SIGN_LABEL[line.op] && <span className={styles.srOnly}>{SIGN_LABEL[line.op]}</span>}
            {line.text}
          </span>
        </div>
      ))}
    </div>
  )
}
