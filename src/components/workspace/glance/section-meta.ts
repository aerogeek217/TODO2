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
  trend: { id: 'trend', title: 'Created vs completed', glyph: 'chart', glyphColor: 'var(--color-accent)' },
  status: { id: 'status', title: 'Status', glyph: 'status', glyphColor: 'var(--color-accent)' },
  people: { id: 'people', title: 'People', glyph: 'people', glyphColor: 'var(--color-accent)' },
  tags: { id: 'tags', title: 'Tags', glyph: 'tag', glyphColor: 'var(--color-accent)' },
}
