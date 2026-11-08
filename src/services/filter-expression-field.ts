import type { FilterExpr, Person, Status, Tag } from '../models'
import { expressionAtoms, type ExpressionError, type ExpressionNameResolver, type ExpressionSpan, type ExpressionSpanKind } from '../utils/filter-expression'
import { computeAutocomplete, type AutocompleteSources, type AutocompleteView } from './nlp-autocomplete'
import { matchPerson, matchStatus, matchTag } from './nlp-resolver'
import type { TintSpan, TokenTint } from './nlp-token-tints'

/**
 * What the filter expression field (`components/shared/filters/ExpressionField`)
 * needs from the services: names resolved as Quick Add resolves them, Quick
 * Add's `@ # ! /` popup cut to what an expression takes, and its tints.
 */

/** The ids the filter already names, by kind (`expressionResolver`'s `prefer`). */
export interface NamedIds {
  person: ReadonlySet<number>
  tag: ReadonlySet<number>
  status: ReadonlySet<number>
}

/** The ids `e` names, by kind. */
export function namedIds(e: FilterExpr | null | undefined): NamedIds {
  const out = { person: new Set<number>(), tag: new Set<number>(), status: new Set<number>() }
  for (const a of e ? expressionAtoms(e) : []) if (a.kind === 'person' || a.kind === 'tag' || a.kind === 'status') out[a.kind].add(a.id)
  return out
}

/**
 * Names → ids as Quick Add reads a typed `@` / `#` / `!` name (exact,
 * initials, a prefix). Two people may share a name: a name that matches one
 * the filter already names (`prefer`, its ids) stays that one, so `@Alex`
 * naming the second Alex doesn't switch to the first on the next write
 * (cr33 F5).
 */
export function expressionResolver(
  people: readonly Person[],
  tags: readonly Tag[],
  statuses: readonly Status[],
  prefer?: NamedIds,
): ExpressionNameResolver {
  const pick = <T extends { id?: number; name: string }>(hit: T | undefined, items: readonly T[], ids: ReadonlySet<number> | undefined): number | undefined => {
    if (!hit || !ids || ids.size === 0 || (hit.id !== undefined && ids.has(hit.id))) return hit?.id
    return items.find((i) => i.id !== undefined && ids.has(i.id) && i.name === hit.name)?.id ?? hit.id
  }
  return {
    person: (name) => pick(matchPerson(name, people), people, prefer?.person),
    tag: (name) => pick(matchTag(name, tags), tags, prefer?.tag),
    status: (name) => pick(matchStatus(name, statuses), statuses, prefer?.status),
  }
}

/** The slash commands an expression takes: the priorities. */
const PRIORITY_COMMANDS = new Set(['urgent', 'important', 'focus'])

/**
 * Quick Add's popup for an expression: people, tags and statuses with no
 * Create rows (a filter never creates), and `/` with the priorities only.
 * `allowPeople` false: `@` opens nothing (the check-in filter).
 */
export function expressionAutocomplete(
  value: string,
  cursor: number,
  sources: AutocompleteSources,
  allowPeople = true,
): AutocompleteView | null {
  // A trigger may follow `(` (`not (!Ass`): read as a space there, one character for one, so positions hold.
  const view = computeAutocomplete(value.replace(/\((?=[@#!/])/g, ' '), cursor, { ...sources, commands: true })
  if (!view) return null
  if (view.mode === 'entity') {
    if (view.trigger === '@' && !allowPeople) return null
    const rows = view.rows.filter((r) => r.kind !== 'create')
    return rows.length > 0 ? { ...view, rows } : null
  }
  if (view.mode === 'command') {
    const rows = view.rows.filter((r) => r.kind === 'command' && PRIORITY_COMMANDS.has(r.command.name))
    return rows.length > 0 ? { ...view, rows } : null
  }
  // A command's argument (`/due fri`) isn't part of an expression.
  return null
}

const SPAN_TINT: Partial<Record<ExpressionSpanKind, TokenTint>> = {
  operator: 'operator',
  paren: 'operator',
  person: 'chip',
  tag: 'chip',
  status: 'chip',
  none: 'chip',
  done: 'chip',
  date: 'chip',
  urgent: 'urgent',
  important: 'followup',
  focus: 'accent',
  due: 'due',
  followup: 'followup',
}

/**
 * The field's tints: each span it read (text stays plain), the error's span
 * ringed (it replaces the spans it overlaps), and the token the popup is
 * open on as one being typed.
 */
export function expressionTints(
  spans: readonly ExpressionSpan[],
  error: ExpressionError | null,
  active?: { start: number; end: number },
): TintSpan[] {
  const out: TintSpan[] = []
  for (const s of spans) {
    const tint = SPAN_TINT[s.kind]
    if (tint) out.push({ start: s.start, end: s.end, tint })
  }
  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end
  let kept = out
  if (active && active.end > active.start) {
    kept = kept.filter((s) => !overlaps(s, active))
    kept.push({ start: active.start, end: active.end, tint: 'chip' })
  }
  if (error && error.end > error.start && !(active && overlaps(error, active))) {
    kept = kept.filter((s) => !overlaps(s, error))
    kept.push({ start: error.start, end: error.end, tint: 'error' })
  }
  return kept.sort((a, b) => a.start - b.start)
}
