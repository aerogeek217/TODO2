import type { DashboardTileId } from '../../../models/dashboard-config'
import type { DashGlyphName } from '../../../utils/dash-glyphs'
import { tileDescription } from './dashboard-copy'
import type { DashboardDrill } from './types'
import type { DashboardData } from './use-dashboard-data'

/** A built-in tile's look and its task dialog's title. */
export interface TileDef {
  label: string
  /** The task dialog's title. */
  title: string
  glyph: DashGlyphName
  color: string
}

export const TILES: Record<DashboardTileId, TileDef> = {
  open: { label: 'Open', title: 'Open tasks', glyph: 'open', color: 'var(--color-accent)' },
  hot: { label: 'Hot', title: 'Hot tasks', glyph: 'hot', color: 'var(--color-danger)' },
  urgent: { label: 'Urgent', title: 'Urgent tasks', glyph: 'urgent', color: 'var(--color-danger)' },
  overdue: { label: 'Overdue', title: 'Overdue tasks', glyph: 'overdue', color: 'var(--color-overdue)' },
  followupDue: { label: 'Follow-up due', title: 'Follow-up due', glyph: 'followup', color: 'var(--color-followup)' },
  focus: { label: 'Focus', title: 'Focus', glyph: 'focus', color: 'var(--color-accent)' },
  dueToday: { label: 'Due today', title: 'Due today', glyph: 'calendar', color: 'var(--color-overdue)' },
  dueNext7: { label: 'Due in the next 7 days', title: 'Due in the next 7 days', glyph: 'calendar', color: 'var(--color-overdue)' },
  noFollowup: { label: 'No follow-up date', title: 'No follow-up date', glyph: 'followup', color: 'var(--color-text-muted)' },
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
