import type { DashboardSectionId, DashboardSectionOptions } from '../../../models/dashboard-config'
import type { DashGlyphName } from '../../../utils/dash-glyphs'

/** What a section is, apart from how it renders. */
export interface DashboardSectionMeta {
  id: DashboardSectionId
  title: string
  glyph: DashGlyphName
  glyphColor: string
  /** Columns of the 12-column grid it spans on a wide cell. */
  defaultSpan: number
  /** The options it reads from its config entry (what Customize offers). */
  options: ReadonlyArray<keyof DashboardSectionOptions>
}

export const SECTION_META: Record<DashboardSectionId, DashboardSectionMeta> = {
  hot: { id: 'hot', title: 'Hot', glyph: 'hot', glyphColor: 'var(--color-danger)', defaultSpan: 5, options: [] },
  followup: { id: 'followup', title: 'Needs follow-up', glyph: 'followup', glyphColor: 'var(--color-followup)', defaultSpan: 4, options: ['lookAhead'] },
  next7: { id: 'next7', title: 'Next 7 days', glyph: 'calendar', glyphColor: 'var(--color-overdue)', defaultSpan: 3, options: [] },
  trend: { id: 'trend', title: 'Created vs completed', glyph: 'chart', glyphColor: 'var(--color-accent)', defaultSpan: 5, options: ['range'] },
  status: { id: 'status', title: 'Status', glyph: 'status', glyphColor: 'var(--color-accent)', defaultSpan: 3, options: [] },
  people: { id: 'people', title: 'People', glyph: 'people', glyphColor: 'var(--color-accent)', defaultSpan: 4, options: ['showUnassigned'] },
  tags: { id: 'tags', title: 'Tags', glyph: 'tag', glyphColor: 'var(--color-accent)', defaultSpan: 4, options: ['showUntagged'] },
  stale: { id: 'stale', title: 'Stale tasks', glyph: 'stale', glyphColor: 'var(--color-text-secondary)', defaultSpan: 5, options: ['staleDays'] },
  recent: { id: 'recent', title: 'Recently completed', glyph: 'done', glyphColor: 'var(--color-accent)', defaultSpan: 4, options: ['recentDays'] },
  eisenhower: { id: 'eisenhower', title: 'Eisenhower', glyph: 'matrix', glyphColor: 'var(--color-danger)', defaultSpan: 3, options: [] },
}
