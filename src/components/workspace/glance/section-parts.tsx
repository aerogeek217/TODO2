import type { CSSProperties, ReactNode } from 'react'
import type { GlanceGlyphName } from '../../../utils/glance-glyphs'
import { GlanceGlyph } from '../../shared/GlanceGlyph'
import { WidgetTopLine } from '../WidgetTopLine'
import styles from './GlanceSections.module.css'

/** What a panel's header names (Created vs completed, Project pulse). */
export interface PanelDef {
  id: string
  title: string
  glyph: GlanceGlyphName
  glyphColor: string
}

export function Panel({ def, count, onCount, sub, extras, titleData, style, className, children }: {
  def: PanelDef
  count?: string
  /** Opens the tasks behind the count; absent = plain text. */
  onCount?: () => void
  sub?: string
  extras?: ReactNode
  /** Data attributes on its title (G5: Project pulse's editor anchors there, `data-pulse-head`). */
  titleData?: Record<`data-${string}`, string>
  style?: CSSProperties
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`${styles.panel} ${styles.surface}${className ? ` ${className}` : ''}`} style={style} aria-label={def.title} data-glance-section={def.id}>
      <WidgetTopLine className={styles.panelHeader}>
        <GlanceGlyph name={def.glyph} color={def.glyphColor} />
        <span className={styles.panelTitle} {...titleData}>{def.title}</span>
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

/** A widget with nothing to show: a title and a hint, and an `action` under them (Project pulse's Add tag). */
export function Empty({ title, hint, action }: { title: string; hint: string; action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyTitle}>{title}</span>
      <span className={styles.emptyHint}>{hint}</span>
      {action}
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
export function Clickable({ as, className, label, title, onClick, children, ...rest }: {
  as: 'div' | 'span'
  className?: string
  label?: string
  /** Its tooltip, either way. */
  title?: string
  onClick?: () => void
  children: ReactNode
} & Record<`data-${string}`, string | undefined>) {
  if (onClick) {
    return <button type="button" className={className} aria-label={label} title={title} onClick={onClick} {...rest}>{children}</button>
  }
  const Tag = as
  return <Tag className={className} title={title} {...rest}>{children}</Tag>
}
