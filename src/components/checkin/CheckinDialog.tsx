import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { PersistedPerson } from '../../models'
import { listedLists } from '../../models/list-definition'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { useFilterSettings } from '../../hooks/use-filter-settings'
import { useToday } from '../../hooks/use-today'
import type { CheckinEmail } from '../../services/checkin-email/build'
import { checkinRecipients } from '../../services/checkin-email/recipients'
import { checkinTaskCount, selectCheckinTasks } from '../../services/checkin-email/select'
import {
  buildCheckinContext,
  CHECKIN_INCLUDE_DEFAULTS,
  checkinSentStatus,
  COPY_FAILED_NOTICE,
  prepareCheckin,
  sendPreparedCheckin,
} from '../../services/checkin-email/person-checkin'
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
  checkinScopeLabel,
  checkinTaskScopeEqual,
  resolveCheckinTaskScope,
  type CheckinTaskScope,
} from '../../utils/checkin-settings'
import { PeopleEditor } from '../settings/PeopleEditor'
import { Dialog, DialogFrame } from '../shared/Dialog'
import { ChevronDownIcon } from '../shared/icons'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import styles from './CheckinDialog.module.css'

type SentAs = 'opened' | 'downloaded'

interface Toast {
  text: string
  error?: boolean
  /** The reason the dialog opened instead of a one-click send: it describes the dialog until the next message. */
  opening?: true
}

