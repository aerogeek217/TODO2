import type { SectionId } from '../../../models/glance-widgets'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'

/** What a section is, apart from how it renders. */
export interface SectionMeta {
  id: SectionId
  title: string
  glyph: GlanceGlyphName
  glyphColor: string
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  followup: { id: 'followup', title: 'Needs follow-up', glyph: 'followup', glyphColor: 'var(--color-followup)' },
  next7: { id: 'next7', title: 'Next 7 days', glyph: 'calendar', glyphColor: 'var(--color-overdue)' },
  trend: { id: 'trend', title: 'Created vs completed', glyph: 'chart', glyphColor: 'var(--color-accent)' },
  status: { id: 'status', title: 'Status', glyph: 'status', glyphColor: 'var(--color-accent)' },
  people: { id: 'people', title: 'People', glyph: 'people', glyphColor: 'var(--color-accent)' },
  tags: { id: 'tags', title: 'Tags', glyph: 'tag', glyphColor: 'var(--color-accent)' },
  stale: { id: 'stale', title: 'Stale tasks', glyph: 'stale', glyphColor: 'var(--color-text-secondary)' },
  recent: { id: 'recent', title: 'Recently completed', glyph: 'done', glyphColor: 'var(--color-accent)' },
  eisenhower: { id: 'eisenhower', title: 'Eisenhower', glyph: 'matrix', glyphColor: 'var(--color-danger)' },
}
