import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { PersistedPerson } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useMarkerSettings } from '../../hooks/use-marker-settings'
import { useToday } from '../../hooks/use-today'
import { buildCheckinEmail, type CheckinEmail } from '../../services/checkin-email/build'
import { checkinRecipients } from '../../services/checkin-email/recipients'
import { createTaskRefLookup } from '../../services/checkin-email/ref'
import { checkinTaskCount, selectCheckinTasks, type CheckinSelectContext } from '../../services/checkin-email/select'
import { sendCheckinEmail } from '../../services/checkin-email/send'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { usePersonStore } from '../../stores/person-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { isValidEmail } from '../../utils/person'
import {
  CHECKIN_LIST_SCOPE_HINT,
  CHECKIN_OPEN_METHOD_OPTIONS,
  CHECKIN_QUICK_SCOPES,
  checkinTaskScopeEqual,
  resolveCheckinTaskScope,
  type CheckinTaskScope,
} from '../../utils/checkin-settings'
import { PeopleEditor } from '../settings/PeopleEditor'
import { Dialog } from '../shared/Dialog'
import { ChevronDownIcon } from '../workspace/icons'
import { MenuPopover, type MenuEntry } from '../workspace/MenuPopover'
import styles from './CheckinDialog.module.css'

type SentAs = 'opened' | 'downloaded'

interface Toast {
  text: string
  error?: boolean
}

