import type { Tag } from '../../../models'
import type { NumberBreakdown } from '../../../models/glance-widgets'
import { formatFollowupDay } from '../../../utils/followup'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
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

/** Created vs completed's totals: the tasks completed, or created, in the range (`rangeWords`: `the last 14 days`). */
export function trendTotalDrill(which: 'completed' | 'created', rangeWords: string, ids: readonly number[]): GlanceDrill {
  return {
    title: which === 'completed' ? 'Completed' : 'Created',
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
): GlanceDrill {
  const day = formatFollowupDay(start, today)
  const week = trendBucketLabel(start, 'week')
  return {
    title: granularity === 'day' ? day : `Week of ${week}`,
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

// Project pulse's tag and the Neglect map's Slipping
// list: the tasks it counted (screen-filtered), in its order.

/** A tag's open tasks (a Project pulse card); `null` = no tag. */
export function tagRowDrill(tag: Pick<Tag, 'id' | 'name'> | null, todoIds: readonly number[]): GlanceDrill {
  return {
    title: tag ? `#${tag.name}` : 'No tag',
    glyph: 'tag',
    description: tag ? `Open tasks tagged #${tag.name}.` : 'Open tasks with no tag.',
    source: { kind: 'todos', todoIds },
  }
}

/** A Neglect map's Slipping tasks (latest first), untouched for `days` or more. */
export function slippingDrill(todoIds: readonly number[], days: number): GlanceDrill {
  return {
    title: 'Slipping',
    glyph: 'stale',
    description: `Open tasks due soon or late and not changed in ${days} days or more, latest first.`,
    source: { kind: 'todos', todoIds },
  }
}
