import { DEFAULT_TREND_NAME, type NumberBreakdown } from '../../../models/glance-widgets'
import { formatFollowupDay } from '../../../utils/followup'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import type { NeglectZone } from '../../../utils/neglect-map'
import { trendBucketLabel } from './glance-copy'
import type { GlanceDrill } from './glance-types'

/**
 * What a glance widget's click opens in the task dialog (`GlanceDrill`):
 * every glance payload is built here (and the Neglect map's Slipping list),
 * from the ids and counts the pure statistics (`services/stats/*`) return.
 * The payloads other surfaces open too (a person's or a tag's tasks, the
 * screen filter's) stay in `services/task-dialog`.
 */

const todos = (todoIds: readonly number[]) => ({ kind: 'todos' as const, todoIds: [...todoIds] })

// ── Numbers ─────────────────────────────────────────────────────────────────

/** A Number's tasks: its name, what it counts (`numberDescription`), its ids in dialog order. */
export function numberDrill(name: string, description: string, ids: readonly number[]): GlanceDrill {
  return { title: name, glyph: 'open', description, source: todos(ids) }
}

/** How a Number's breakdown line reads its tasks: its glyph, the words for a named line and for the line with none. */
const BREAKDOWN_WORDS: Record<NumberBreakdownBy, { glyph: GlanceGlyphName; named: (label: string) => string; none: string }> = {
  people: { glyph: 'people', named: (label) => `assigned to ${label}`, none: 'with nobody assigned' },
  tags: { glyph: 'tag', named: (label) => `tagged ${label}`, none: 'with no tag' },
  status: { glyph: 'status', named: (label) => `with the status ${label}`, none: 'with no status' },
  priority: { glyph: 'focus', named: (label) => `with the priority ${label}`, none: 'with no priority' },
}

/** What a shown breakdown is by (every choice but `none`). */
export type NumberBreakdownBy = Exclude<NumberBreakdown, 'none'>

/** One line of a Number's breakdown: its tasks among the Number's (`label` the person's, tag's, status's or priority group's, `key` `none` for the line with none). */
export function breakdownDrill(title: string, by: NumberBreakdownBy, entry: { key: string; label: string; ids: readonly number[] }): GlanceDrill {
  const words = BREAKDOWN_WORDS[by]
  const which = entry.key === 'none' ? words.none : words.named(entry.label)
  return {
    title: `${title} · ${entry.label}`,
    glyph: words.glyph,
    description: `${title}: the ones ${which}.`,
    source: todos(entry.ids),
  }
}

// ── Sections ────────────────────────────────────────────────────────────────

/**
 * A Created vs completed drill's title: `what`, after the widget's name when
 * it has one of its own (`Atlas · Completed`); its default name adds nothing.
 */
function trendTitle(what: string, name?: string): string {
  return name && name !== DEFAULT_TREND_NAME ? `${name} · ${what}` : what
}

/** Created vs completed's totals: the tasks completed, or created, in the range (`rangeWords`: `the last 14 days`). */
export function trendTotalDrill(which: 'completed' | 'created', rangeWords: string, ids: readonly number[], name?: string): GlanceDrill {
  return {
    title: trendTitle(which === 'completed' ? 'Completed' : 'Created', name),
    glyph: 'chart',
    description: `Tasks ${which} in ${rangeWords}.`,
    source: todos(ids),
  }
}

/** A trend bar (`Thu 8`, or `Week of Sep 28`): its completed and created tasks. */
export function trendBucketDrill(
  start: Date,
  granularity: 'day' | 'week',
  today: Date,
  ids: { completed: readonly number[]; created: readonly number[] },
  name?: string,
): GlanceDrill {
  const day = formatFollowupDay(start, today)
  const week = trendBucketLabel(start, 'week')
  return {
    title: trendTitle(granularity === 'day' ? day : `Week of ${week}`, name),
    glyph: 'chart',
    description: granularity === 'day' ? `Tasks completed or created on ${day}.` : `Tasks completed or created in the week of ${week}.`,
    source: {
      kind: 'groups',
      groups: [
        { key: 'completed', label: 'Completed', color: 'var(--color-accent)', todoIds: ids.completed },
        { key: 'created', label: 'Created', color: 'var(--color-chart-created)', todoIds: ids.created },
      ],
    },
  }
}

