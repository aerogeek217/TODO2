import { NUMBER_METRIC_LABELS, type NumberMetric, type MetricId } from '../../../models/glance-widgets'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'

/** A Number metric's look and its task dialog's title. */
export interface NumberDef {
  label: string
  /** The task dialog's title. */
  title: string
  glyph: GlanceGlyphName
  /** The metric's colour: its label's, glyph's and count's when lit. */
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

/** The metrics `services/stats/metrics` counts (every Number metric but Closed this week). */
export const METRIC_DEFS: Record<MetricId, NumberDef> = {
  open: { label: L.open, title: 'Open tasks', glyph: 'open', color: 'var(--color-accent)', litWhen: never },
  urgent: { label: L.urgent, title: 'Urgent tasks', glyph: 'urgent', color: 'var(--color-danger)', litWhen: aboveZero },
  overdue: { label: L.overdue, title: 'Overdue tasks', glyph: 'overdue', color: 'var(--color-overdue)', litWhen: aboveZero },
  followupDue: { label: L.followupDue, title: 'Follow-up due', glyph: 'followup', color: 'var(--color-followup)', litWhen: aboveZero },
  focus: { label: L.focus, title: 'Focus', glyph: 'focus', color: 'var(--color-accent)', litWhen: never },
  dueToday: { label: L.dueToday, title: 'Due today', glyph: 'calendar', color: 'var(--color-overdue)', litWhen: aboveZero },
  dueNext7: { label: L.dueNext7, title: 'Due in the next 7 days', glyph: 'calendar', color: 'var(--color-overdue)', litWhen: never },
  noFollowup: { label: L.noFollowup, title: 'No follow-up date', glyph: 'followup', color: 'var(--color-text-muted)', litWhen: never },
}

/** Every Number metric: the counted ones, and Closed this week (good news: never lit). */
export const NUMBER_DEFS: Record<NumberMetric, NumberDef> = {
  ...METRIC_DEFS,
  closedThisWeek: { label: L.closedThisWeek, title: 'Closed this week', glyph: 'done', color: 'var(--color-accent)', litWhen: never },
}

/** A Number's colours at `count`: its metric's colour when lit, else neutral (label and glyph muted, the count in the text colour, a 0 muted). */
export function numberColors(id: NumberMetric, count: number): { lit: boolean; label: string; glyph: string; count: string } {
  const def = NUMBER_DEFS[id]
  if (def.litWhen(count)) return { lit: true, label: def.color, glyph: def.color, count: def.color }
  const muted = 'var(--color-text-muted)'
  return { lit: false, label: muted, glyph: muted, count: count === 0 ? muted : 'var(--color-text-primary)' }
}
