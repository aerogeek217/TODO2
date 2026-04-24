import { useMemo } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { ListDefinition } from '../../models'
import styles from './ListDefinitionPickerPopup.module.css'

export interface ListDefinitionPickerBodyProps {
  /** Ids to hide from the picker. Omit to show every def. */
  excludeIds?: number[]
  /** Optional "Add"/"Pin"/etc badge shown at the trailing edge of each row. Omitted = no badge. */
  actionLabel?: string
  /** Rendered centered when there are no items. */
  emptyLabel?: string
  onPick: (listDefinitionId: number) => void
  /** Optional "+ Create new list…" footer button. */
  onCreateNew?: () => void
  /** Rendered above the list; omit for an un-chromed body. */
  header?: string
  filterDefinitions?: (defs: ListDefinition[]) => ListDefinition[]
}

export function ListDefinitionPickerBody({
  excludeIds,
  actionLabel,
  emptyLabel,
  onPick,
  onCreateNew,
  header,
  filterDefinitions,
}: ListDefinitionPickerBodyProps) {
  const { listDefinitions } = useListDefinitionStore()

  const items = useMemo(() => {
    const all = [...listDefinitions].sort((a, b) => a.sortOrder - b.sortOrder)
    let filtered: ListDefinition[]
    if (excludeIds != null) {
      const excluded = new Set(excludeIds)
      filtered = all.filter(d => d.id != null && !excluded.has(d.id))
    } else {
      filtered = all
    }
    return filterDefinitions ? filterDefinitions(filtered) : filtered
  }, [listDefinitions, excludeIds, filterDefinitions])

  const isEmpty = items.length === 0

  return (
    <>
      {header && <div className={styles.header}>{header}</div>}
      {isEmpty ? (
        emptyLabel ? <div className={styles.empty}>{emptyLabel}</div> : null
      ) : (
        <div className={styles.list}>
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
