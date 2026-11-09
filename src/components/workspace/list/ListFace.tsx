import { useEffect, useMemo } from 'react'
import type { PersistedTodoItem } from '../../../models'
import type { PersistedListDefinition } from '../../../models/list-definition'
import type { LensTab } from '../../../models/workspace-layout'
import { useBuiltList } from '../../../hooks/use-built-list'
import { useElementSize } from '../../../hooks/use-element-size'
import { useLatestRef } from '../../../hooks/use-latest-ref'
import { useListScreenFilter } from '../../../hooks/use-list-screen-filter'
import { useTabBadges } from '../../../hooks/use-tab-badges'
import { useToday } from '../../../hooks/use-today'
import { useOpenFullWidget } from '../../../hooks/use-widget-face'
import type { Section } from '../../../services/list-sections'
import { useListWidgetStore } from '../../../stores/list-widget-store'
import { useSettingsStore } from '../../../stores/settings-store'
import { useUIStore } from '../../../stores/ui-store'
import { formatRowDate } from '../../../utils/date'
import { daysUntil } from '../../../utils/effective-date'
import type { WidgetFace } from '../../../utils/widget-face'
import { BadgeCapsule } from '../../shared/BadgeCapsule'
import { WidgetKindIcon } from '../../shared/icons'
import type { ListWidgetResult } from './ListWidget'
import { faceCountColor, oldestDue, quickRowsShown } from './list-face'
import { useShownListReport } from './use-shown-list'
import { WidgetTopLine } from '../WidgetTopLine'
import styles from './ListFace.module.css'

/** The tasks of `sections` in order, each once. */
function uniqueTodos(sections: readonly Section[]): PersistedTodoItem[] {
  const seen = new Set<number>()
  const out: PersistedTodoItem[] = []
  for (const s of sections) {
    for (const t of s.todos) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      out.push(t)
    }
  }
  return out
}

/**
 * A list tab's small and medium faces (D25 R). Small: the list's name, its
 * count of tasks shown (under the screen filter and the lens, as the tab
 * counts them) in its tab badge's colours, the badge, and its oldest due
 * date. Medium: that line over the top rows — read-only, a title and its
 * due date, a click opens the editor — and `+N more`, which opens the full
 * list over the cell. No selection, drag or zoom: the full widget has them.
 */
export function ListFace({ tab, definition, face, faceRef, onResult }: {
  tab: LensTab
  definition: PersistedListDefinition
  face: Exclude<WidgetFace, 'large'>
  faceRef: (el: HTMLElement | null) => void
  onResult?: (result: ListWidgetResult) => void
}) {
  const picks = useListWidgetStore((s) => s.picks[tab.id])
  const screenFor = useListScreenFilter(definition.id)
  const { list, baseCount, runtimeFilterPending, lensHides } = useBuiltList(definition, picks, screenFor.filters, undefined, screenFor.probe)
  const tabs = useMemo(() => [tab], [tab])
  const badge = useTabBadges(tabs).get(tab.id)
  const today = useToday()
  const rowDates = useSettingsStore((s) => s.rowDates)
  const openFull = useOpenFullWidget()
  const [rowsRef, rowsSize] = useElementSize()

  const sections = list?.sections
  const todos = useMemo(() => uniqueTodos(sections ?? []), [sections])
  const shown = todos.length
  const countLabel = runtimeFilterPending ? '—' : String(shown)
  const ofLabel = !runtimeFilterPending && shown < baseCount ? `of ${baseCount}` : null
  const oldest = useMemo(() => oldestDue(todos), [todos])
  const oldestLate = oldest != null && (daysUntil(oldest, today) ?? 0) < 0

  // What the tab menu reads: Copy tasks, the group folds and the lens switch (no tab count: the face shows it).
  const lensName = screenFor.lens?.name
  const lens = useMemo(
    () => (lensName != null && !runtimeFilterPending && (screenFor.ignoresLens || lensHides > 0)
      ? { name: lensName, ignored: screenFor.ignoresLens, hides: lensHides, listId: definition.id }
      : undefined),
    [lensName, runtimeFilterPending, screenFor.ignoresLens, lensHides, definition.id],
  )
  const onResultRef = useLatestRef(onResult)
  const grouped = definition.grouping !== 'none'
  useEffect(() => {
    onResultRef.current?.({ ...(lens ? { lens } : {}), sections: sections ?? [], grouped })
  }, [lens, sections, grouped, onResultRef])
  // The tasks as shown, for a review of the tab (its menu, the shortcut, the palette).
  useShownListReport(tab.id, definition, runtimeFilterPending ? null : sections ?? null)

  const quick = face === 'medium' ? todos.slice(0, quickRowsShown(rowsSize.height, todos.length)) : []
  const more = shown - quick.length
  const prompt = definition.runtimeFilter ? `Pick a ${definition.runtimeFilter.field === 'person' ? 'person' : definition.runtimeFilter.field}` : null

  // Its top line (D26 AA1); alone in its cell, the cell's controls float over its corner.
  const line = (
    <WidgetTopLine controls="cell" className={styles.line}>
      <span className={styles.name}>
        <span className={styles.icon}><WidgetKindIcon kind="lens" size={12} /></span>
        <span className={styles.nameText}>{definition.name}</span>
      </span>
      <span className={styles.figures}>
        <span className={styles.count} style={{ color: faceCountColor(badge?.counts) }} data-testid="list-face-count">{countLabel}</span>
        {ofLabel && <span className={styles.of}>{ofLabel}</span>}
        {badge && <BadgeCapsule counts={badge.counts} label={badge.summary.join(', ')} data-list-face-badge="" />}
        {runtimeFilterPending && prompt && <span className={styles.meta}>{prompt}</span>}
        {oldest && (
          <span className={`${styles.meta} ${oldestLate ? styles.late : ''}`} data-testid="list-face-oldest">
            Oldest due {formatRowDate(oldest, today, rowDates)}
          </span>
        )}
      </span>
    </WidgetTopLine>
  )

  return (
    <div ref={faceRef} className={`${styles.face} ${face === 'small' ? styles.small : styles.medium}`} data-list-face={face} data-list-face-tab={tab.id}>
      {line}
      {face === 'medium' && (
        <>
          <ol ref={rowsRef} className={styles.rows} aria-label={`${definition.name}: top tasks`}>
            {quick.map((t) => {
              const due = t.dueDate ? new Date(t.dueDate) : null
              const late = due != null && !t.isCompleted && (daysUntil(due, today) ?? 0) < 0
              return (
                <li key={t.id}>
                  <button
                    type="button"
                    className={`${styles.row} ${t.isCompleted ? styles.rowDone : ''}`}
                    data-todo-id={t.id}
                    onClick={() => useUIStore.getState().openEditPopup(t.id)}
                  >
                    <span className={styles.rowTitle}>{t.title}</span>
                    {due && <span className={`${styles.rowDate} ${late ? styles.late : ''}`}>{formatRowDate(due, today, rowDates)}</span>}
                  </button>
                </li>
              )
            })}
          </ol>
          {more > 0 && (
            openFull ? (
              <button type="button" className={styles.more} onClick={openFull} data-testid="list-face-more">+{more} more</button>
            ) : <span className={styles.more} data-testid="list-face-more">+{more} more</span>
          )}
        </>
      )}
    </div>
  )
}
