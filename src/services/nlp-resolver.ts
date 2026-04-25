import type { Person, Project, Org, RecurrenceType, Tag } from '../models'
import type { ScheduledValue } from '../models/scheduled-value'
import type { ParsedInput } from './natural-language-parser'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { TagLimitError } from '../stores/tag-store'

export interface ResolvedInput {
  title: string
  scheduledDate?: ScheduledValue
  dueDate?: Date
  recurrence?: RecurrenceType
  personIds: number[]
  orgIds: number[]
  /** Person names that didn't match any existing person */
  unmatchedPersons: string[]
  /** Resolved project ID (first match wins) */
  projectId?: number
  /** Project names that didn't match any existing project */
  unmatchedProjects: string[]
  /** Normalized tag slugs from `#foo` tokens (pass-through from `ParsedInput`). */
  tags: string[]
}

/**
 * DUP-11: Case-insensitive name matching. Tries exact match, then prefix.
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
 * DUP-12: Resolve a list of parsed names against known entities, deduplicating by ID.
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
 * Case-insensitive match for orgs: exact name, prefix, then initials.
 */
function matchOrg(name: string, orgs: Org[]): Org | undefined {
  const lower = name.toLowerCase()
  return matchByName(name, orgs, (o) => o.name)
    ?? orgs.find((o) => o.initials?.toLowerCase() === lower)
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
 * Resolve parsed NLP input against known people, projects, and orgs.
 * Person-first: @tokens match people first, unmatched names fall through to org matching.
 */
export function resolveInput(parsed: ParsedInput, people: Person[], projects: Project[] = [], orgs: Org[] = []): ResolvedInput {
  const persons = resolveNames(parsed.persons, (name) => matchPerson(name, people))
  // Try unmatched person names against orgs (person-first precedence)
  const orgResult = resolveNames(persons.unmatched, (name) => matchOrg(name, orgs))
  const projectResult = resolveNames(parsed.projects, (name) => matchByName(name, projects, (p) => p.name))

  return {
    title: parsed.title,
    scheduledDate: parsed.scheduledDate,
    dueDate: parsed.dueDate,
    recurrence: parsed.recurrence,
    personIds: persons.ids,
    orgIds: orgResult.ids,
    unmatchedPersons: orgResult.unmatched,
    projectId: projectResult.ids[0],
    unmatchedProjects: projectResult.unmatched,
    tags: parsed.tags,
  }
}
