import type { Person, RecurrenceType, Status, Tag } from '../models'
import { removeSpans, type CommandProblem, type ParsedInput } from './natural-language-parser'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { byName } from '../utils/sort-order'

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
function matchByName<T>(name: string, items: readonly T[], getKey: (item: T) => string): T | undefined {
  const lower = name.toLowerCase()
  return items.find((item) => getKey(item).toLowerCase() === lower)
    ?? items.find((item) => getKey(item).toLowerCase().startsWith(lower))
}

/**
 * How well a typed name matches a person / tag name, ignoring case — lower is
 * better: the exact name, (people) the exact initials, a name starting with
 * it, a word in the name starting with it (after a space or punctuation:
 * `alp` → `Project: Alpha`), the text anywhere in the name.
 */
export const NAME_MATCH_RANK = { exact: 0, initials: 1, prefix: 2, wordStart: 3, substring: 4 } as const
export type NameMatchRank = (typeof NAME_MATCH_RANK)[keyof typeof NAME_MATCH_RANK]

/**
 * The worst rank a name typed without picking resolves to (exact, initials,
 * prefix): a word-start or substring match is listed by the `@` / `#` popup
 * but needs an explicit pick — typed on or submitted, the name stays new.
 */
export const TYPED_NAME_MAX_RANK: NameMatchRank = NAME_MATCH_RANK.prefix

export interface NameMatch {
  rank: NameMatchRank
  /** Where the typed text sits in the name (-1: an initials match the name doesn't start with). */
  at: number
}

const WORD_CHAR = /[\p{L}\p{M}\p{N}]/u

/** How `query` (already trimmed and lowercased, non-empty) matches `name` / `initials`, or null. */
function nameMatch(q: string, name: string, initials: string | undefined): NameMatch | null {
  const lower = name.trim().toLowerCase()
  const lead = name.length - name.trimStart().length
  if (lower === q) return { rank: NAME_MATCH_RANK.exact, at: lead }
  if (initials !== undefined && initials.trim().toLowerCase() === q) return { rank: NAME_MATCH_RANK.initials, at: lower.startsWith(q) ? lead : -1 }
  if (lower.startsWith(q)) return { rank: NAME_MATCH_RANK.prefix, at: lead }
  let first = -1
  for (let at = lower.indexOf(q); at >= 0; at = lower.indexOf(q, at + 1)) {
    if (first < 0) first = at
    if (!WORD_CHAR.test(lower[at - 1] ?? '')) return { rank: NAME_MATCH_RANK.wordStart, at: at + lead }
  }
  return first >= 0 ? { rank: NAME_MATCH_RANK.substring, at: first + lead } : null
}

/**
 * Every item whose name `query` matches, with its match, best first
 * (`NAME_MATCH_RANK`); equal ranks alphabetical. An empty query matches every
 * item (as a prefix), alphabetically. Items with `initials` (people) also
 * match on them exactly.
 */
export function rankByName<T extends { name: string; initials?: string }>(
  query: string,
  items: readonly T[],
): { item: T; match: NameMatch }[] {
  const q = query.trim().toLowerCase()
  const out: { item: T; match: NameMatch }[] = []
  for (const item of items) {
    const match = q ? nameMatch(q, item.name, item.initials) : { rank: NAME_MATCH_RANK.prefix, at: 0 }
    if (match) out.push({ item, match })
  }
  return out.sort((a, b) => a.match.rank - b.match.rank || byName(a.item, b.item))
}

/**
 * The item a name typed without picking resolves to: the popup's first row
 * when it is an exact, initials or prefix match (`TYPED_NAME_MAX_RANK`);
 * none for an empty name or only word-start / substring matches.
 */
function typedMatch<T extends { name: string; initials?: string }>(name: string, items: readonly T[]): T | undefined {
  if (!name.trim()) return undefined
  const best = rankByName(name, items)[0]
  return best && best.match.rank <= TYPED_NAME_MAX_RANK ? best.item : undefined
}

/** The tag a parsed `#` name resolves to (none: the tag is created). See `typedMatch`. */
export function matchTag<T extends { name: string }>(name: string, tags: readonly T[]): T | undefined {
  return typedMatch(name, tags)
}

/** The person a parsed `@` name resolves to (none: the person is created). See `typedMatch`. */
export function matchPerson(name: string, people: readonly Person[]): Person | undefined {
  return typedMatch(name, people)
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
 * deduped. Empty / whitespace-only names are skipped. A failed create
 * rejects (the caller reports it).
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
      id = await ctx.tagStore.add(trimmed, DEFAULT_ENTITY_COLOR)
      createdByLower.set(lower, id)
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
 * as `matchPerson` (exact name, exact initials, then prefix); `/status` matches the
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
