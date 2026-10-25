import type { DashboardTileId } from '../../../models/dashboard-config'
import type { DashGlyphName } from '../../../utils/dash-glyphs'
import { tileDescription } from './dashboard-copy'
import type { DashboardDrill } from './types'
import type { DashboardData } from '../../../hooks/use-dashboard-data'

/** A built-in tile's look and its task dialog's title. */
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

export const TILES: Record<DashboardTileId, TileDef> = {
  open: { label: 'Open', title: 'Open tasks', glyph: 'open', color: 'var(--color-accent)', litWhen: never },
  hot: { label: 'Hot', title: 'Hot tasks', glyph: 'hot', color: 'var(--color-danger)', litWhen: aboveZero },
  urgent: { label: 'Urgent', title: 'Urgent tasks', glyph: 'urgent', color: 'var(--color-danger)', litWhen: aboveZero },
  overdue: { label: 'Overdue', title: 'Overdue tasks', glyph: 'overdue', color: 'var(--color-overdue)', litWhen: aboveZero },
  followupDue: { label: 'Follow-up due', title: 'Follow-up due', glyph: 'followup', color: 'var(--color-followup)', litWhen: aboveZero },
  focus: { label: 'Focus', title: 'Focus', glyph: 'focus', color: 'var(--color-accent)', litWhen: never },
  dueToday: { label: 'Due today', title: 'Due today', glyph: 'calendar', color: 'var(--color-overdue)', litWhen: aboveZero },
  dueNext7: { label: 'Due in the next 7 days', title: 'Due in the next 7 days', glyph: 'calendar', color: 'var(--color-overdue)', litWhen: never },
  noFollowup: { label: 'No follow-up date', title: 'No follow-up date', glyph: 'followup', color: 'var(--color-text-muted)', litWhen: never },
}

/** A tile's colours at `count`: the tile's colour when lit, else neutral (label and glyph muted, the count in the text colour, a 0 muted). */
export function tileColors(id: DashboardTileId, count: number): { lit: boolean; label: string; glyph: string; count: string } {
  const def = TILES[id]
  if (def.litWhen(count)) return { lit: true, label: def.color, glyph: def.color, count: def.color }
  const muted = 'var(--color-text-muted)'
  return { lit: false, label: muted, glyph: muted, count: count === 0 ? muted : 'var(--color-text-primary)' }
}

/** A tile's tasks for the task dialog (the Hot section's count opens the Hot tile's). */
export function tileDrill(id: DashboardTileId, data: DashboardData): DashboardDrill {
  const def = TILES[id]
  return {
    title: def.title,
    glyph: def.glyph,
    description: tileDescription(id, data.ctx),
    source: { kind: 'todos', todoIds: data.tiles.shown[id].ids },
  }
}
