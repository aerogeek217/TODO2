/**
 * The one way a check-in is sent, shared by the check-in dialog and the
 * one-click send for a single person: build the person's email for a task
 * scope, hand it to the mail app (`sendCheckinEmail`), then record a
 * follow-up on the email's tasks as one undo entry named for the send
 * (`Check-in for Ann opened · 5 tasks followed up`).
 *
 * `sendPersonCheckin` is the one-click send: the saved Which tasks and How
 * to open it settings, the dialog's include defaults. When it can't send —
 * no open tasks in that scope, the clipboard refused — it opens the dialog
 * for that person instead, with the reason in its status line.
 */
import type { PersistedPerson } from '../../models'
import { startOfToday } from '../../utils/date'
import {
  checkinScopeLabel,
  resolveCheckinTaskScope,
  type CheckinOpenMethod,
  type CheckinTaskScope,
} from '../../utils/checkin-settings'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { usePersonStore } from '../../stores/person-store'
import { currentFilterSettings, useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { useTodoStore } from '../../stores/todo-store'
import { useUIStore } from '../../stores/ui-store'
import { useUndoStore } from '../../stores/undo-store'
import { buildCheckinEmail, type CheckinEmail } from './build'
import { createTaskRefLookup } from './ref'
import { selectCheckinTasks, type CheckinSelectContext } from './select'
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

/** Builds `person`'s check-in over the tasks `scope` picks. */
export function prepareCheckin(
  person: PersistedPerson,
  scope: CheckinTaskScope,
  ctx: CheckinBuildContext,
  include: CheckinIncludeOptions,
  sentAt: Date,
): PreparedCheckin {
  const sections = selectCheckinTasks(person, scope, ctx)
  const email = buildCheckinEmail(
    person,
    sections,
    { today: ctx.today, assignedPeopleMap: ctx.assignedPeopleMap, assignedTagsMap: ctx.assignedTagsMap, refOf: ctx.refOf },
    { ...include, sentAt },
  )
  return { email, taskIds: [...sections.overdue, ...sections.comingUp].map((t) => t.id) }
}

/** The build context as the stores hold it now (the workspace loads every task, person, tag, status and list). */
export function currentCheckinContext(): CheckinBuildContext {
  const todos = useTodoStore.getState().todos
  const { urgentRange, hotRule, weekStartsOn } = currentFilterSettings()
  return {
    todos,
    today: startOfToday(),
    assignedPeopleMap: usePersonStore.getState().assignedPeopleMap,
    assignedTagsMap: useTagStore.getState().assignedTagsMap,
    statuses: useStatusStore.getState().statuses,
    listDefinitions: useListDefinitionStore.getState().listDefinitions,
    markerSettings: { urgentRange, hotRule },
    weekStartsOn,
    refOf: createTaskRefLookup(todos.map((t) => t.uid)),
  }
}

/** `Check-in for Ann opened · 5 tasks followed up` (`downloaded` for an `.eml`). */
export function checkinSentMessage(personName: string, sentAs: 'opened' | 'downloaded', taskCount: number): string {
  return `Check-in for ${personName} ${sentAs} · ${taskCount} ${taskCount === 1 ? 'task' : 'tasks'} followed up`
}

/**
 * Hands `prepared` to the mail app (`sendCheckinEmail`) and, when that
 * worked, records a follow-up on its tasks: one undo entry with the undo
 * snackbar (`checkinSentMessage`). Call it straight from the click handler,
 * before any `await`: the clipboard write needs the click's user gesture.
 */
export async function sendPreparedCheckin(
  person: PersistedPerson,
  prepared: PreparedCheckin,
  method: CheckinOpenMethod,
  sentAt: Date,
): Promise<CheckinSendResult> {
  const result = await sendCheckinEmail({ email: prepared.email, personName: person.name, method, sentAt })
  if (result === 'opened' || result === 'downloaded') {
    const message = checkinSentMessage(person.name, result, prepared.taskIds.length)
    // Sending counts as a follow-up on every task in the email.
    useTodoStore.getState().markFollowedUp(prepared.taskIds, message).catch(() => {
      useUndoStore.getState().notify(`Check-in for ${person.name} ${result}, but the follow-up couldn’t be recorded.`)
    })
  }
  return result
}

/** Why the check-in dialog opened instead: the person has no open tasks in the saved scope. */
export function noTasksNotice(personName: string, scopeLabel: string): string {
  return `${personName} has no open tasks in “${scopeLabel}”, so nothing was sent. Choose other tasks under Which tasks.`
}

/** The clipboard refused the body (the dialog's own wording for the same failure). */
export const COPY_FAILED_NOTICE = 'Couldn’t copy the email to the clipboard, so nothing was opened. Try again.'

/** What the one-click send did: sent, or opened the dialog instead (and why). */
export type PersonCheckinOutcome = 'opened' | 'downloaded' | 'dialog'

/**
 * Emails `personId` their check-in at once: the saved Which tasks and How to
 * open it, the Include defaults, the follow-up recorded (one undo entry, the
 * snackbar says it). Opens the check-in dialog for the person instead —
 * with the reason in its status line — when they have no open tasks in that
 * scope or the clipboard refuses. Call it straight from the click (or key)
 * handler: the clipboard write starts before the first `await`.
 */
export async function sendPersonCheckin(personId: number): Promise<PersonCheckinOutcome> {
  const openDialog = (notice?: string): PersonCheckinOutcome => {
    useUIStore.getState().openCheckinDialog([personId], notice)
    return 'dialog'
  }
  const stored = usePersonStore.getState().people.find((p) => p.id === personId)
  if (stored?.id == null) return openDialog()
  const person: PersistedPerson = { ...stored, id: stored.id }
  const settings = useSettingsStore.getState()
  const ctx = currentCheckinContext()
  const scope = resolveCheckinTaskScope(settings.checkinTaskScope, ctx.listDefinitions.map((d) => d.id))
  const sentAt = new Date()
  const prepared = prepareCheckin(person, scope, ctx, CHECKIN_INCLUDE_DEFAULTS, sentAt)
  if (prepared.taskIds.length === 0) return openDialog(noTasksNotice(person.name, checkinScopeLabel(scope, ctx.listDefinitions)))
  const result = await sendPreparedCheckin(person, prepared, settings.checkinOpenMethod, sentAt)
  if (result === 'opened' || result === 'downloaded') return result
  return openDialog(result === 'copy-failed' ? COPY_FAILED_NOTICE : invalidAddressNotice(person.name))
}

/** A stored address that is neither empty nor one valid address (the builders refuse it). */
export function invalidAddressNotice(personName: string): string {
  return `${personName}’s email address isn’t valid, so nothing was sent. Fix it in People.`
}
