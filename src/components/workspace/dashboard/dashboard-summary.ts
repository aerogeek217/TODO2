import type { DashboardSectionConfig, DashboardTileId } from '../../../models/dashboard-config'
import { EISENHOWER_QUADRANTS } from '../../../models/workspace-layout'
import type { DashboardData } from '../../../hooks/use-dashboard-data'
import type { ListTileCount } from '../../../services/stats/list-tiles'
import type { TileStats } from '../../../services/stats/tiles'
import { QUADRANT_NAME } from '../../../utils/eisenhower'
import { escapeHtml } from '../../../utils/html'
import { countOf } from './dashboard-copy'
import { TILES } from './dashboard-tiles'

/** A dashboard's counts as text, for "Copy summary". */
export interface DashboardSummary {
  plain: string
  /** The body (unwrapped) — the clipboard path adds the font wrapper. */
  html: string
}

/** One `Label count` of a summary line. */
export interface SummaryPart {
  label: string
  count: string
}

/** What the sections that add a summary line count. */
export type SectionSummaryData = Pick<DashboardData, 'tags' | 'stale' | 'recent' | 'eisenhower'>

/**
 * The summary lines of the shown count sections, in their order: Tags
 * (`#q4 5 · #home 1 · No tag 3`, the No tag part only while the section
 * shows that row), Stale tasks, Recently completed, Eisenhower (`Do 3 ·
 * Schedule 1 · …`). A section with nothing to list adds no line; the other
 * sections (task rows, charts) add none.
 */
export function sectionSummaryLines(sections: readonly DashboardSectionConfig[], data: SectionSummaryData): SummaryPart[][] {
  const lines: SummaryPart[][] = []
  for (const s of sections) {
    switch (s.id) {
      case 'tags': {
        const { shown, total } = data.tags
        const totalOpen = new Map(total.rows.map((r) => [r.tag.id, r.ids.length]))
        const parts = shown.rows.map((r) => ({ label: `#${r.tag.name}`, count: countOf(r.ids.length, totalOpen.get(r.tag.id) ?? r.ids.length) }))
        if (s.options?.showUntagged !== false && shown.untagged.ids.length > 0) {
          parts.push({ label: 'No tag', count: countOf(shown.untagged.ids.length, total.untagged.ids.length) })
        }
        if (parts.length > 0) lines.push(parts)
        break
      }
      case 'stale':
        lines.push([{ label: 'Stale tasks', count: countOf(data.stale.shown.ids.length, data.stale.total.ids.length) }])
        break
      case 'recent':
        lines.push([{ label: 'Recently completed', count: countOf(data.recent.shown.ids.length, data.recent.total.ids.length) }])
        break
      case 'eisenhower':
        lines.push(EISENHOWER_QUADRANTS.map((q) => ({
          label: QUADRANT_NAME[q],
          count: countOf(data.eisenhower.shown[q].ids.length, data.eisenhower.total[q].ids.length),
        })))
        break
      default:
        break
    }
  }
  return lines
}

/**
 * The counts the dashboard shows, in its order: one line of tiles
 * (`Open 19 · Hot 4 · Urgent 8 · …`), then one of list tiles
 * (`Waiting on 2 · Priya 1:1 agenda 1`), then the count sections' lines
 * (`sectionSummaryLines`). Counts read `shown of total` when the screen
 * filter hides some. With nothing else to list, the Open count stands in so
 * the summary is never empty.
 */
export function buildDashboardSummary(
  tileIds: readonly DashboardTileId[],
  tiles: { shown: TileStats; total: TileStats },
  listTiles: readonly ListTileCount[],
  sectionLines: readonly SummaryPart[][] = [],
): DashboardSummary {
  const ids = tileIds.length > 0 || listTiles.length > 0 || sectionLines.length > 0 ? tileIds : (['open'] as const)
  const tileParts = ids.map((id) => ({
    label: TILES[id].label,
    count: countOf(tiles.shown[id].ids.length, tiles.total[id].ids.length),
  }))
  const listParts = listTiles.map((t) => ({ label: t.name, count: countOf(t.shown, t.total) }))
  const lines = [tileParts, listParts, ...sectionLines].filter((parts) => parts.length > 0)
  const plain = lines.map((parts) => parts.map((p) => `${p.label} ${p.count}`).join(' · ')).join('\n')
  const html = lines
    .map((parts) => `<p>${parts.map((p) => `<b>${escapeHtml(p.label)}</b> ${escapeHtml(p.count)}`).join(' · ')}</p>`)
    .join('')
  return { plain, html }
}
