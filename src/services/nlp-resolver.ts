import type { Person, Tag, Project, Org, RecurrenceType } from '../models'
import type { ScheduledValue } from '../models/scheduled-value'
import type { ParsedInput } from './natural-language-parser'

export interface ResolvedInput {
  title: string
  scheduledDate?: ScheduledValue
  recurrence?: RecurrenceType
  personIds: number[]
  tagIds: number[]
  orgIds: number[]
  /** Person names that didn't match any existing person */
  unmatchedPersons: string[]
  /** Tag names that didn't match any existing tag */
  unmatchedTags: string[]
  /** Org names that didn't match any existing org */
  unmatchedOrgs: string[]
  /** Resolved project ID (first match wins) */
  projectId?: number
  /** Project names that didn't match any existing project */
  unmatchedProjects: string[]
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
    ?? people.find((p) => p.name.split(/\s+/)[0].toLowerCase() === lower)
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
 * Resolve parsed NLP input against known people, tags, projects, and orgs.
 * Person-first: @tokens match people first, unmatched names fall through to org matching.
 */
export function resolveInput(parsed: ParsedInput, people: Person[], tags: Tag[], projects: Project[] = [], orgs: Org[] = []): ResolvedInput {
  const persons = resolveNames(parsed.persons, (name) => matchPerson(name, people))
  // Try unmatched person names against orgs (person-first precedence)
  const orgResult = resolveNames(persons.unmatched, (name) => matchOrg(name, orgs))
  const tagResult = resolveNames(parsed.tags, (name) => matchByName(name, tags, (t) => t.name))
  const projectResult = resolveNames(parsed.projects, (name) => matchByName(name, projects, (p) => p.name))

  return {
    title: parsed.title,
    scheduledDate: parsed.scheduledDate,
    recurrence: parsed.recurrence,
    personIds: persons.ids,
    tagIds: tagResult.ids,
    orgIds: orgResult.ids,
    unmatchedPersons: orgResult.unmatched,
    unmatchedTags: tagResult.unmatched,
    unmatchedOrgs: [],
    projectId: projectResult.ids[0],
    unmatchedProjects: projectResult.unmatched,
  }
}
