/**
 * Project pulse's config (D25 L; its rules G5): the tags it follows, in pick
 * order, and its two rules — what counts as **late** and what as **stale**
 * among a card's open tasks — each a name and, optionally, a filter
 * (Graphical / Expression, as a Number's). A rule left out, or one without a
 * filter, follows the built-in default: Late is `overdue` (due before
 * today), Stale follows Settings' "Fade tasks untouched for N days"
 * (`utils/stale.isStale`). No schema step: a stored config without rules
 * reads as the defaults, and a rule is written on its first edit.
 */

import { emptyPredicate, type TodoPredicate } from './filter-predicate'
import { NUMBER_NAME_MAX, pickTagPicksConfig, type NumberPredicateRead, type PickedConfig, type TagPicksTabConfig } from './glance-widgets'

type Obj = Record<string, unknown>

/** Project pulse's rules, in the order a card shows them. */
export const PULSE_RULE_KEYS = ['late', 'stale'] as const
export type PulseRuleKey = (typeof PULSE_RULE_KEYS)[number]

/**
 * A pulse rule as stored: its name (as a card's counts read it — `5 late`;
 * may be blank while typed: it then reads as the default) and its filter
 * over a card's open tasks; no filter = the built-in default. A name of its
 * own needn't give up the default (a Stale renamed still follows Settings).
 */
export interface PulseRule {
  name: string
  filter?: TodoPredicate
}

/** A Project pulse's config: the tags it reads and its rules (absent = the defaults). */
export interface PulseTabConfig extends TagPicksTabConfig {
  late?: PulseRule
  stale?: PulseRule
}

/** Each rule's default name, lower case as a card's counts read it (`21 open · 5 late · 4 stale`). */
export const PULSE_RULE_DEFAULT_NAMES: Record<PulseRuleKey, string> = { late: 'late', stale: 'stale' }

/** The longest rule name kept (as a Number's name). */
export const PULSE_RULE_NAME_MAX = NUMBER_NAME_MAX

/** Late's default filter, `overdue`: due before today (the Graphical clause the expression's `overdue` reads as). */
export function pulseLateDefaultFilter(): TodoPredicate {
  return { ...emptyPredicate(), dates: { deadline: { match: 'range', start: null, end: { kind: 'relative', token: 'yesterday' } } } }
}

/**
 * The filter that keeps what the built-in staleness keeps for a threshold
 * of `days` (above 0): modified on or before `days` days ago — a Stale
 * rule's first filter, so giving it one changes no count.
 */
export function pulseStaleFilterFor(days: number): TodoPredicate {
  return { ...emptyPredicate(), dates: { modified: { match: 'range', start: null, end: { kind: 'offset', days: -days } } } }
}

/** A rule's name as shown: its own, else (blank or no rule) the default. */
export function pulseRuleName(config: Pick<PulseTabConfig, PulseRuleKey>, key: PulseRuleKey): string {
  return config[key]?.name.trim() || PULSE_RULE_DEFAULT_NAMES[key]
}

/** A rule's filter of its own; `undefined` = the built-in default. */
export function pulseRuleFilter(config: Pick<PulseTabConfig, PulseRuleKey>, key: PulseRuleKey): TodoPredicate | undefined {
  return config[key]?.filter
}

/**
 * A rule as written by an edit: `undefined` (the default, so the config
 * goes back to the default shape) when its name is the default and it has
 * no filter of its own. A blank name is kept (it is being typed).
 */
export function pulseRuleOf(key: PulseRuleKey, name: string, filter: TodoPredicate | undefined): PulseRule | undefined {
  if (filter === undefined && name === PULSE_RULE_DEFAULT_NAMES[key]) return undefined
  return filter === undefined ? { name } : { name, filter }
}

function isRuleName(v: unknown): v is string {
  return typeof v === 'string' && v.length <= PULSE_RULE_NAME_MAX
}

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Where a stored pulse config goes wrong in its own fields (its rules'
 * filters are the caller's: `pulseRulePredicates`): `tagIds`, a rule that
 * isn't an object, or its name; `null` when none does.
 */
export function pulseConfigProblem(raw: Obj): string | null {
  if (pickTagPicksConfig(raw).fixed) return 'tagIds'
  for (const key of PULSE_RULE_KEYS) {
    const rule = raw[key]
    if (rule === undefined) continue
    if (!isObj(rule)) return key
    if (!isRuleName(rule.name)) return `${key}.name`
  }
  return null
}

/** A stored pulse config's rule filters by their path (`late.filter`, …): the caller checks each as a predicate. */
export function pulseRulePredicates(raw: Obj): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = []
  for (const key of PULSE_RULE_KEYS) {
    const rule = raw[key]
    if (isObj(rule) && rule.filter !== undefined) out.push([`${key}.filter`, rule.filter])
  }
  return out
}

/**
 * A Project pulse's config read from untrusted input: its tag picks
 * (`pickTagPicksConfig`) and each rule — not an object: dropped (the
 * default); a bad name: the default name; a filter read as a Number's
 * (`readPredicate`), one that isn't an object dropped (the default). Any change but a repeated tag or a stray key is `fixed`.
 */
export function pickPulseConfig(raw: Obj, readPredicate: NumberPredicateRead): PickedConfig<PulseTabConfig> {
  const tags = pickTagPicksConfig(raw)
  let fixed = tags.fixed
  const config: PulseTabConfig = { ...tags.config }
  for (const key of PULSE_RULE_KEYS) {
    const rule = raw[key]
    if (rule === undefined) continue
    if (!isObj(rule)) {
      fixed = true
      continue
    }
    const name = isRuleName(rule.name) ? rule.name : PULSE_RULE_DEFAULT_NAMES[key]
    if (name !== rule.name) fixed = true
    const picked: PulseRule = { name }
    // A filter that isn't an object is dropped: the rule follows its default (an empty filter would count every open task).
    if (rule.filter !== undefined && !isObj(rule.filter)) fixed = true
    else if (rule.filter !== undefined) {
      const filter = readPredicate(rule.filter)
      if (filter.fixed) fixed = true
      picked.filter = filter.config
    }
    config[key] = picked
  }
  return { config, fixed }
}
