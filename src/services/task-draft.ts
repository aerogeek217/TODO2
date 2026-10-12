import type { NewTodoItem, Person, RecurrenceType, Status, Tag, TodoItem } from '../models'
import type { FilterDefaults } from '../utils/filter-defaults'
import { parseInput } from './natural-language-parser'
import { resolveInput } from './nlp-resolver'
import { makeRecurrenceRule } from './recurrence'

/**
 * A task that doesn't exist yet: what a note line parses into, shown in the
 * convert preview and edited in the task editor's draft mode. Nothing is
 * stored until the drafts are created (`services/note-tasks`). People and
 * tags named with `@` / `#` that don't exist yet are kept by name and
 * created with the tasks.
 */
export interface TaskDraft {
  /** The title, every recognised token removed. */
  title: string
  dueDate?: Date
  /** Applied only with a due date to anchor on. */
  recurrence?: RecurrenceType
  statusId?: number
  urgent: boolean
  important: boolean
  focus: boolean
  /** `undefined` = the Settings default; `null` = no next follow-up. */
  nextFollowupAt?: Date | null
  personIds: number[]
  /** `@name`s that match nobody: created with the task. */
  newPeople: string[]
  tagIds: number[]
  /** `#tag`s that match no tag: created with the task. */
  newTags: string[]
  notes?: string
  progress?: string
}

export interface DraftContext {
  people: readonly Person[]
  statuses: readonly Status[]
  tags: readonly Tag[]
  /** The screen filter's (or a list's) defaults for new tasks. */
  defaults?: FilterDefaults | null
  /** Settings' default status — wins over a filter's status. */
  defaultStatusId?: number | null
  today?: Date
}

function union(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])]
}

/** Splits `#tag` names into existing tag ids and names still to create (case-insensitive). */
function splitTags(names: readonly string[], tags: readonly Tag[]): { ids: number[]; missing: string[] } {
  const ids: number[] = []
  const missing: string[] = []
  for (const name of names) {
    const lower = name.trim().toLowerCase()
    if (!lower) continue
    const match = tags.find((t) => t.id !== undefined && t.name.trim().toLowerCase() === lower)
    if (match?.id !== undefined) {
      if (!ids.includes(match.id)) ids.push(match.id)
    } else if (!missing.some((m) => m.toLowerCase() === lower)) {
      missing.push(name.trim())
    }
  }
  return { ids, missing }
}

/**
 * Parses task text (Quick Add's grammar: `@person`, `#tag`, slash commands)
 * into a draft, then adds the new-task defaults the task editor's create
 * mode would: the filter's people when the text names nobody, its tags and
 * markers, and a status (typed `/status`, else Settings' default, else the
 * filter's).
 */
export function draftFromText(text: string, ctx: DraftContext): TaskDraft {
  const parsed = parseInput(text, ctx.today)
  const resolved = resolveInput(parsed, [...ctx.people], [...ctx.statuses])
  const fd = ctx.defaults ?? null
  const tags = splitTags(resolved.tags, ctx.tags)
  const namesSomeone = resolved.personIds.length > 0 || resolved.unmatchedPersons.length > 0
  return {
    title: resolved.title || text.trim(),
    ...(resolved.dueDate ? { dueDate: resolved.dueDate } : {}),
    ...(resolved.recurrence ? { recurrence: resolved.recurrence } : {}),
    ...withStatus(resolved.statusId ?? ctx.defaultStatusId ?? fd?.statusId ?? undefined),
    urgent: resolved.urgent === true || fd?.markers?.urgent === true,
    important: resolved.important === true || fd?.markers?.important === true,
    focus: resolved.focus === true || fd?.markers?.focus === true,
    ...(resolved.followupNone ? { nextFollowupAt: null } : resolved.nextFollowupAt ? { nextFollowupAt: resolved.nextFollowupAt } : {}),
    personIds: namesSomeone ? resolved.personIds : [...(fd?.personIds ?? [])],
    newPeople: resolved.unmatchedPersons,
    tagIds: union(tags.ids, fd?.tagIds ?? []),
    newTags: tags.missing,
  }
}

