import type { DashboardTileId } from '../../../models/dashboard-config'
import type { ListTileCount } from '../../../services/stats/list-tiles'
import type { TileStats } from '../../../services/stats/tiles'
import { countOf } from './dashboard-copy'
import { TILES } from './dashboard-tiles'

/** A dashboard's counts as text, for "Copy summary". */
export interface DashboardSummary {
  plain: string
  /** The body (unwrapped) — the clipboard path adds the font wrapper. */
  html: string
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * The counts the dashboard shows, in its order: one line of tiles
 * (`Open 19 · Hot 4 · Urgent 8 · …`), then one of list tiles
 * (`Waiting on 2 · Priya 1:1 agenda 1`). Counts read `shown of total` when
 * the screen filter hides some. With no tiles shown, the Open count stands
 * in so the summary is never empty.
 */
export function buildDashboardSummary(
  tileIds: readonly DashboardTileId[],
  tiles: { shown: TileStats; total: TileStats },
  listTiles: readonly ListTileCount[],
): DashboardSummary {
  const ids = tileIds.length > 0 || listTiles.length > 0 ? tileIds : (['open'] as const)
  const tileParts = ids.map((id) => ({
    label: TILES[id].label,
    count: countOf(tiles.shown[id].ids.length, tiles.total[id].ids.length),
  }))
  const listParts = listTiles.map((t) => ({ label: t.name, count: countOf(t.shown, t.total) }))
  const lines = [tileParts, listParts].filter((parts) => parts.length > 0)
  const plain = lines.map((parts) => parts.map((p) => `${p.label} ${p.count}`).join(' · ')).join('\n')
  const html = lines
    .map((parts) => `<p>${parts.map((p) => `<b>${escapeHtml(p.label)}</b> ${escapeHtml(p.count)}`).join(' · ')}</p>`)
    .join('')
  return { plain, html }
}
