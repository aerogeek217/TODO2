/**
 * The glance widgets' settings (D25 N): a Number's config (D26 P5) and each section
 * widget's options — the choices a tab menu offers, their defaults, and the
 * pickers that read them from untrusted input (a stored layout, an import).
 */

import type { TodoPredicate } from './filter-predicate'
import {
  DEFAULT_NUMBER_OLDEST_BY,
  isNumberListRef,
  isNumberOldestBy,
  NUMBER_GROUP_MAX,
  NUMBER_SHAPE_FIELD,
  NUMBER_SHAPE_FIELDS,
  NUMBER_SHOWS,
  pickNumberGoal,
  type NumberGoal,
  type NumberGroupItem,
  type NumberListRef,
  type NumberOldestBy,
  type NumberShow,
} from './number-shapes'

export { NUMBER_SHOWS, type NumberShow } from './number-shapes'

type Obj = Record<string, unknown>

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** When a Number lights up in its colour (D18): never, or while its count is above / below `litAt`. */
export const NUMBER_LIT_WHEN = ['never', 'above', 'below'] as const
export type NumberLitWhen = (typeof NUMBER_LIT_WHEN)[number]

/** What a Number's change is against: yesterday's end, the same point of last week, or nothing (no change shown). */
export const NUMBER_COMPARES = ['yesterday', 'lastWeek', 'none'] as const
export type NumberCompare = (typeof NUMBER_COMPARES)[number]

/** A new Number's name: its empty filter counts every open task. */
export const DEFAULT_NUMBER_NAME = 'Open'

/** The longest Number name kept. */
export const NUMBER_NAME_MAX = 80

/** The largest `litAt` kept. */
export const NUMBER_LIT_AT_MAX = 1_000_000

/**
 * A Number (D26 P5, board X): the tasks a filter keeps — composed with the
 * top bar's filter, as a list's is — shown as their count.
 */
export interface NumberConfig {
  /** Its label and tab title (may be blank while it's being typed: the tab then reads `Number`). */
  name: string
  /** Its colour when lit, a hex (`#rgb` / `#rrggbb`, used as it is in both themes); absent = Auto (neutral, lit in the accent). */
  color?: string
  /** What it counts: a Graphical or expression filter, as a list's (an empty one keeps every open task). */
  filter: TodoPredicate
  show: NumberShow
  litWhen: NumberLitWhen
  /** The threshold of `above` / `below` (a whole number); absent with `never`. */
  litAt?: number
  compare: NumberCompare
  /** The top bar's lens doesn't apply to it (as `ListDefinition.ignoreLens`); stored only when true. */
  ignoreLens?: true
  /** Its large face's breakdown (the count's); absent = `none`. */
  breakdown?: NumberBreakdown
  // The active shape's field (D26 P6, `models/number-shapes`): only that one is kept.
  /** `share`: the tasks it is a share of; absent = every open task. */
  of?: TodoPredicate
  /** `oldest`: the date its tasks age by. */
  oldestBy?: NumberOldestBy
  /** `goal`: its goal. */
  goal?: NumberGoal
  /** `group`: its counts (1 – `NUMBER_GROUP_MAX`), each with its own filter; its own `filter` is unused. */
  items?: NumberGroupItem[]
  /** `list`: the list it follows (absent until one is picked); its own `filter` and `ignoreLens` are unused. */
  list?: NumberListRef
}

/** A new Number's config: an empty filter (every open task), never lit, against yesterday. */
export function newNumberConfig(filter: TodoPredicate): NumberConfig {
  return { name: DEFAULT_NUMBER_NAME, filter, show: 'count', litWhen: 'never', compare: 'yesterday' }
}

const HEX_COLOR = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** A Number's stored colour: a hex. */
export function isNumberColor(v: unknown): v is string {
  return typeof v === 'string' && HEX_COLOR.test(v)
}

/** A Number's stored threshold: a whole number from 0 to `NUMBER_LIT_AT_MAX`. */
export function isNumberLitAt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= NUMBER_LIT_AT_MAX
}

export function isNumberName(v: unknown): v is string {
  return typeof v === 'string' && v.length <= NUMBER_NAME_MAX
}

/** Whether `count` lights a Number up (`litWhen` against `litAt`, 0 when absent). */
export function numberIsLit(config: Pick<NumberConfig, 'litWhen' | 'litAt'>, count: number): boolean {
  const at = config.litAt ?? 0
  if (config.litWhen === 'above') return count > at
  if (config.litWhen === 'below') return count < at
  return false
}

/**
 * Where a stored Number config goes wrong (its scalar fields — the filter
 * is the caller's: `data/predicate-shape`): the bad key, or `null`.
 */
export function numberConfigProblem(raw: Obj): string | null {
  if (!isNumberName(raw.name)) return 'name'
  if (raw.color !== undefined && !isNumberColor(raw.color)) return 'color'
  if (!includes(NUMBER_SHOWS, raw.show)) return 'show'
  if (!includes(NUMBER_LIT_WHEN, raw.litWhen)) return 'litWhen'
  if (raw.litWhen === 'never' ? raw.litAt !== undefined : !isNumberLitAt(raw.litAt)) return 'litAt'
  if (!includes(NUMBER_COMPARES, raw.compare)) return 'compare'
  if (raw.ignoreLens !== undefined && raw.ignoreLens !== true) return 'ignoreLens'
  if (raw.breakdown !== undefined && !isNumberBreakdown(raw.breakdown)) return 'breakdown'
  return numberShapeProblem(raw)
}