function withStatus(statusId: number | undefined): { statusId?: number } {
  return statusId !== undefined ? { statusId } : {}
}

/**
 * The draft the task editor's draft / create mode hands back: its fields
 * and picked people / tags, plus anything typed into the title (commands,
 * `@` / `#`), which is parsed again as on create. The editor passes
 * `nextFollowupAt` only once it differs from the default.
 */
export function draftFromEditor(
  partial: Partial<TodoItem>,
  assignments: { personIds: readonly number[]; tagIds: readonly number[] },
  ctx: Pick<DraftContext, 'people' | 'statuses' | 'tags' | 'today'>,
): TaskDraft {
  const rawTitle = (partial.title ?? '').trim()
  const resolved = resolveInput(parseInput(rawTitle, ctx.today), [...ctx.people], [...ctx.statuses])
  const tags = splitTags(resolved.tags, ctx.tags)
  const nextFollowupAt = 'nextFollowupAt' in partial
    ? (partial.nextFollowupAt ?? null)
    : resolved.followupNone ? null : resolved.nextFollowupAt
  const dueDate = partial.dueDate ?? resolved.dueDate
  const recurrence = partial.recurrenceRule?.type ?? resolved.recurrence
  return {
    title: resolved.title || rawTitle,
    ...(dueDate ? { dueDate } : {}),
    ...(recurrence ? { recurrence } : {}),
    ...withStatus(resolved.statusId ?? partial.statusId),
    urgent: partial.urgent === true || resolved.urgent === true,
    important: partial.important === true || resolved.important === true,
    focus: partial.focus === true || resolved.focus === true,
    ...(nextFollowupAt !== undefined ? { nextFollowupAt } : {}),
    personIds: union(assignments.personIds, resolved.personIds),
    newPeople: resolved.unmatchedPersons,
    tagIds: union(assignments.tagIds, tags.ids),
    newTags: tags.missing,
    ...(partial.notes ? { notes: partial.notes } : {}),
    ...(partial.progress ? { progress: partial.progress } : {}),
  }
}

/** `@Name` / `@"First Last"` — the token that names a person. */
function personToken(name: string): string {
  return /^\w+$/.test(name) ? `@${name}` : `@"${name}"`
}

/**
 * The title the task editor shows for a draft: the title, then the people
 * and tags still to create as `@` / `#` tokens (they're created with the
 * task; deleting the token drops them).
 */
export function draftEditorTitle(draft: TaskDraft): string {
  return [draft.title, ...draft.newPeople.map(personToken), ...draft.newTags.map((t) => `#${t}`)].join(' ')
}

/**
 * The stored row for a draft (no `sortOrder` yet — the store places new
 * tasks last). Without a choice the next follow-up is `defaultFollowup`;
 * a repeat is kept only with a due date.
 */
export function draftToTodo(draft: TaskDraft, now: Date, defaultFollowup: Date): Omit<NewTodoItem, 'sortOrder'> {
  const nextFollowupAt = draft.nextFollowupAt === undefined ? defaultFollowup : draft.nextFollowupAt
  return {
    title: draft.title,
    isCompleted: false,
    createdAt: now,
    modifiedAt: now,
    ...(nextFollowupAt ? { nextFollowupAt } : {}),
    ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    ...(draft.dueDate && draft.recurrence ? { recurrenceRule: makeRecurrenceRule(draft.recurrence, draft.dueDate) } : {}),
    ...withStatus(draft.statusId),
    ...(draft.urgent ? { urgent: true } : {}),
    ...(draft.important ? { important: true } : {}),
    ...(draft.focus ? { focus: true } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    ...(draft.progress ? { progress: draft.progress } : {}),
  }
}
