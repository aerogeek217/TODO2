/**
 * The one way a check-in is sent, shared by the check-in dialog and the
 * one-click send for a single person: build the person's email for the
 * check-in filter, hand it to the mail app (`sendCheckinEmail`), then record a
 * follow-up on the email's tasks as one undo entry named for the send
 * (`Check-in for Ann opened · 5 tasks followed up`).
 *
 * `sendPersonCheckin` is the one-click send: the saved check-in filter and
 * How to open it settings, the dialog's include defaults. When it can't send
 * — no open tasks match the filter, the clipboard refused, the tasks' people
 * or tags not loaded yet — it opens the dialog for that person instead, with
 * the reason in its status line.
 */
import type { PersistedPerson, PersistedTodoItem, Person, Status, Tag } from '../../models'
import { startOfToday } from '../../utils/date'
import { isNoCheckinFilter, type CheckinOpenMethod, type CheckinTaskFilter } from '../../utils/checkin-settings'
import type { FilterSettings } from '../../utils/filter-match'
import { registerModuleReset } from '../../utils/module-reset'
import { usePersonStore } from '../../stores/person-store'
import { currentFilterSettings, useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { buildCheckinEmail, type CheckinEmail } from './build'
import { checkinEmlFileName } from './handoff'
import { createTaskRefLookup } from './ref'
import { checkinTaskCounts, selectCheckinTasks, type CheckinSelectContext } from './select'
import { sendCheckinEmail, type CheckinSendResult } from './send'

/** What the email includes besides the tasks (the dialog's Include boxes). */
export interface CheckinIncludeOptions {
  /** Each task's Notes row. */
  includeNotes: boolean
  /** The task's other assignees. */
  includeOthers: boolean
}

/** The dialog's Include defaults; the one-click send uses them too. */
export const CHECKIN_INCLUDE_DEFAULTS: CheckinIncludeOptions = { includeNotes: true, includeOthers: true }

/** What building a person's check-in needs: the task selection's context plus the refs. */
export interface CheckinBuildContext extends CheckinSelectContext {
  /** The ref printed per task uid (`createTaskRefLookup` over every task's uid). */
  refOf: (uid: string) => string
}

/** A person's check-in, built: the email and the ids of the tasks it covers. */
export interface PreparedCheckin {
  email: CheckinEmail
  taskIds: number[]
}

/** Builds `person`'s check-in over the tasks `filter` picks. */
export function prepareCheckin(
  person: PersistedPerson,
  filter: CheckinTaskFilter,
  ctx: CheckinBuildContext,
  include: CheckinIncludeOptions,
  sentAt: Date,
): PreparedCheckin {
  const sections = selectCheckinTasks(person, filter, ctx)
  const email = buildCheckinEmail(
    person,
    sections,
    { today: ctx.today, assignedPeopleMap: ctx.assignedPeopleMap, assignedTagsMap: ctx.assignedTagsMap, refOf: ctx.refOf },
    { ...include, sentAt },
  )
  return { email, taskIds: [...sections.overdue, ...sections.comingUp].map((t) => t.id) }
}

/** What a check-in's build context is made of: the data, plus the filter settings (urgent range, Hot rule, week start). */
export interface CheckinContextSources {
  todos: readonly PersistedTodoItem[]
  today: Date
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  assignedTagsMap: ReadonlyMap<number, readonly Tag[]>
  statuses: readonly Status[]
  filterSettings: FilterSettings
}

/** The build context, the one way: the check-in dialog (from its hooks) and the one-click send (from the stores). */
export function buildCheckinContext({ todos, filterSettings, ...data }: CheckinContextSources): CheckinBuildContext {
  const { urgentRange, hotRule, weekStartsOn } = filterSettings
  return {
    ...data,
    todos,
    markerSettings: { urgentRange, hotRule },
    weekStartsOn,
    refOf: createTaskRefLookup(todos.map((t) => t.uid)),
  }
}

/** A check-in's data as the stores hold it now (the workspace loads every task, person, tag and status). */
function currentCheckinSources(): CheckinContextSources {
  return {
    todos: useTodoStore.getState().todos,
    today: startOfToday(),
    assignedPeopleMap: usePersonStore.getState().assignedPeopleMap,
    assignedTagsMap: useTagStore.getState().assignedTagsMap,
    statuses: useStatusStore.getState().statuses,
    filterSettings: currentFilterSettings(),
  }
}

/** The build context as the stores hold it now. */
export function currentCheckinContext(): CheckinBuildContext {
  return buildCheckinContext(currentCheckinSources())
}

/**
 * Per person id, how many open tasks the check-in filter (default: the saved
 * one) picks over the stores' tasks — what a one-click send would email;
 * `null` while there is no filter (every open task).
 */
export function currentCheckinTaskCounts(
  filter: CheckinTaskFilter = useSettingsStore.getState().checkinTaskFilter,
): Map<number, number> | null {
  if (isNoCheckinFilter(filter)) return null
  const { filterSettings: { urgentRange, hotRule, weekStartsOn }, ...data } = currentCheckinSources()
  return checkinTaskCounts(filter, { ...data, markerSettings: { urgentRange, hotRule }, weekStartsOn })
}

/** `Check-in for Ann opened · 5 tasks followed up` (`downloaded` for an `.eml`). */
export function checkinSentMessage(personName: string, sentAs: 'opened' | 'downloaded', taskCount: number): string {
  return `Check-in for ${personName} ${sentAs} · ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} followed up`
}

/**
 * Where a sent check-in went and how to finish it — the check-in dialog's
 * status line and the one-click send's snackbar say the same: the
 * recipient with the address it went to (`Ann <ann@example.com>`), what to
 * do next (paste the body; open the draft), and — without an address — to
 * add the recipient in the mail app.
 */
export function checkinSentStatus(personName: string, to: string, sentAs: 'opened' | 'downloaded', sentAt: Date): string {
  const recipient = to === '' ? personName : `${personName} <${to}>`
  const noAddress = to === '' ? ' Add the recipient in your mail app.' : ''
  return sentAs === 'opened'
    ? `Opened a message to ${recipient}. The body is on your clipboard: paste it with Ctrl+V.${noAddress}`
    : `Downloaded the draft for ${recipient} (${checkinEmlFileName(personName, sentAt)}) — open it from your Downloads folder to review and send.${noAddress}`
}

/**
 * Hands `prepared` to the mail app (`sendCheckinEmail`) and, when that
 * worked, records a follow-up on its tasks: one undo entry with the undo
 * snackbar (`checkinSentMessage`; with `statusInSnackbar`, `checkinSentStatus`
 * as its second line). Call it straight from the click handler, before any
 * `await`: the clipboard write needs the click's user gesture.
 */
export async function sendPreparedCheckin(
  person: PersistedPerson,
  prepared: PreparedCheckin,
  method: CheckinOpenMethod,
  sentAt: Date,
  { statusInSnackbar = false }: { statusInSnackbar?: boolean } = {},
): Promise<CheckinSendResult> {
  const result = await sendCheckinEmail({ email: prepared.email, personName: person.name, method, sentAt })
  if (result === 'opened' || result === 'downloaded') {
    const message = checkinSentMessage(person.name, result, prepared.taskIds.length)
    const detail = statusInSnackbar ? checkinSentStatus(person.name, prepared.email.to, result, sentAt) : undefined
    // Sending counts as a follow-up on every task in the email.
    useTodoStore.getState().markFollowedUp(prepared.taskIds, { description: message, detail }).catch(() => {
      useUndoStore.getState().notify(`Check-in for ${person.name} ${result}, but the follow-up couldn’t be recorded.`)
    })
  }
  return result
}

/** Why the check-in dialog opened instead: the person has no open tasks (`filtered`: none that match the saved check-in filter). */
export function noTasksNotice(personName: string, filtered: boolean): string {
  return filtered
    ? `${personName} has no open tasks that match the check-in filter, so nothing was sent. Change the filter under Which tasks.`
    : `${personName} has no open tasks, so nothing was sent.`
}

/** The clipboard refused the body (the dialog's own wording for the same failure). */
export const COPY_FAILED_NOTICE = 'Couldn’t copy the email to the clipboard, so nothing was opened. Try again.'

/** The open tasks' people (or, for a filter on tags, their tags) aren't all loaded, so the email could pick the wrong tasks. */
export const ASSIGNMENTS_LOADING_NOTICE = 'Not every task’s people and tags have loaded yet, so nothing was sent. Check the tasks here, then send.'

/**
 * Whether every open task's people — and, for a filter on tags or text
 * (an "is not" tag clause lets a task with no entry through; Text contains
 * matches tag names too), its tags — are loaded, so selecting the person's
 * tasks reads complete data.
 */
function assignmentsLoaded(ctx: CheckinBuildContext, filter: CheckinTaskFilter): boolean {
  const tagsNeeded = filter.tags != null || filter.searchText.trim() !== ''
  return ctx.todos.every((t) => t.isCompleted
    || (ctx.assignedPeopleMap.has(t.id) && (!tagsNeeded || ctx.assignedTagsMap?.has(t.id) === true)))
}

/** What the one-click send did: sent, opened the dialog instead (and why), or nothing — a send for the person is already running. */
export type PersonCheckinOutcome = 'opened' | 'downloaded' | 'dialog' | 'busy'

/** People whose one-click send is running (another click meanwhile does nothing). */
const sending = new Set<number>()
registerModuleReset(() => sending.clear())

/**
 * Emails `personId` their check-in at once: the saved check-in filter and How to
 * open it, the Include defaults, the follow-up recorded (one undo entry; the
 * snackbar says it, with where it went and how to finish —
 * `checkinSentStatus`). Opens the check-in dialog for the person instead —
 * with the reason in its status line — when none of their open tasks match
 * the filter, the clipboard refuses, or the tasks' people / tags aren't loaded
 * yet. Call it straight from the click (or key) handler: the clipboard
 * write starts before the first `await`.
 */
export async function sendPersonCheckin(personId: number): Promise<PersonCheckinOutcome> {
  if (sending.has(personId)) return 'busy'
  const openDialog = (notice?: string): PersonCheckinOutcome => {
    useUIStore.getState().openCheckinDialog([personId], notice)
    return 'dialog'
  }
  const stored = usePersonStore.getState().people.find((p) => p.id === personId)
  if (stored?.id == null) return openDialog()
  const person: PersistedPerson = { ...stored, id: stored.id }
  const settings = useSettingsStore.getState()
  const ctx = currentCheckinContext()
  const filter = settings.checkinTaskFilter
  if (!assignmentsLoaded(ctx, filter)) return openDialog(ASSIGNMENTS_LOADING_NOTICE)
  const sentAt = new Date()
  const prepared = prepareCheckin(person, filter, ctx, CHECKIN_INCLUDE_DEFAULTS, sentAt)
  if (prepared.taskIds.length === 0) return openDialog(noTasksNotice(person.name, !isNoCheckinFilter(filter)))
  sending.add(personId)
  try {
    const result = await sendPreparedCheckin(person, prepared, settings.checkinOpenMethod, sentAt, { statusInSnackbar: true })
    return result === 'copy-failed' ? openDialog(COPY_FAILED_NOTICE) : result
  } finally {
    sending.delete(personId)
  }
}
