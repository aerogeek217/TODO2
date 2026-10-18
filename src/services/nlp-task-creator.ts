import { parseInput } from './natural-language-parser'
import { resolveInput, type ResolvedInput } from './nlp-resolver'
import type { Person, Status } from '../models'

export interface NlpCreateResult {
  title: string
  resolved: ResolvedInput
}

/**
 * Parse raw input text and resolve against known people / statuses. Returns the cleaned title and resolved metadata.
 */
export function parseTaskInput(
  rawTitle: string,
  people: Person[],
  statuses: Status[] = [],
): NlpCreateResult {
  const parsed = parseInput(rawTitle)
  const resolved = resolveInput(parsed, people, statuses)
  return { title: resolved.title, resolved }
}