const tasksLabel = (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`
/** Whether the person has an email a check-in can go to (one valid address). */
const hasEmail = (p: PersistedPerson) => isValidEmail(p.email ?? '')
/** A row's address line: the address, or what happens without one. */
const addressLine = (p: PersistedPerson) => {
  if (hasEmail(p)) return p.email
  return p.email
    ? 'Invalid email address — sent without a recipient'
    : 'No email address — add the recipient in your mail app'
}

/**
 * The email check-in dialog (`ui-store.checkinDialog`): one row per person
 * with open tasks (plus the people it was opened for), each sent on its own
 * with the row's button — one message per click, since the clipboard holds
 * one body at a time. Anyone can be ticked: without a valid address the
 * email goes without a recipient, added in the mail app. Sending puts the
 * body on the clipboard and opens a `mailto:` link, or downloads an `.eml`
 * draft (Settings' choice, also set here), then records a follow-up on the
 * email's tasks (one undo entry) — `services/checkin-email/person-checkin`,
 * shared with the one-click send, which opens this dialog with a `notice`
 * when it can't send.
 *
 * Mounted by the workspace page, which loads every task, their people and
 * tags, the statuses and the saved lists this reads.
 */
export function CheckinDialog() {
  const state = useUIStore((s) => s.checkinDialog)
  if (!state) return null
  return <CheckinDialogPanel openedFor={state.personIds} notice={state.notice} />
}

const noticeToast = (notice: string | undefined): Toast | null => (notice ? { text: notice, error: true, opening: true } : null)

function CheckinDialogPanel({ openedFor, notice }: { openedFor: number[]; notice?: string }) {
  // A new open request while open (another entry point): start afresh.
  const [opened, setOpened] = useState(openedFor)
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(openedFor))
  const [sent, setSent] = useState<ReadonlyMap<number, SentAs>>(() => new Map())
  const [toast, setToast] = useState<Toast | null>(() => noticeToast(notice))
  if (opened !== openedFor) {
    setOpened(openedFor)
    setTicked(new Set(openedFor))
    setSent(new Map())
    setToast(noticeToast(notice))
  }
  const [includeNotes, setIncludeNotes] = useState(CHECKIN_INCLUDE_DEFAULTS.includeNotes)
  const [includeOthers, setIncludeOthers] = useState(CHECKIN_INCLUDE_DEFAULTS.includeOthers)
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
  const scopeSetting = useSettingsStore((s) => s.checkinTaskScope)
  const method = useSettingsStore((s) => s.checkinOpenMethod)
  const filterSettings = useFilterSettings()
  const today = useToday()

  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const scopeButtonRef = useRef<HTMLButtonElement>(null)

  const recipients = useMemo(
    () => checkinRecipients(people, todos, assignedPeopleMap, opened),
    [people, todos, assignedPeopleMap, opened],
  )
  const buildCtx = useMemo(() => buildCheckinContext({
    todos, today, assignedPeopleMap, assignedTagsMap, statuses, listDefinitions, filterSettings,
  }), [todos, today, assignedPeopleMap, assignedTagsMap, statuses, listDefinitions, filterSettings])
  const scope = useMemo(
    () => resolveCheckinTaskScope(scopeSetting, listDefinitions.map((d) => d.id)),
    [scopeSetting, listDefinitions],
  )

  const countFor = useCallback(
    (p: PersistedPerson, s: CheckinTaskScope) => checkinTaskCount(selectCheckinTasks(p, s, buildCtx)),
    [buildCtx],
  )
  const isChecked = (p: PersistedPerson) => ticked.has(p.id)
  const checkedPeople = recipients.filter(isChecked)
  // The menu counts the people ticked; with nobody ticked, everyone listed.
  const menuPeople = checkedPeople.length > 0 ? checkedPeople : recipients

  const buildEmail = useCallback(
    (p: PersistedPerson, sentAt: Date) => prepareCheckin(p, scope, buildCtx, { includeNotes, includeOthers }, sentAt),
    [scope, buildCtx, includeNotes, includeOthers],
  )
  const buildPreview = useCallback((p: PersistedPerson) => buildEmail(p, new Date()).email, [buildEmail])

  // The people editor, the preview and the Which tasks menu own Esc while open.
  const layerOpenRef = useLatestRef(emailEditorFor !== null || previewOpen || scopeMenuOpen)
  const escapeBelongsElsewhere = useCallback(() => layerOpenRef.current, [layerOpenRef])


  /** After a send: the next row still to send, else Done. */
  const focusNext = () => {
    requestAnimationFrame(() => {
      const panel = panelRef.current
      const next = panel?.querySelector<HTMLElement>('[data-checkin-send]:not([disabled])')
        ?? panel?.querySelector<HTMLElement>('[data-checkin-done]')
      next?.focus()
    })
  }

  // People whose send is running: a second click meanwhile sends nothing.
  const sendingRef = useRef<Set<number>>(new Set())
  const send = async (p: PersistedPerson) => {
    if (sendingRef.current.has(p.id)) return
    const sentAt = new Date()
    const prepared = buildEmail(p, sentAt)
    if (prepared.taskIds.length === 0) return
    sendingRef.current.add(p.id)
    try {
      // First thing in the click: the clipboard needs the user gesture. A
      // successful send records the follow-up (one undo entry).
      const result = await sendPreparedCheckin(p, prepared, method, sentAt)
      if (result === 'copy-failed') {
        setToast({ text: COPY_FAILED_NOTICE, error: true })
        return
      }
      setSent((prev) => new Map(prev).set(p.id, result))
      setToast({ text: checkinSentStatus(p.name, prepared.email.to, result, sentAt) })
      focusNext()
    } finally {
      sendingRef.current.delete(p.id)
    }
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
    const lists = listedLists(listDefinitions)
    if (lists.length > 0) {
      entries.push({ kind: 'label', text: 'Your saved lists' })
      for (const d of lists) {
        entries.push(item({ kind: 'list', listDefinitionId: d.id }, d.name, CHECKIN_LIST_SCOPE_HINT))
      }
    }
    return entries
  }, [scope, menuPeople, countFor, listDefinitions])

  const scopeLabel = checkinScopeLabel(scope, listDefinitions)

  const sendLabel = method === 'eml' ? 'Download .eml' : 'Copy & open'

  return (
    <>
      <DialogFrame
        onClose={close}
        layer="overlay"
        initialFocus="panel"
        escapeBelongsElsewhere={escapeBelongsElsewhere}
        aria-labelledby={titleId}
        // The status line is already there when the dialog opens with the
        // reason a one-click send didn't go, so a live region wouldn't
        // announce it: it describes the dialog, read as the focus lands.
        aria-describedby={toast?.opening ? `${titleId}-toast` : undefined}
        className={styles.dialog}
        data={{ 'checkin-dialog': '' }}
        panelRef={panelRef}
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
              <div key={p.id} className={styles.row} data-checkin-row={p.id}>
                <input
                  id={inputId}
                  type="checkbox"
                  className={styles.checkbox}
                  checked={checked}
                  onChange={() => toggle(p.id)}
                />
                <span className={styles.avatar} style={{ background: p.color ?? NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                  {p.initials || p.name.slice(0, 2).toUpperCase()}
                </span>
                <label htmlFor={inputId} className={styles.who}>
                  <span className={styles.name}>{p.name}</span>
                  <span className={styles.email} title={addressLine(p)}>{addressLine(p)}</span>
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
            <span id={`${titleId}-toast`}>{toast.text}</span>
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
      </DialogFrame>

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
        <div>
          <span className={styles.previewKey}>To</span> {email.to === '' ? `${person.name} (no address)` : <>{person.name} &lt;{email.to}&gt;</>}
        </div>
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
