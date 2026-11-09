import type { CSSProperties, ReactNode } from 'react'
import { MARKER_KEYS, type MarkerKey } from '../../../models'
import { MARKER_COLOR, MARKER_LABELS } from '../../../utils/markers'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import { WidgetTopLine } from '../WidgetTopLine'
import type { OnGlanceDrill } from './glance-types'
import type { SectionMeta } from './section-meta'
import styles from './GlanceSections.module.css'

/**
 * What every section is rendered with, as its glance widget. `D` is the
 * part of the glance data it reads; a section with options also takes its
 * widget's typed config (`PeopleTabConfig` …).
 */
export interface SectionProps<D> {
  data: D
  onDrill?: OnGlanceDrill
  /** Extra style for its panel. */
  style?: CSSProperties
  /** A glance widget's look for the panel (no card: it fills the cell). */
  className?: string
}

/** What a panel's header names: a section's meta, or a glance widget's own (Project pulse). */
export type PanelDef = Pick<SectionMeta, 'title' | 'glyph' | 'glyphColor'> & { id: string }

export function Panel({ def, count, onCount, sub, extras, style, className, children }: {
  def: PanelDef
  count?: string
  /** Opens the tasks behind the count; absent = plain text. */
  onCount?: () => void
  sub?: string
  extras?: ReactNode
  style?: CSSProperties
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`${styles.panel} ${styles.surface}${className ? ` ${className}` : ''}`} style={style} aria-label={def.title} data-glance-section={def.id}>
      <WidgetTopLine className={styles.panelHeader}>
        <GlanceGlyph name={def.glyph} color={def.glyphColor} />
        <span className={styles.panelTitle}>{def.title}</span>
        {count != null && (onCount
          ? (
            <button type="button" className={`${styles.panelCount} ${styles.panelCountBtn}`} data-testid="glance-section-count" aria-label={`${def.title}: ${count}. Show tasks`} onClick={onCount}>
              {count}
            </button>
          )
          : <span className={styles.panelCount} data-testid="glance-section-count">{count}</span>)}
        {sub && <span className={styles.panelSub}>{sub}</span>}
        {extras && <span className={styles.panelExtras}>{extras}</span>}
      </WidgetTopLine>
      {children}
    </section>
  )
}

export function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>{title}</span>
      <span className={styles.emptyHint}>{hint}</span>
    </div>
  )
}

/** A chart key: the series' colour as a swatch, or as its glyph when the marks carry it too (Next 7 days). */
export function Legend({ color, label, glyph }: { color: string; label: string; glyph?: GlanceGlyphName }) {
  return (
    <span className={styles.legend}>
      {glyph ? <GlanceGlyph name={glyph} size={11} color={color} /> : <i className={styles.swatch} style={{ background: color }} />}
      {label}
    </span>
  )
}

/** A button when the number can be opened, else a plain element with the same look. */
export function Clickable({ as, className, label, onClick, children, ...rest }: {
  as: 'div' | 'span'
  className?: string
  label?: string
  onClick?: () => void
  children: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  if (onClick) {
    return <button type="button" className={className} aria-label={label} onClick={onClick} {...rest}>{children}</button>
  }
  const Tag = as
  return <Tag className={className} {...rest}>{children}</Tag>
}

/** A count in `color`, or a muted dash for none. */
export function Count({ n, color }: { n: number; color: string }) {
  return <span className={styles.num} style={{ color: n > 0 ? color : 'var(--color-text-muted)' }}>{n > 0 ? n : '–'}</span>
}

/** A row's open tasks by priority: a badge in the marker's colour for each that has any. */
export function PriorityBadges({ counts }: { counts: Record<MarkerKey, number> }) {
  return (
    <span className={styles.priorityBadges} data-testid="glance-priority-badges">
      {MARKER_KEYS.map((k) => counts[k] > 0 && (
        <span
          key={k}
          className={styles.priorityBadge}
          style={{ '--badge-color': MARKER_COLOR[k] } as CSSProperties}
          title={`${counts[k]} ${MARKER_LABELS[k]}`}
          data-priority={k}
        >
          {counts[k]}
        </span>
      ))}
    </span>
  )
}
