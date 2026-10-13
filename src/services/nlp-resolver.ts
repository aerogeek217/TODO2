import type { Person, RecurrenceType, Status, Tag } from '../models'
import { removeSpans, type CommandProblem, type ParsedInput } from './natural-language-parser'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { TagLimitError } from '../stores/tag-store'

export interface ResolvedInput {
  /** The task title: the text without its recognised tokens. An unknown
   * `/status` name stays in it, like any other unreadable command. */
  title: string
  /** The text without its command tokens (`@` / `#` kept) — the editor's
   * title after a Quick Add → Details handoff, whose fields carry the
   * commands. Absent when nothing was parsed. */
  textWithoutCommands?: string
  dueDate?: Date
  recurrence?: RecurrenceType
  personIds: number[]
  /** Person names that didn't match any existing person — created on submit
   * (`resolveUnmatchedPeople`). */
  unmatchedPersons: string[]
  /** Normalized tag slugs from `#foo` tokens (pass-through from `ParsedInput`). */
  tags: string[]
  /** Resolved status ID from `/status <name>` */
  statusId?: number
  /** The `/status` name when it matched no status (it stays in the title) */
  unmatchedStatuses: string[]
  urgent?: boolean
  important?: boolean
  focus?: boolean
  /** From `/followup <date|interval>`. */
  nextFollowupAt?: Date
  /** `/followup none`: no next follow-up instead of the default. */
  followupNone?: boolean
  /** Commands that set nothing (`CommandProblem`), including a `/status`
   * naming no status (`unmatched`). Absent when nothing was parsed. */
  problems?: CommandProblem[]
}

/**
 * Case-insensitive name matching. Tries exact match, then prefix.
 */
function matchByName<T>(name: string, items: T[], getKey: (item: T) => string): T | undefined {
  const lower = name.toLowerCase()
  return items.find((item) => getKey(item).toLowerCase() === lower)
    ?? items.find((item) => getKey(item).toLowerCase().startsWith(lower))
}

/**
 * Case-insensitive prefix match: find the best person matching a parsed name.
 * Extends matchByName with initials and first-name matching.
 */
function matchPerson(name: string, people: Person[]): Person | undefined {
  const lower = name.toLowerCase()
  return matchByName(name, people, (p) => p.name)
    ?? people.find((p) => p.initials.toLowerCase() === lower)
    ?? people.find((p) => (p.name.split(/\s+/)[0] ?? '').toLowerCase() === lower)
}

/**
 * Resolve a list of parsed names against known entities, deduplicating by ID.
 */
function resolveNames<T extends { id?: number }>(
  names: string[],
  matcher: (name: string) => T | undefined,
): { ids: number[]; unmatched: string[] } {
  const ids: number[] = []
  const unmatched: string[] = []
  const seen = new Set<number>()
  for (const name of names) {
    const entity = matcher(name)
    if (entity?.id !== undefined && !seen.has(entity.id)) {
      ids.push(entity.id)
      seen.add(entity.id)
    } else if (!entity) {
      unmatched.push(name)
    }
  }
  return { ids, unmatched }
}

/**
 * Minimal shape of the tag-store needed by `resolveTags`. Kept narrow so
 * tests can substitute a plain in-memory fake without touching Dexie.
 */
export interface TagStoreLike {
  /** Current tag snapshot. Callers may pass a stale snapshot; the resolver
   * uses a local map to dedup in-loop creates. */
  tags: Tag[]
  add: (name: string, color?: string) => Promise<number>
}

/**
 * Look up each parsed `#foo` name in the tag registry (case-insensitive) and
 * assign the existing tag; for misses, create a new tag with
 * `DEFAULT_ENTITY_COLOR` and use the new id. Returns ids in input order,
 * deduped. Empty / whitespace-only names are skipped.
 */