/** A group item's scalar fields (its filter is the caller's): an object with a name and an optional colour. */
function groupItemProblem(v: unknown): boolean {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return true
  const item = v as Obj
  if (!isNumberName(item.name)) return true
  if (item.color !== undefined && !isNumberColor(item.color)) return true
  return Object.keys(item).some((k) => k !== 'name' && k !== 'filter' && k !== 'color')
}

/**
 * Where a stored Number's shape fields go wrong (D26 P6): a field of another
 * shape (a stray), or its own field missing or unreadable — its predicates
 * (`of`, each item's `filter`) are the caller's.
 */
function numberShapeProblem(raw: Obj): string | null {
  const show = raw.show as NumberShow
  const own = NUMBER_SHAPE_FIELD[show]
  for (const key of NUMBER_SHAPE_FIELDS) if (key !== own && raw[key] !== undefined) return key
  switch (show) {
    case 'oldest':
      return isNumberOldestBy(raw.oldestBy) ? null : 'oldestBy'
    case 'goal':
      return pickNumberGoal(raw.goal).fixed ? 'goal' : null
    case 'group': {
      const items = raw.items
      if (!Array.isArray(items) || items.length === 0 || items.length > NUMBER_GROUP_MAX) return 'items'
      return items.some(groupItemProblem) ? 'items' : null
    }
    case 'list':
      return raw.list === undefined || isNumberListRef(raw.list) ? null : 'list'
    case 'share':
    case 'count':
      return null
  }
}

/** Reads a stored predicate (the data layer's `pickPredicate`): a missing or unreadable one is no filter, a fix. */
export type NumberPredicateRead = (raw: unknown) => PickedConfig<TodoPredicate>

/**
 * A Number's config read from untrusted input, `filter` already picked (the
 * caller's predicate read; `readPredicate` reads its shape's): a bad or
 * missing field gets its default (`fixed`) — the name `Number`, Auto, a
 * count, never lit (a threshold of 0 when `above` / `below` lacks one),
 * against yesterday —; an unknown colour, breakdown or a non-true
 * `ignoreLens` is dropped (`fixed`). Its shape's field is read too
 * (`pickShapeField`); another shape's is dropped (`fixed`).
 */
export function pickNumberConfig(raw: Obj, filter: PickedConfig<TodoPredicate>, readPredicate: NumberPredicateRead): PickedConfig<NumberConfig> {
  let fixed = filter.fixed
  const pick = <V,>(v: unknown, ok: (v: unknown) => v is V, fallback: V): V => {
    if (ok(v)) return v
    fixed = true
    return fallback
  }
  const name = pick(raw.name, isNumberName, 'Number')
  const show = pick(raw.show, (v): v is NumberShow => includes(NUMBER_SHOWS, v), 'count')
  const litWhen = pick(raw.litWhen, (v): v is NumberLitWhen => includes(NUMBER_LIT_WHEN, v), 'never')
  const compare = pick(raw.compare, (v): v is NumberCompare => includes(NUMBER_COMPARES, v), 'yesterday')
  const config: NumberConfig = { name, filter: filter.config, show, litWhen, compare }
  if (isNumberColor(raw.color)) config.color = raw.color
  else if (raw.color !== undefined) fixed = true
  if (litWhen !== 'never') config.litAt = pick(raw.litAt, isNumberLitAt, 0)
  else if (raw.litAt !== undefined) fixed = true
  if (raw.ignoreLens === true) config.ignoreLens = true
  else if (raw.ignoreLens !== undefined) fixed = true
  if (isNumberBreakdown(raw.breakdown)) config.breakdown = raw.breakdown
  else if (raw.breakdown !== undefined) fixed = true
  if (pickShapeField(raw, config, readPredicate)) fixed = true
  return { config, fixed }
}

/**
 * Sets `config`'s shape field from `raw` (D26 P6): `share`'s `of` (absent =
 * every open task), `oldest`'s date (default the last follow-up), `goal`'s
 * goal (default at least 10 a week), `group`'s items (each a name, a filter
 * and a colour; the first `NUMBER_GROUP_MAX`; none = one item counting
 * every open task), `list`'s list (absent until picked). Whether anything
 * was reset or dropped — another shape's field among them.
 */
