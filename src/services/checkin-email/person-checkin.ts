/**
 * A person's check-in, the one way it is made: the check-in dialog builds the
 * person's message for the check-in filter (`prepareCheckin`) and copies it
 * (`copyCheckinMessage`, `copyCheckinSubject`). Copying records nothing — no
 * follow-up, no undo entry: a check-in round records its follow-up when the
 * reply is pasted back (the reply import's Record a follow-up).
 */
import type { PersistedPerson, PersistedTodoItem, Person, Status, StatusUpdate, Subtask, Tag } from '../../models'
import type { CheckinTaskFilter } from '../../utils/checkin-settings'
import type { FilterSettings } from '../../utils/filter-match'
import { writeRichClipboard } from '../rich-clipboard'
import { buildCheckinEmail, type CheckinEmail } from './build'
import { createTaskRefLookup } from './ref'
import { selectCheckinTasks, type CheckinSelectContext } from './select'

/** What the email includes besides the tasks (the dialog's Include boxes). */
export interface CheckinIncludeOptions {
  /** Each task's Notes row. */
  includeNotes: boolean
  /** The task's other assignees. */
  includeOthers: boolean
}

/** The dialog's Include defaults. */
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
    {
      today: ctx.today, assignedPeopleMap: ctx.assignedPeopleMap, assignedTagsMap: ctx.assignedTagsMap,
      refOf: ctx.refOf, statusUpdatesByTodo: ctx.statusUpdatesByTodo, subtasksByTodo: ctx.subtasksByTodo,
    },
    { ...include, sentAt },
  )
  return { email, taskIds: [...sections.overdue, ...sections.comingUp].map((t) => t.id) }
}

/** What a check-in's build context is made of: the data, plus the filter settings (urgent range, week start). */
export interface CheckinContextSources {
  todos: readonly PersistedTodoItem[]
  today: Date
  assignedPeopleMap: ReadonlyMap<number, readonly Person[]>
  assignedTagsMap: ReadonlyMap<number, readonly Tag[]>
  statuses: readonly Status[]
  /** Each task's status updates (the filter's text search reads them). */
  statusUpdatesByTodo: ReadonlyMap<number, readonly StatusUpdate[]>
  /** Each task's checklist (the filter's text search reads it; the email lists the open ones). */
  subtasksByTodo: ReadonlyMap<number, readonly Subtask[]>
  filterSettings: FilterSettings
}

/** The build context, the one way (the check-in dialog builds it from its hooks). */
export function buildCheckinContext({ todos, filterSettings, ...data }: CheckinContextSources): CheckinBuildContext {
  const { urgentRange, weekStartsOn } = filterSettings
  return {
    ...data,
    todos,
    markerSettings: { urgentRange },
    weekStartsOn,
    refOf: createTaskRefLookup(todos.map((t) => t.uid)),
  }
}

/**
 * Puts `email`'s message on the clipboard: rich HTML (the email-safe body,
 * as it pastes into a mail app) and plain text together, falling back to
 * plain text. Call it from the click handler: the clipboard needs the user
 * gesture. True on success. Records nothing.
 */
export function copyCheckinMessage(email: CheckinEmail): Promise<boolean> {
  return writeRichClipboard(email.html, email.plain)
}

/** Puts `email`'s subject on the clipboard as plain text. True on success. */
export async function copyCheckinSubject(email: CheckinEmail): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(email.subject)
    return true
  } catch {
    return false
  }
}

/** The status line after a copy. */
export function checkinCopiedStatus(personName: string): string {
  return `Copied the check-in for ${personName}. Paste it into your message.`
}

/** The status line after a copied subject. */
export function checkinSubjectCopiedStatus(personName: string): string {
  return `Copied the subject for ${personName}.`
}

/** The clipboard refused. */
export const COPY_FAILED_NOTICE = 'Couldn’t copy to the clipboard. Try again.'
