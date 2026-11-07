import type { DashboardSectionConfig, DashboardTileId } from '../../../models/dashboard-config'
import type { DashboardData } from '../../../hooks/use-dashboard-data'
import type { ListTileCount } from '../../../services/stats/list-tiles'
import type { TileStats } from '../../../services/stats/tiles'
import { EISENHOWER_QUADRANTS } from '../../../models/workspace-layout'
import { escapeHtml } from '../../../utils/html'
import { countOf } from './glance-copy'
import { TILES } from './tiles'

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

/** A tag's open counts, as the Tags section and widget show them. */
export type TagsSummaryData = Pick<DashboardData, 'tags'>

/** Tags: `#q4 5 · #home 1 · No tag 3` (No tag only while the row shows); none when there's nothing to list. */
export function tagsLine(data: TagsSummaryData, showUntagged: boolean): SummaryPart[] {
  const { shown, total } = data.tags
  const totalOpen = new Map(total.rows.map((r) => [r.tag.id, r.ids.length]))
  const parts = shown.rows.map((r) => ({ label: `#${r.tag.name}`, count: countOf(r.ids.length, totalOpen.get(r.tag.id) ?? r.ids.length) }))
  if (showUntagged && shown.untagged.ids.length > 0) {
    parts.push({ label: 'No tag', count: countOf(shown.untagged.ids.length, total.untagged.ids.length) })
  }
  return parts
}

/** Stale tasks: `Stale tasks 4`. */
export function staleLine(data: Pick<DashboardData, 'stale'>): SummaryPart[] {
  return [{ label: 'Stale tasks', count: countOf(data.stale.shown.ids.length, data.stale.total.ids.length) }]
}

/** Recently completed: `Recently completed 6`. */
export function recentLine(data: Pick<DashboardData, 'recent'>): SummaryPart[] {
  return [{ label: 'Recently completed', count: countOf(data.recent.shown.ids.length, data.recent.total.ids.length) }]
}

/** The Eisenhower: each pane's name and count — `Do 3 · Schedule 1 · …`. */
export function eisenhowerLine(data: Pick<DashboardData, 'eisenhower' | 'eisenhowerSetup'>): SummaryPart[] {
  return data.eisenhowerSetup.panes.map((p) => ({
    label: p.name,
    count: countOf(data.eisenhower.shown[p.id].ids.length, data.eisenhower.total[p.id].ids.length),
  }))
}

/** What the sections that add a summary line count. */
export type SectionSummaryData = Pick<DashboardData, 'tags' | 'stale' | 'recent' | 'eisenhower' | 'eisenhowerSetup'>

/**
 * The summary lines of the shown count sections, in their order: Tags
 * (`tagsLine`), Stale tasks, Recently completed, Eisenhower (each pane's
 * name and count). A section with nothing to list adds no line; the other
 * sections (task rows, charts) add none.
 */
export function sectionSummaryLines(sections: readonly DashboardSectionConfig[], data: SectionSummaryData): SummaryPart[][] {
  const lines: SummaryPart[][] = []
  for (const s of sections) {
    switch (s.id) {
      case 'tags': {
        const parts = tagsLine(data, s.options?.showUntagged !== false)
        if (parts.length > 0) lines.push(parts)
        break
      }
      case 'stale':
        lines.push(staleLine(data))
        break
      case 'recent':
        lines.push(recentLine(data))
        break
      case 'eisenhower':
        lines.push(eisenhowerLine(data))
        break
      default:
        break
    }
  }
  return lines
}

// ── A glance widget's lines (its tab menu's Copy) ────────────────────────────
// Each starts with the widget's title and its headline count, then the
// lines the Dashboard's summary has for it, or its parts.

/** Needs follow-up: `Needs follow-up 5`, then `Late 2 · Today 1 · Next 7 days 2`. */
export function followupLines(followup: DashboardData['followup'], lookAhead: number): SummaryPart[][] {
  const { shown, total } = followup
  const n = (g: typeof shown) => g.late.length + g.today.length + g.upcoming.length
  return [
    [{ label: 'Needs follow-up', count: countOf(n(shown), n(total)) }],
    [
      { label: 'Late', count: String(shown.late.length) },
      { label: 'Today', count: String(shown.today.length) },
      { label: `Next ${lookAhead} days`, count: String(shown.upcoming.length) },
    ],
  ]
}