const tasksLabel = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`
/** Whether the person has an email a check-in can go to (one valid address). */
const hasEmail = (p: PersistedPerson) => isValidEmail(p.email ?? '')

/**
 * The email check-in dialog (`ui-store.checkinDialog`): one row per person
 * with open tasks (plus the people it was opened for), each sent on its own
 * with the row's button — one message per click, since the clipboard holds
 * one body at a time. Sending puts the body on the clipboard and opens a
 * `mailto:` link, or downloads an `.eml` draft (Settings' choice, also set
 * here), then records a follow-up on the email's tasks (one undo entry).
 *
 * Mounted by the workspace page, which loads every task, their people and
 * tags, the statuses and the saved lists this reads.
 */
export function CheckinDialog() {
  const state = useUIStore((s) => s.checkinDialog)
  if (!state) return null
  return <CheckinDialogPanel openedFor={state.personIds} />
}

function CheckinDialogPanel({ openedFor }: { openedFor: number[] }) {
  // A new open request while open (another entry point): start afresh.
  const [opened, setOpened] = useState(openedFor)
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(openedFor))
  const [sent, setSent] = useState<ReadonlyMap<number, SentAs>>(() => new Map())
  if (opened !== openedFor) {
    setOpened(openedFor)
    setTicked(new Set(openedFor))
    setSent(new Map())
  }
  const [includeNotes, setIncludeNotes] = useState(true)
  const [includeOthers, setIncludeOthers] = useState(true)
  const [toast, setToast] = useState<Toast | null>(null)
  const [scopeMenuOpen, setScopeMenuOpen] = useState(false)
  const [emailEditorFor, setEmailEditorFor] = useState<number | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)

  const close = useUIStore((s) => s.closeCheckinDialog)
  const openImport = useUIStore((s) => s.openCheckinImport)
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const todos = useTodoStore((s) => s.todos)
  const statuses = useStatusStore((s) => s.statuses)
  const listDefinitions = useListDefinitionStore((s) => s.listDefinitions)
  const weekStartsOn = useSettingsStore((s) => s.weekStartsOn)
  const scopeSetting = useSettingsStore((s) => s.checkinTaskScope)
  const method = useSettingsStore((s) => s.checkinOpenMethod)
  const markerSettings = useMarkerSettings()
  const today = useToday()

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const scopeButtonRef = useRef<HTMLButtonElement>(null)

  const recipients = useMemo(
    () => checkinRecipients(people, todos, assignedPeopleMap, opened),
    [people, todos, assignedPeopleMap, opened],
  )
  const selectCtx = useMemo<CheckinSelectContext>(() => ({
    todos, today, assignedPeopleMap, assignedTagsMap, statuses, listDefinitions, markerSettings, weekStartsOn,
  }), [todos, today, assignedPeopleMap, assignedTagsMap, statuses, listDefinitions, markerSettings, weekStartsOn])
  const scope = useMemo(
    () => resolveCheckinTaskScope(scopeSetting, listDefinitions.map((d) => d.id)),
    [scopeSetting, listDefinitions],
  )
  const refOf = useMemo(() => createTaskRefLookup(todos.map((t) => t.uid)), [todos])

  const countFor = useCallback(
    (p: PersistedPerson, s: CheckinTaskScope) => checkinTaskCount(selectCheckinTasks(p, s, selectCtx)),
    [selectCtx],
  )
  const isChecked = (p: PersistedPerson) => ticked.has(p.id) && hasEmail(p)
  const checkedPeople = recipients.filter(isChecked)
  // The menu counts the people ticked; with nobody ticked, everyone listed.
  const menuPeople = checkedPeople.length > 0 ? checkedPeople : recipients

  const buildEmail = useCallback((p: PersistedPerson, sentAt: Date): { email: CheckinEmail; taskIds: number[] } => {
    const sections = selectCheckinTasks(p, scope, selectCtx)
    const email = buildCheckinEmail(p, sections, { today, assignedPeopleMap, assignedTagsMap, refOf }, { includeNotes, includeOthers, sentAt })
    return { email, taskIds: [...sections.overdue, ...sections.comingUp].map((t) => t.id) }
  }, [scope, selectCtx, today, assignedPeopleMap, assignedTagsMap, refOf, includeNotes, includeOthers])
  const buildPreview = useCallback((p: PersistedPerson) => buildEmail(p, new Date()).email, [buildEmail])

  // Focus: the panel on open, back where it was on close.
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => {
      if (prev && document.body.contains(prev)) prev.focus()
    }
  }, [])

  const layerOpen = emailEditorFor !== null || previewOpen || scopeMenuOpen
  const layerOpenRef = useLatestRef(layerOpen)
  const closeRef = useLatestRef(close)
  // Esc with nothing focused (focus fell to the page, e.g. after the mail app
  // opened) still closes it — and only it, not a dialog underneath — unless
  // a layer on top (people editor, preview, menu) has it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || layerOpenRef.current) return
      if (document.activeElement && document.activeElement !== document.body) return
      e.preventDefault()
      closeRef.current()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [layerOpenRef, closeRef])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // A modal: no key reaches the app's shortcuts or the widgets behind.
    e.stopPropagation()
    if (e.key === 'Escape') {
      e.preventDefault()
      if (!layerOpen) close()
      return
    }
    if (e.key !== 'Tab') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled])',
    ) ?? []).filter((el) => el.offsetParent !== null || el === document.activeElement)
    const first = items[0]
    const last = items[items.length - 1]
    if (!first || !last) return
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  /** After a send: the next row still to send, else Done. */
  const focusNext = () => {
    requestAnimationFrame(() => {
      const panel = panelRef.current
      const next = panel?.querySelector<HTMLElement>('[data-checkin-send]:not([disabled])')
        ?? panel?.querySelector<HTMLElement>('[data-checkin-done]')
      next?.focus()
    })
  }

  const send = async (p: PersistedPerson) => {
    const sentAt = new Date()
    const { email, taskIds } = buildEmail(p, sentAt)
    if (taskIds.length === 0) return
    // First thing in the click: the clipboard needs the user gesture.
    const result = await sendCheckinEmail({ email, personName: p.name, method, sentAt })
    if (result === 'copy-failed') {
      setToast({ text: 'Couldn’t copy the email to the clipboard, so nothing was opened. Try again.', error: true })
      return
    }
    if (result === 'invalid-address') {
      setToast({ text: `${p.name}’s email address isn’t valid, so nothing was sent. Fix it in People.`, error: true })
      return
    }
    setSent((prev) => new Map(prev).set(p.id, result))
    setToast({
      text: result === 'opened'
        ? `Opened a message to ${p.name}. The body is on your clipboard: paste it with Ctrl+V.`
        : `Downloaded the draft for ${p.name}. Open the .eml file to review and send.`,
    })
    // Sending counts as a follow-up on every task in the email (one undo entry).
    void useTodoStore.getState().markFollowedUp(taskIds)
    focusNext()
  }

  const toggle = (id: number) => {
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addEmail = (id: number) => {
    setTicked((prev) => new Set(prev).add(id))
    setEmailEditorFor(id)
  }

  const closeEmailEditor = () => {
    setEmailEditorFor(null)
    requestAnimationFrame(() => panelRef.current?.focus())
  }

  const scopeEntries = useMemo<MenuEntry[]>(() => {
    const setScope = useSettingsStore.getState().setCheckinTaskScope
    const item = (s: CheckinTaskScope, label: string, hint: string): MenuEntry => ({
      kind: 'item',
      label,
      title: hint,
      radio: true,
      checked: checkinTaskScopeEqual(s, scope),
      note: tasksLabel(menuPeople.reduce((sum, p) => sum + countFor(p, s), 0)),
      onSelect: () => { void setScope(s) },
    })
    const entries: MenuEntry[] = [
      { kind: 'label', text: 'Quick picks' },
      ...CHECKIN_QUICK_SCOPES.map((q) => item(q.scope, q.label, q.hint)),
    ]
    if (listDefinitions.length > 0) {
      entries.push({ kind: 'label', text: 'Your saved lists' })
      for (const d of listDefinitions) {
        entries.push(item({ kind: 'list', listDefinitionId: d.id }, d.name, CHECKIN_LIST_SCOPE_HINT))
      }
    }
    return entries
  }, [scope, menuPeople, countFor, listDefinitions])

  const scopeLabel = scope.kind === 'list'
    ? listDefinitions.find((d) => d.id === scope.listDefinitionId)?.name ?? 'All open tasks'
    : CHECKIN_QUICK_SCOPES.find((q) => checkinTaskScopeEqual(q.scope, scope))?.label ?? 'All open tasks'

  const sendLabel = method === 'eml' ? 'Download .eml' : 'Copy & open'

  // Backdrop: a click that starts and ends on it closes (not a text drag out of the panel).
  const downOnBackdrop = useRef(false)

  return (
    <>
      <div
        className={styles.backdrop}
        onMouseDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget }}
        onClick={(e) => { if (downOnBackdrop.current && e.target === e.currentTarget) close() }}
      />
      <div
        ref={panelRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-checkin-dialog=""
        onKeyDown={onKeyDown}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>Email task check-ins</h2>
          <button type="button" className={styles.closeBtn} aria-label="Close" onClick={close}>×</button>
        </div>

        <div className={styles.body}>
          <section className={styles.group} aria-labelledby={`${titleId}-recipients`}>
            <div id={`${titleId}-recipients`} className={styles.groupLabel}>Recipients · open tasks assigned to each</div>
            {recipients.length === 0 && <div className={styles.empty}>Nobody has open tasks assigned.</div>}
            {recipients.map((p) => {
              const email = hasEmail(p)
              const checked = isChecked(p)
              const count = countFor(p, scope)
              const sentAs = sent.get(p.id)
              const inputId = `${titleId}-person-${p.id}`
              return (
                <div key={p.id} className={`${styles.row} ${email ? '' : styles.rowNoEmail}`} data-checkin-row={p.id}>
                  <input
                    id={inputId}
                    type="checkbox"
                    className={styles.checkbox}
                    checked={checked}
                    disabled={!email}
                    onChange={() => toggle(p.id)}
                  />
                  <span className={styles.avatar} style={{ background: p.color ?? NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                    {p.initials || p.name.slice(0, 2).toUpperCase()}
                  </span>
                  <label htmlFor={inputId} className={styles.who}>
                    <span className={styles.name}>{p.name}</span>
                    <span className={styles.email}>{email ? p.email : p.email ? 'Invalid email address' : 'No email address'}</span>
                  </label>
                  <span className={styles.count} data-checkin-count="">{tasksLabel(count)}</span>
                  {!email && (
                    <button type="button" className={styles.outlineBtn} aria-label={`${p.email ? 'Fix' : 'Add'} email for ${p.name}`} onClick={() => addEmail(p.id)}>
                      {p.email ? 'Fix email' : 'Add email'}
                    </button>
                  )}
                  {checked && (sentAs
                    ? <span className={styles.sent}>{sentAs === 'opened' ? 'Opened ✓' : 'Downloaded ✓'}</span>
                    : (
                      <button
                        type="button"
                        className={styles.sendBtn}
                        aria-label={`${sendLabel} for ${p.name}`}
                        data-checkin-send={p.id}
                        disabled={count === 0}
                        title={count === 0 ? 'No open tasks for this choice' : undefined}
                        onClick={() => { void send(p) }}
                      >
                        {sendLabel}
                      </button>
                    ))}
                </div>
              )
            })}
          </section>

          <div className={styles.options}>
            <div className={styles.group}>
              <div className={styles.groupLabel}>Include</div>
              <label className={styles.check}>
                <input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} />
                Task notes
              </label>
              <label className={styles.check}>
                <input type="checkbox" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} />
                Other people on the task
              </label>
              <div className={styles.scopeField}>
                <span id={`${titleId}-scope`} className={styles.scopeLabel}>Which tasks</span>
                <button
                  ref={scopeButtonRef}
                  type="button"
                  className={styles.scopeBtn}
                  aria-haspopup="menu"
                  aria-expanded={scopeMenuOpen}
                  aria-labelledby={`${titleId}-scope ${titleId}-scope-value`}
                  onClick={() => setScopeMenuOpen((o) => !o)}
                >
                  <span id={`${titleId}-scope-value`} className={styles.scopeValue}>{scopeLabel}</span>
                  <ChevronDownIcon />
                </button>
              </div>
            </div>
            <div className={styles.group} role="radiogroup" aria-label="How to open it">
              <div className={styles.groupLabel}>How to open it · saved in Settings</div>
              {CHECKIN_OPEN_METHOD_OPTIONS.map((o) => (
                <label key={o.method} className={styles.radio}>
                  <input
                    type="radio"
                    name={`${titleId}-method`}
                    value={o.method}
                    checked={method === o.method}
                    onChange={() => { void useSettingsStore.getState().setCheckinOpenMethod(o.method) }}
                  />
                  <span className={styles.radioText}>
                    {o.label}
                    <span className={styles.help}>{o.help}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className={styles.toastSlot} role="status" aria-live="polite">
          {toast && (
            <div className={`${styles.toast} ${toast.error ? styles.toastError : ''}`} data-checkin-toast="">
              <span className={styles.toastDot} aria-hidden="true" />
              <span>{toast.text}</span>
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <span className={styles.hint}>One message per person, opened one at a time.</span>
          <button type="button" className={styles.linkBtn} onClick={openImport}>Paste a reply…</button>
          <button type="button" className={styles.footerBtn} disabled={checkedPeople.length === 0} onClick={() => setPreviewOpen(true)}>
            Preview email
          </button>
          <button type="button" className={styles.footerBtn} data-checkin-done="" onClick={close}>Done</button>
        </div>
      </div>

      {scopeMenuOpen && (
        <MenuPopover
          anchorRef={scopeButtonRef}
          placement="bottom-start"
          width={340}
          label="Which tasks"
          entries={scopeEntries}
          onClose={() => setScopeMenuOpen(false)}
        />
      )}
      {emailEditorFor !== null && <PeopleEditor editPersonId={emailEditorFor} onClose={closeEmailEditor} />}
      {previewOpen && checkedPeople.length > 0 && (
        <CheckinPreview
          people={checkedPeople}
          build={buildPreview}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  )
}

const PREVIEW_SIZE = { width: 'min(760px, calc(100vw - 32px))', maxWidth: 'none' } as const

/** The email as a full HTML document for the preview frame: no scripts, nothing fetched. */
function previewDocument(html: string): string {
  return [
    '<!DOCTYPE html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    '<style>body{margin:0;padding:20px 24px;background:#ffffff;color:#242424}</style>',
    `</head><body>${html}</body></html>`,
  ].join('')
}

/**
 * "Preview email": a ticked person's email rendered in a sandboxed frame
 * (no scripts, its own origin), with a picker when several are ticked.
 */
function CheckinPreview({ people, build, onClose }: {
  people: PersistedPerson[]
  build: (p: PersistedPerson) => CheckinEmail
  onClose: () => void
}) {
  const [personId, setPersonId] = useState(people[0]?.id)
  const person = people.find((p) => p.id === personId) ?? people[0]
  const email = useMemo(() => (person ? build(person) : null), [person, build])
  const selectId = useId()
  if (!person || !email) return null
  return (
    <Dialog open onClose={onClose} title="Preview email" size="lg" className={styles.preview} style={PREVIEW_SIZE}>
      <div className={styles.previewMeta}>
        {people.length > 1 && (
          <label className={styles.previewPick} htmlFor={selectId}>
            For
            <select id={selectId} value={person.id} onChange={(e) => setPersonId(Number(e.target.value))}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
        )}
        <div><span className={styles.previewKey}>To</span> {person.name} &lt;{email.to}&gt;</div>
        <div><span className={styles.previewKey}>Subject</span> {email.subject}</div>
      </div>
      <iframe
        className={styles.previewFrame}
        title={`Check-in email for ${person.name}`}
        sandbox=""
        srcDoc={previewDocument(email.html)}
      />
      <div className={styles.previewActions}>
        <button type="button" className={styles.footerBtn} onClick={onClose}>Close</button>
      </div>
    </Dialog>
  )
}
