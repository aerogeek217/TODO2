import { useMemo } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { ListDefinition } from '../../models'
import styles from './ListDefinitionPickerPopup.module.css'

export interface ListDefinitionPickerBodyProps {
  /**
   * Predicate filter. 'canvas' shows every def; 'dashboard' filters by the
   * legacy `pinnedToDashboard` flag (or `excludeIds` if provided).
   */
  mode?: 'dashboard' | 'canvas'
  excludeIds?: number[]
  /** Optional "Pin"/"Add"/etc badge shown at the trailing edge of each row. Omitted = no badge. */
  actionLabel?: string
  /** Rendered centered when there are no items (and no Notes entry). */
  emptyLabel?: string
  /** Dashboard mode: render a "Notes" pseudo-entry. */
  showNotesEntry?: boolean
  onPickNotes?: () => void
  onPick: (listDefinitionId: number) => void
  /** Optional "+ Create new list…" footer button. */
  onCreateNew?: () => void
  /** Rendered above the list; omit for an un-chromed body. */
  header?: string
  filterDefinitions?: (defs: ListDefinition[]) => ListDefinition[]
}

export function ListDefinitionPickerBody({
  mode = 'dashboard',
  excludeIds,
  actionLabel,
  emptyLabel,
  showNotesEntry = false,
  onPickNotes,
  onPick,
  onCreateNew,
  header,
  filterDefinitions,
}: ListDefinitionPickerBodyProps) {
  const { listDefinitions } = useListDefinitionStore()

  const items = useMemo(() => {
    const all = [...listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    let filtered: ListDefinition[]
    if (mode === 'canvas') filtered = all
    else if (excludeIds != null) {
      const excluded = new Set(excludeIds)
      filtered = all.filter(d => d.id != null && !excluded.has(d.id))
    } else {
      filtered = all.filter(d => !d.pinnedToDashboard)
    }
    return filterDefinitions ? filterDefinitions(filtered) : filtered
  }, [listDefinitions, mode, excludeIds, filterDefinitions])

  const showNotes = mode === 'dashboard' && showNotesEntry && onPickNotes != null
  const isEmpty = items.length === 0 && !showNotes

  return (
    <>
      {header && <div className={styles.header}>{header}</div>}
      {isEmpty ? (
        emptyLabel ? <div className={styles.empty}>{emptyLabel}</div> : null
      ) : (
        <div className={styles.list}>
          {showNotes && (
            <button
              key="__notes__"
              className={styles.item}
              onClick={() => { onPickNotes?.() }}
            >
              <span className={styles.itemName}>Notes</span>
              {actionLabel && <span className={styles.itemAction}>{actionLabel}</span>}
            </button>
          )}
          {items.map(d => (
            <button
              key={d.id}
              className={styles.item}
              onClick={() => onPick(d.id as number)}
            >
              <span className={styles.itemName}>{d.name}</span>
              {actionLabel && <span className={styles.itemAction}>{actionLabel}</span>}
            </button>
          ))}
        </div>
      )}
      {onCreateNew && (
        <div className={styles.footer}>
          <button className={styles.createBtn} onClick={onCreateNew}>
            + Create new list…
          </button>
        </div>
      )}
    </>
  )
}