/** Next 7 days: a part per column, `Late 2 due, 1 follow-up · Today 1 due, 0 follow-up · …`. */
export function nextDaysLines(nextDays: DashboardData['nextDays'], labels: (date: Date | null, i: number) => string): SummaryPart[][] {
  return [
    [{ label: 'Next 7 days', count: '' }],
    nextDays.map((c, i) => ({ label: labels(c.date, i), count: `${c.dueIds.length} due, ${c.followupIds.length} follow-up` })),
  ]
}

/** Created vs completed: `Created vs completed Last 14 days`, then `Completed 5 · Created 8 · Net +3`. */
export function trendLines(trend: DashboardData['trend'], rangeLabel: string, signedNet: (n: number) => string): SummaryPart[][] {
  if (!trend) return [[{ label: 'Created vs completed', count: rangeLabel }]]
  return [
    [{ label: 'Created vs completed', count: rangeLabel }],
    [
      { label: 'Completed', count: String(trend.completed) },
      { label: 'Created', count: String(trend.created) },
      { label: 'Net', count: signedNet(trend.net) },
    ],
  ]
}

/** Status: `Status 12 open`, then each status with open tasks, `Waiting 3 · In progress 2 · …`. */
export function statusLines(status: DashboardData['status']): SummaryPart[][] {
  const open = status.shown.reduce((n, e) => n + e.count, 0)
  const openTotal = status.total.reduce((n, e) => n + e.count, 0)
  return [
    [{ label: 'Status', count: `${countOf(open, openTotal)} open` }],
    status.shown.filter((e) => e.count > 0).map((e) => ({ label: e.label, count: String(e.count) })),
  ]
}

/** People: each person's open tasks, `Aisha 3 · Ben 2 · Unassigned 1`. */
export function peopleLines(people: DashboardData['people'], showUnassigned: boolean): SummaryPart[][] {
  const parts = people.rows.map((r) => ({ label: r.person.name, count: String(r.ids.length) }))
  if (showUnassigned && people.unassigned.ids.length > 0) parts.push({ label: 'Unassigned', count: String(people.unassigned.ids.length) })
  return [[{ label: 'People', count: '' }], parts]
}

/** Tags: `Tags 9 tagged`, then `tagsLine`. */
export function tagsLines(data: TagsSummaryData, showUntagged: boolean): SummaryPart[][] {
  const { shown, total } = data.tags
  return [[{ label: 'Tags', count: `${countOf(shown.taggedIds.length, total.taggedIds.length)} tagged` }], tagsLine(data, showUntagged)]
}

/** The Eisenhower summary: `Eisenhower 9 open`, then each pane's count. */
export function eisenhowerLines(data: Pick<DashboardData, 'eisenhower' | 'eisenhowerSetup'>): SummaryPart[][] {
  const sum = (s: DashboardData['eisenhower']['shown']) => EISENHOWER_QUADRANTS.reduce((n, q) => n + s[q].ids.length, 0)
  return [
    [{ label: 'Eisenhower', count: `${countOf(sum(data.eisenhower.shown), sum(data.eisenhower.total))} open` }],
    eisenhowerLine(data),
  ]
}

/** A Number: `Overdue 3`, then its sub-line (when it has one). */
export function numberLines(label: string, count: string, sub: string): SummaryPart[][] {
  return [[{ label, count }], ...(sub ? [[{ label: sub, count: '' }]] : [])]
}

/**
 * The counts the dashboard shows, in its order: one line of tiles
 * (`Open 19 · Focus 2 · Urgent 8 · …`), then one of list tiles
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
  return summaryOf([tileParts, listParts, ...sectionLines])
}

/**
 * Summary lines as text, for the clipboard: a line per `lines` entry (an
 * empty one skipped), its parts `Label count` joined by ` · ` — the label
 * bold in the HTML; a part with an empty count is its label alone.
 */
export function summaryOf(lines: readonly SummaryPart[][]): DashboardSummary {
  const kept = lines.filter((parts) => parts.length > 0)
  const text = (p: SummaryPart) => (p.count ? `${p.label} ${p.count}` : p.label)
  const html = (p: SummaryPart) => (p.count ? `<b>${escapeHtml(p.label)}</b> ${escapeHtml(p.count)}` : `<b>${escapeHtml(p.label)}</b>`)
  return {
    plain: kept.map((parts) => parts.map(text).join(' · ')).join('\n'),
    html: kept.map((parts) => `<p>${parts.map(html).join(' · ')}</p>`).join(''),
  }
}