export async function resolveTags(
  names: readonly string[],
  ctx: { tagStore: TagStoreLike },
): Promise<number[]> {
  const ids: number[] = []
  const seen = new Set<number>()
  const createdByLower = new Map<string, number>()
  for (const raw of names) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const lower = trimmed.toLowerCase()
    let id: number | undefined = createdByLower.get(lower)
    if (id === undefined) {
      const existing = ctx.tagStore.tags.find(
        (t) => t.name.trim().toLowerCase() === lower && t.id !== undefined,
      )
      id = existing?.id
    }
    if (id === undefined) {
      try {
        id = await ctx.tagStore.add(trimmed, DEFAULT_ENTITY_COLOR)
        createdByLower.set(lower, id)
      } catch (e) {
        if (e instanceof TagLimitError) {
          // Surface the user-readable message; once the ceiling is hit,
          // every subsequent create would rethrow, so stop early and return
          // whatever ids resolved successfully.
          console.error(e.message)
          break
        }
        throw e
      }
    }
    if (id !== undefined && !seen.has(id)) {
      ids.push(id)
      seen.add(id)
    }
  }
  return ids
}

/**
 * Minimal shape of the person-store needed by `resolveUnmatchedPeople`.
 */
export interface PersonStoreLike {
  /** Lookup-or-create by name (case-insensitive); returns the person's id. */
  getOrCreate: (name: string) => Promise<number>
}

/**
 * Create the people behind `@name` tokens that matched nobody when the input
 * was parsed (`ResolvedInput.unmatchedPersons`): each name is looked up again
 * case-insensitively (someone may have been added since) and created when
 * still missing. Returns ids in input order, deduped. Empty / whitespace-only
 * names are skipped.
 */
export async function resolveUnmatchedPeople(
  names: readonly string[],
  ctx: { personStore: PersonStoreLike },
): Promise<number[]> {
  const ids: number[] = []
  const seen = new Set<number>()
  const byLower = new Map<string, number>()
  for (const raw of names) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const lower = trimmed.toLowerCase()
    let id = byLower.get(lower)
    if (id === undefined) {
      id = await ctx.personStore.getOrCreate(trimmed)
      byLower.set(lower, id)
    }
    if (!seen.has(id)) {
      ids.push(id)
      seen.add(id)
    }
  }
  return ids
}

/**
 * Resolve parsed NLP input against known people and statuses. People match
 * by name (exact, then prefix), initials or first name; `/status` matches the
 * status registry case-insensitively, exact then prefix. A status name that
 * matches nothing stays in the title and is reported as a problem.
 */
export function resolveInput(
  parsed: ParsedInput,
  people: Person[],
  statuses: Status[] = [],
): ResolvedInput {
  const persons = resolveNames(parsed.persons, (name) => matchPerson(name, people))
  const status = parsed.status !== undefined
    ? matchByName(parsed.status, statuses, (s) => s.name)
    : undefined
  const unknownStatus = parsed.status !== undefined && status?.id === undefined
    ? parsed.tokens.find((t) => t.command === 'status')
    : undefined
  const kept = parsed.tokens.filter((t) => t !== unknownStatus)
  const problems: CommandProblem[] = unknownStatus
    ? [...parsed.problems, {
      kind: 'unmatched' as const,
      command: 'status' as const,
      raw: unknownStatus.raw,
      start: unknownStatus.start,
      end: unknownStatus.end,
    }].sort((a, b) => a.start - b.start)
    : parsed.problems
  const ignored = parsed.problems.filter((p) => p.kind === 'ignored')

  return {
    title: unknownStatus ? removeSpans(parsed.text, [...kept, ...ignored]) : parsed.title,
    textWithoutCommands: removeSpans(parsed.text, [...kept.filter((t) => t.type === 'command'), ...ignored]),
    dueDate: parsed.dueDate,
    recurrence: parsed.recurrence,
    personIds: persons.ids,
    unmatchedPersons: persons.unmatched,
    tags: parsed.tags,
    statusId: status?.id,
    unmatchedStatuses: unknownStatus && parsed.status !== undefined ? [parsed.status] : [],
    ...(parsed.urgent ? { urgent: true } : {}),
    ...(parsed.important ? { important: true } : {}),
    ...(parsed.focus ? { focus: true } : {}),
    ...(parsed.nextFollowupAt ? { nextFollowupAt: parsed.nextFollowupAt } : {}),
    ...(parsed.followupNone ? { followupNone: true } : {}),
    problems,
  }
}
