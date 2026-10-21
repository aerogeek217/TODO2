import type { NewTodoItem, Person, RecurrenceType, Status, Tag, TodoChanges, TodoItem } from '../models'
import type { FilterDefaults } from '../utils/filter-defaults'
import { mentionToken, parseInput } from './natural-language-parser'
import { matchTag, resolveInput, type ResolvedInput } from './nlp-resolver'
import { makeRecurrenceRule } from '../utils/recurrence'

/**
 * A task that doesn't exist yet — the one shape every way of creating a task
 * goes through (Quick Add, the task editor, a note's lines), so they share
 * one rule set: these builders say what the new task gets, `draftToTodo`
 * turns it into the stored row, `services/note-tasks` stores it (one undo
 * step). A note's drafts are also shown in the convert preview and edited in
 * the task editor's draft mode. People and tags named with `@` / `#` that
 * don't exist yet are kept by name and created with the task.
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
  /** `undefined` = the Settings default (none while new tasks get no follow-up); `null` = no next follow-up. */
  nextFollowupAt?: Date | null
  /** Only the task editor's create mode sets it. */
  lastFollowupAt?: Date
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
  /** Settings' default status. */
  defaultStatusId?: number | null
  /**
   * Which default wins when the text names no status: `settings` (the
   * default — a note's lines, the editor) or `filter` (Quick Add, where a
   * filter on one status has always set it, over Settings' default).
   */
  statusDefaultFirst?: 'settings' | 'filter'
  today?: Date
}

/** A new task's status: a typed `/status`, else the two defaults in `first` order. */
export function newTaskStatus(
  typed: number | undefined,
  defaults: { settings: number | null | undefined; filter: number | null | undefined },
  first: 'settings' | 'filter' = 'settings',
): number | undefined {
  if (typed !== undefined) return typed
  const [a, b] = first === 'settings' ? [defaults.settings, defaults.filter] : [defaults.filter, defaults.settings]
  return a ?? b ?? undefined
}

function union(a: readonly number[], b: readonly number[]): number[] {
  return [...new Set([...a, ...b])]
}

/**
 * `ids` that name an existing row: a default or pick naming a status /
 * person / tag deleted since (a list's or pane's filter still names it, a
 * crafted file) is left out, so a new task never points at nothing.
 */
function existing(ids: readonly number[], rows: readonly { id?: number }[]): number[] {
  return ids.filter((id) => rows.some((r) => r.id === id))
}

/** `id` when it names an existing row, else `undefined` (see {@link existing}). */
function existingId(id: number | null | undefined, rows: readonly { id?: number }[]): number | undefined {
  return id != null && rows.some((r) => r.id === id) ? id : undefined
}

/**
 * Splits `#tag` names into existing tag ids and names still to create: a
 * name resolves as the `#` popup ranks it (`matchTag` — the exact tag, else
 * the first whose name starts with it), and is created only when no tag does.
 */