function pickShapeField(raw: Obj, config: NumberConfig, readPredicate: NumberPredicateRead): boolean {
  const own = NUMBER_SHAPE_FIELD[config.show]
  let fixed = NUMBER_SHAPE_FIELDS.some((key) => key !== own && raw[key] !== undefined)
  switch (config.show) {
    case 'share':
      if (raw.of !== undefined) {
        const of = readPredicate(raw.of)
        config.of = of.config
        if (of.fixed) fixed = true
      }
      return fixed
    case 'oldest':
      config.oldestBy = isNumberOldestBy(raw.oldestBy) ? raw.oldestBy : DEFAULT_NUMBER_OLDEST_BY
      return fixed || config.oldestBy !== raw.oldestBy
    case 'goal': {
      const goal = pickNumberGoal(raw.goal)
      config.goal = goal.goal
      return fixed || goal.fixed
    }
    case 'group': {
      const stored: unknown[] = Array.isArray(raw.items) ? raw.items : []
      if (stored.length === 0 || stored.length > NUMBER_GROUP_MAX) fixed = true
      const items: NumberGroupItem[] = []
      for (const v of stored.slice(0, NUMBER_GROUP_MAX)) {
        if (groupItemProblem(v)) fixed = true
        const item = (v !== null && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Obj
        const filter = readPredicate(item.filter)
        if (filter.fixed) fixed = true
        const picked: NumberGroupItem = { name: isNumberName(item.name) ? item.name : 'Number', filter: filter.config }
        if (isNumberColor(item.color)) picked.color = item.color
        items.push(picked)
      }
      if (items.length === 0) items.push({ name: DEFAULT_NUMBER_NAME, filter: readPredicate(undefined).config })
      config.items = items
      return fixed
    }
    case 'list':
      if (isNumberListRef(raw.list)) config.list = { listDefinitionId: raw.list.listDefinitionId }
      return fixed || (raw.list !== undefined && config.list === undefined)
    case 'count':
      return fixed
  }
}

/** What a Number's large face breaks its tasks down by (D25 R): their people, their tags, or nothing. */
export const NUMBER_BREAKDOWNS = ['none', 'people', 'tags'] as const
export type NumberBreakdown = (typeof NUMBER_BREAKDOWNS)[number]

/** A Number shows no breakdown until one is picked (a config without one reads as this). */
export const DEFAULT_NUMBER_BREAKDOWN: NumberBreakdown = 'none'

/** Each breakdown's menu choice. */
export const NUMBER_BREAKDOWN_LABELS: Record<NumberBreakdown, string> = {
  none: 'None',
  people: 'By person',
  tags: 'By tag',
}

export function isNumberBreakdown(v: unknown): v is NumberBreakdown {
  return includes(NUMBER_BREAKDOWNS, v)
}

// ── Section options ─────────────────────────────────────────────────────────

/** Created vs completed: 14 days (daily bars) or 4 / 12 weeks (weekly bars). */
export const TREND_RANGES = ['14d', '4w', '12w'] as const
export type TrendRange = (typeof TREND_RANGES)[number]

export const DEFAULT_TREND_RANGE: TrendRange = '14d'

/** The sections, in catalog order: each a glance kind (People, Tags and Status are Breakdowns since D26 P8). */
export const SECTION_IDS = ['trend'] as const
export type SectionId = (typeof SECTION_IDS)[number]

// ── The glance widget kinds' configs ────────────────────────────────────────

export interface TrendTabConfig {
  range: TrendRange
}

/**
 * Project pulse: the tags it reads, in pick order (a card per tag). A new
 * tab picks the `Project: …` tags.
 */
export interface TagPicksTabConfig {
  tagIds: number[]
}

/** A config read from untrusted input, and whether a bad or missing value was reset to its default. */
export interface PickedConfig<C> {
  config: C
  fixed: boolean
}

const isTrendRange = (v: unknown): v is TrendRange => includes(TREND_RANGES, v)
const isTagId = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/** A stored tag pick list: an array of numbers (a tag deleted since is kept; it just matches nothing). */
const isTagIds = (v: unknown): v is number[] => Array.isArray(v) && v.every(isTagId)

/** `v` when `ok`, else `fallback` (and `fixed`). */
function pickOne<V>(v: unknown, ok: (v: unknown) => v is V, fallback: V): { value: V; fixed: boolean } {
  return ok(v) ? { value: v, fixed: false } : { value: fallback, fixed: true }
}

/** A Created vs completed's config: a known range, else 14 days (`fixed`). */
export function pickTrendConfig(raw: Obj): PickedConfig<TrendTabConfig> {
  const { value, fixed } = pickOne(raw.range, isTrendRange, DEFAULT_TREND_RANGE)
  return { config: { range: value }, fixed }
}

/**
 * A Project pulse's config: its tag ids that are numbers,
 * each once, in order; not a list = none (`fixed`, as a dropped entry is).
 */
export function pickTagPicksConfig(raw: Obj): PickedConfig<TagPicksTabConfig> {
  const v = raw.tagIds
  if (!Array.isArray(v)) return { config: { tagIds: [] }, fixed: true }
  const tagIds = [...new Set((v as unknown[]).filter(isTagId))]
  return { config: { tagIds }, fixed: !isTagIds(v) }
}

/** Each glance kind's one config field and whether a stored value is one it keeps (the layout check). */
export const GLANCE_CONFIG_FIELDS = {
  trend: { key: 'range', ok: isTrendRange },
  pulse: { key: 'tagIds', ok: isTagIds },
} as const satisfies Record<string, { key: string; ok: (v: unknown) => boolean }>
