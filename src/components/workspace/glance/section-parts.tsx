import type { CSSProperties, ReactNode } from 'react'
import type { SectionOptions } from '../../../models/glance-widgets'
import { MARKER_KEYS, type MarkerKey } from '../../../models'
import { MARKER_COLOR, MARKER_LABELS } from '../../../utils/markers'
import { usePersonStore } from '../../../stores/person-store'
import type { DashGlyphName } from '../../../utils/dash-glyphs'
import { rowKey } from '../../../utils/scoped-selection'
import { leavingShownAs } from '../../../hooks/use-leaving-rows'
import { DashGlyph } from '../../shared/DashGlyph'
import { MobileTaskRow } from '../../task/MobileTaskRow'
import { TaskRowGrid } from '../../task/TaskRowGrid'
import { ListWidgetRow } from '../list/ListWidgetRow'
import type { DashboardRowKit, OnDashboardDrill } from './glance-types'
import type { DashboardSectionMeta } from './section-meta'
import type { TodoLookup } from './section-data'
import styles from './GlanceSections.module.css'

/**
 * What every section is rendered with — on the Dashboard, or as a glance
 * widget of its own. `D` is the part of the dashboard data it reads.
 */
export interface SectionProps<D> {
  data: D
  /** The section's options (the Dashboard tab's entry, or the widget's config). */
  options: SectionOptions
  onDrill?: OnDashboardDrill
  /** Its place in the Dashboard's grid (column span). */
  style?: CSSProperties
  /** A glance widget's look for the panel (no card: it fills the cell). */
  className?: string
}

/** A section that shows task rows: the rows' selection and columns. */
export interface RowSectionProps<D> extends SectionProps<D> {
  rows: DashboardRowKit
}

/** What a panel's header names: a section's meta, or a glance widget's own (What changed, Today, Project pulse). */
export type PanelDef = Pick<DashboardSectionMeta, 'title' | 'glyph' | 'glyphColor'> & { id: string }

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
    <section className={`${styles.panel} ${styles.surface}${className ? ` ${className}` : ''}`} style={style} aria-label={def.title} data-dash-section={def.id}>
      <div className={styles.panelHeader}>
        <DashGlyph name={def.glyph} color={def.glyphColor} />
        <span className={styles.panelTitle}>{def.title}</span>
        {count != null && (onCount
          ? (
            <button type="button" className={`${styles.panelCount} ${styles.panelCountBtn}`} data-testid="dash-section-count" aria-label={`${def.title}: ${count}. Show tasks`} onClick={onCount}>
              {count}
            </button>
          )
          : <span className={styles.panelCount} data-testid="dash-section-count">{count}</span>)}
        {sub && <span className={styles.panelSub}>{sub}</span>}
        {extras && <span className={styles.panelExtras}>{extras}</span>}
      </div>
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
export function Legend({ color, label, glyph }: { color: string; label: string; glyph?: DashGlyphName }) {
  return (
    <span className={styles.legend}>
      {glyph ? <DashGlyph name={glyph} size={11} color={color} /> : <i className={styles.swatch} style={{ background: color }} />}
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

/**
 * Task rows as in a list widget: draggable, selectable, open on click. A
 * `kept` row (a just-completed task the section keeps as it was) shows as
 * it is now and folds away (D19).
 */
export function TaskRows({ sectionKey, ids, data, kit, kept }: {
  sectionKey: string
  ids: readonly number[]
  data: TodoLookup
  kit: DashboardRowKit
  kept?: ReadonlySet<number>
}) {
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const todos = ids.flatMap((id) => {
    const t = data.todoById.get(id)
    return t ? [leavingShownAs(t, kept?.has(id) ? kit.leaving?.get(id) : undefined)] : []
  })
  return (
    <>
      {todos.map((todo, i) => {
        const key = rowKey(sectionKey, todo.id)
        const people = assignedPeopleMap.get(todo.id)
        if (kit.isMobile) {
          return <MobileTaskRow key={key} todo={todo} assignedPeople={people} onOpenDetail={kit.onOpen} />
        }
        const prev = todos[i - 1]
        const next = todos[i + 1]
        return (
          <ListWidgetRow
            key={key}
            todo={todo}
            assignedPeople={people}
            tabId={kit.tabId}
            sectionKey={sectionKey}
            rowKey={key}
            selected={kit.inScope && kit.selectedIds.has(todo.id)}
            selFirst={!(prev && kit.selectedIds.has(prev.id))}
            selLast={!(next && kit.selectedIds.has(next.id))}
            cursor={kit.cursorKey === key}
            look="idle"
            leaving={kept?.has(todo.id) ? kit.leaving?.get(todo.id)?.phase : undefined}
            onSelect={kit.onSelect}
            onOpenDetail={kit.onOpen}
          />
        )
      })}
    </>
  )
}

/** Task rows sharing the tab's columns and divider (phones: a plain list). */
export function RowsGrid({ kit, children }: { kit: DashboardRowKit; children: ReactNode }) {
  if (kit.isMobile) return <>{children}</>
  return (
    <TaskRowGrid
      detailsWidth={kit.detailsWidth}
      onDetailsWidthChange={kit.onDetailsWidthChange}
      liveDetailsWidth={kit.liveDetailsWidth}
    >
      {children}
    </TaskRowGrid>
  )
}

/** A count in `color`, or a muted dash for none. */
export function Count({ n, color }: { n: number; color: string }) {
  return <span className={styles.num} style={{ color: n > 0 ? color : 'var(--color-text-muted)' }}>{n > 0 ? n : '–'}</span>
}

/** A row's open tasks by priority: a badge in the marker's colour for each that has any. */
export function PriorityBadges({ counts }: { counts: Record<MarkerKey, number> }) {
  return (
    <span className={styles.priorityBadges} data-testid="dash-priority-badges">
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