function splitTags(names: readonly string[], tags: readonly Tag[]): { ids: number[]; missing: string[] } {
  const ids: number[] = []
  const missing: string[] = []
  const stored = tags.filter((t) => t.id !== undefined)
  for (const name of names) {
    const lower = name.trim().toLowerCase()
    if (!lower) continue
    const match = matchTag(lower, stored)
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
 * into a draft with the new-task defaults (`draftFromResolved`).
 */
export function draftFromText(text: string, ctx: DraftContext): TaskDraft {
  const resolved = resolveInput(parseInput(text, ctx.today), [...ctx.people], [...ctx.statuses])
  return draftFromResolved(resolved, text.trim(), ctx)
}

/**
 * Parsed task text into a draft, plus the defaults of where the task is
 * added: the filter's people when the text names nobody, its tags and
 * markers, and a status (typed `/status`, else Settings' default and the
 * filter's, in `ctx.statusDefaultFirst` order). `fallbackTitle` is the
 * title when the text is all tokens. Defaults naming a status / person / tag
 * that no longer exists are left out.
 */
export function draftFromResolved(resolved: ResolvedInput, fallbackTitle: string, ctx: DraftContext): TaskDraft {
  const fd = ctx.defaults ?? null
  const tags = splitTags(resolved.tags, ctx.tags)
  const namesSomeone = resolved.personIds.length > 0 || resolved.unmatchedPersons.length > 0
  return {
    title: resolved.title || fallbackTitle,
    ...(resolved.dueDate ? { dueDate: resolved.dueDate } : {}),
    ...(resolved.recurrence ? { recurrence: resolved.recurrence } : {}),
    ...withStatus(newTaskStatus(
      resolved.statusId,
      { settings: existingId(ctx.defaultStatusId, ctx.statuses), filter: existingId(fd?.statusId, ctx.statuses) },
      ctx.statusDefaultFirst,
    )),
    urgent: resolved.urgent === true || fd?.markers?.urgent === true,
    important: resolved.important === true || fd?.markers?.important === true,
    focus: resolved.focus === true || fd?.markers?.focus === true,
    ...(resolved.followupNone ? { nextFollowupAt: null } : resolved.nextFollowupAt ? { nextFollowupAt: resolved.nextFollowupAt } : {}),
    personIds: namesSomeone ? resolved.personIds : existing(fd?.personIds ?? [], ctx.people),
    newPeople: resolved.unmatchedPersons,
    tagIds: union(tags.ids, existing(fd?.tagIds ?? [], ctx.tags)),
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
 * `nextFollowupAt` only once it differs from the default. A status / person
 * / tag that no longer exists (seeded from a filter naming it) is left out.
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
    ...withStatus(resolved.statusId ?? existingId(partial.statusId, ctx.statuses)),
    urgent: partial.urgent === true || resolved.urgent === true,
    important: partial.important === true || resolved.important === true,
    focus: partial.focus === true || resolved.focus === true,
    ...(nextFollowupAt !== undefined ? { nextFollowupAt } : {}),
    personIds: union(existing(assignments.personIds, ctx.people), resolved.personIds),
    newPeople: resolved.unmatchedPersons,
    tagIds: union(existing(assignments.tagIds, ctx.tags), tags.ids),
    newTags: tags.missing,
    ...(partial.lastFollowupAt ? { lastFollowupAt: partial.lastFollowupAt } : {}),
    ...(partial.notes ? { notes: partial.notes } : {}),
    ...(partial.progress ? { progress: partial.progress } : {}),
  }
}

/**
 * The title the task editor shows for a draft: the title, then the people
 * and tags still to create as `@` / `#` tokens (they're created with the
 * task; deleting the token drops them).
 */
export function draftEditorTitle(draft: TaskDraft): string {
  return [draft.title, ...draft.newPeople.map(mentionToken), ...draft.newTags.map((t) => `#${t}`)].join(' ')
}

/**
 * The stored row for a draft (no `sortOrder` yet — the store places new
 * tasks last). Without a choice the next follow-up is `defaultFollowup`
 * (`undefined` = none: new tasks get no follow-up); a repeat is kept only
 * with a due date.
 */
export function draftToTodo(draft: TaskDraft, now: Date, defaultFollowup: Date | undefined): Omit<NewTodoItem, 'sortOrder'> {
  const nextFollowupAt = draft.nextFollowupAt === undefined ? defaultFollowup : draft.nextFollowupAt
  return {
    title: draft.title,
    isCompleted: false,
    createdAt: now,
    modifiedAt: now,
    ...(nextFollowupAt ? { nextFollowupAt } : {}),
    ...draftFields(draft),
  }
}

/**
 * The fields a draft sets on a new task, other than its title and next
 * follow-up: a repeat only with a due date (it repeats from it), only true
 * markers, only set values.
 */
function draftFields(draft: TaskDraft): Omit<TodoChanges, 'nextFollowupAt' | 'title'> {
  return {
    ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
    ...(draft.dueDate && draft.recurrence ? { recurrenceRule: makeRecurrenceRule(draft.recurrence, draft.dueDate) } : {}),
    ...withStatus(draft.statusId),
    ...(draft.urgent ? { urgent: true as const } : {}),
    ...(draft.important ? { important: true as const } : {}),
    ...(draft.focus ? { focus: true as const } : {}),
    ...(draft.lastFollowupAt ? { lastFollowupAt: draft.lastFollowupAt } : {}),
    ...(draft.notes ? { notes: draft.notes } : {}),
    ...(draft.progress ? { progress: draft.progress } : {}),
  }
}