/**
 * A Burndown point: the tasks open at the end of `day` (today: now;
 * `null`: when the range began — the day before its first).
 */
export function trendOpenDrill(day: Date | null, today: Date, ids: readonly number[], name?: string): GlanceDrill {
  const isToday = day != null && day.getTime() === today.getTime()
  const label = day == null ? '' : formatFollowupDay(day, today)
  return {
    title: trendTitle(day == null ? 'Open at the start' : isToday ? 'Open now' : `Open · ${label}`, name),
    glyph: 'chart',
    description: `Tasks open ${day == null ? 'when the range began' : isToday ? 'now' : `at the end of ${label}`}.`,
    source: todos(ids),
  }
}

/**
 * A Cumulative point: what its two lines count through `day` — the tasks
 * completed and created since the range began, and those open when it
 * began (the created line starts on them).
 */
export function trendCumulativeDrill(
  day: Date,
  today: Date,
  ids: { completed: readonly number[]; created: readonly number[]; openAtStart: readonly number[] },
  name?: string,
): GlanceDrill {
  const isToday = day.getTime() === today.getTime()
  const through = isToday ? 'today' : formatFollowupDay(day, today)
  return {
    title: trendTitle(`Through ${through}`, name),
    glyph: 'chart',
    description: `Tasks completed or created from the start of the range through ${through}, and the ones open when it began.`,
    source: {
      kind: 'groups',
      groups: [
        { key: 'completed', label: 'Completed', color: 'var(--color-accent)', todoIds: ids.completed },
        { key: 'created', label: 'Created', color: 'var(--color-text-secondary)', todoIds: ids.created },
        { key: 'start', label: 'Open at the start', color: 'var(--color-text-muted)', todoIds: ids.openAtStart },
      ],
    },
  }
}

// The Neglect map's Slipping list: the tasks it counted (screen-filtered).

/** ` and not changed in 30 days or more` / ` that changed in the last 30 days`; nothing while Stale after is off (0). */
const staleWords = (days: number, stale: boolean) => {
  if (days <= 0) return ''
  return stale ? ` and not changed in ${days} days or more` : ` that changed in the last ${days} days`
}

const SOON = 'Open tasks due or to follow up soon or late'
const LATER = 'Open tasks due or to follow up later'
const NO_DATES = 'Open tasks with no due date, next follow-up or planned day'

/** What each Neglect map zone holds, in a sentence (`days`: Settings' Stale after). */
const NEGLECT_ZONE_DRILLS: Record<NeglectZone, { title: string; describe: (days: number) => string }> = {
  slipping: { title: 'Slipping', describe: (days) => `${SOON}${staleWords(days, true)}.` },
  inHand: { title: 'In hand', describe: (days) => `${SOON}${staleWords(days, false)}.` },
  later: { title: 'Later', describe: (days) => `${LATER}${staleWords(days, false)}.` },
  drifting: { title: 'Drifting', describe: (days) => `${LATER}${staleWords(days, true)}.` },
  noDates: { title: 'No dates', describe: () => `${NO_DATES}.` },
  forgotten: { title: 'Forgotten', describe: (days) => `${NO_DATES}${staleWords(days, true)}.` },
}

/**
 * A Neglect map zone's tasks, as its word opens them: `zone` is the map's
 * zone key (`noDates`: every task in the strip, Forgotten too); `days` is
 * Settings' Stale after.
 */
export function neglectZoneDrill(zone: NeglectZone, todoIds: readonly number[], days: number): GlanceDrill {
  const spec = NEGLECT_ZONE_DRILLS[zone]
  return { title: spec.title, glyph: 'stale', description: spec.describe(days), source: { kind: 'todos', todoIds } }
}

/** A Neglect map's Slipping tasks, stale for Settings' Stale after (`days`). */
export function slippingDrill(todoIds: readonly number[], days: number): GlanceDrill {
  return neglectZoneDrill('slipping', todoIds, days)
}

// ── The task maps (2026-11-18) ──────────────────────────────────────────────

/** A Work clusters cluster's tasks: each task of its people and tags, once. */
export function clusterDrill(name: string, todoIds: readonly number[]): GlanceDrill {
  return {
    title: name,
    glyph: 'people',
    description: `Open tasks of the people and tags in the ${name} cluster.`,
    source: { kind: 'todos', todoIds: [...todoIds] },
  }
}
