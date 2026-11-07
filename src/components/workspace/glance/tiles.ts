import { NUMBER_METRIC_LABELS, type NumberMetric, type TileMetricId } from '../../../models/glance-widgets'
import type { ClosedThisWeek } from '../../../services/stats/closed-this-week'
import type { StatsContext } from '../../../services/stats/stats-context'
import type { TileStats } from '../../../services/stats/tiles'
import type { DashGlyphName } from '../../../utils/dash-glyphs'
import { formatFollowupDay } from '../../../utils/followup'
import { tileDescription } from './glance-copy'
import type { DashboardDrill } from './glance-types'

/** A built-in tile's (and a Number metric's) look and its task dialog's title. */
export interface TileDef {
  label: string
  /** The task dialog's title. */
  title: string
  glyph: DashGlyphName
  /** The tile's colour: its glyph's in Customize; its label's, glyph's and count's when lit. */
  color: string
  /**
   * Whether the count asks for action (D18): lit, the label, glyph and count
   * take `color`; else they stay neutral (a 0 muted).
   */
  litWhen: (count: number) => boolean
}

const aboveZero = (count: number) => count > 0
const never = () => false
const L = NUMBER_METRIC_LABELS

/** The Dashboard's built-in tiles. */
export const TILES: Record<TileMetricId, TileDef> = {
  open: { label: L.open, title: 'Open tasks', glyph: 'open', color: 'var(--color-accent)', litWhen: never },
  urgent: { label: L.urgent, title: 'Urgent tasks', glyph: 'urgent', color: 'var(--color-danger)', litWhen: aboveZero },
  overdue: { label: L.overdue, title: 'Overdue tasks', glyph: 'overdue', color: 'var(--color-overdue)', litWhen: aboveZero },
  followupDue: { label: L.followupDue, title: 'Follow-up due', glyph: 'followup', color: 'var(--color-followup)', litWhen: aboveZero },
  focus: { label: L.focus, title: 'Focus', glyph: 'focus', color: 'var(--color-accent)', litWhen: never },
  dueToday: { label: L.dueToday, title: 'Due today', glyph: 'calendar', color: 'var(--color-overdue)', litWhen: aboveZero },
  dueNext7: { label: L.dueNext7, title: 'Due in the next 7 days', glyph: 'calendar', color: 'var(--color-overdue)', litWhen: never },
  noFollowup: { label: L.noFollowup, title: 'No follow-up date', glyph: 'followup', color: 'var(--color-text-muted)', litWhen: never },
}

/** Every Number metric: the tiles, and Closed this week (good news: never lit). */
export const NUMBER_DEFS: Record<NumberMetric, TileDef> = {
  ...TILES,
  closedThisWeek: { label: L.closedThisWeek, title: 'Closed this week', glyph: 'done', color: 'var(--color-accent)', litWhen: never },
}

/** A tile's colours at `count`: the tile's colour when lit, else neutral (label and glyph muted, the count in the text colour, a 0 muted). */
export function tileColors(id: NumberMetric, count: number): { lit: boolean; label: string; glyph: string; count: string } {
  const def = NUMBER_DEFS[id]
  if (def.litWhen(count)) return { lit: true, label: def.color, glyph: def.color, count: def.color }
  const muted = 'var(--color-text-muted)'
  return { lit: false, label: muted, glyph: muted, count: count === 0 ? muted : 'var(--color-text-primary)' }
}

/** A tile's tasks for the task dialog (a section's count may open a tile's). */
export function tileDrill(id: TileMetricId, data: { tiles: { shown: TileStats }; ctx: StatsContext }): DashboardDrill {
  const def = TILES[id]
  return {
    title: def.title,
    glyph: def.glyph,
    description: tileDescription(id, data.ctx),
    source: { kind: 'todos', todoIds: data.tiles.shown[id].ids },
  }
}

/** Closed this week's tasks for the task dialog. */
export function closedThisWeekDrill(closed: ClosedThisWeek, today: Date): DashboardDrill {
  const def = NUMBER_DEFS.closedThisWeek
  return {
    title: def.title,
    glyph: def.glyph,
    description: `Tasks completed since ${formatFollowupDay(closed.weekStart, today)}.`,
    source: { kind: 'todos', todoIds: closed.ids },
  }
}
