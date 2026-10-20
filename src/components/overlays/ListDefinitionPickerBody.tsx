import { useMemo } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { ListDefinition } from '../../models'
import { listedLists } from '../../models/list-definition'
import { bySortOrder } from '../../utils/sort-order'
import styles from './ListDefinitionPickerPopup.module.css'

export interface ListDefinitionPickerBodyProps {
  /** Ids to hide from the picker. Omit to show every def. */
  excludeIds?: number[]
  /** Optional "Add"/"Pin"/etc badge shown at the trailing edge of each row. Omitted = no badge. */
  actionLabel?: string
  /** Rendered centered when there are no items. */
  emptyLabel?: string
  onPick: (listDefinitionId: number) => void
  /**
   * Optional "+ Create new list…" footer button (a new list of the layout).
   * When the items list is empty, swaps to a primary CTA button
   * (autoFocused) instead of the muted footer link — see
   * `ListDefinitionPickerPopup`'s empty shape.
   */
  onCreateNew?: () => void
  /**
   * The layout whose tab picks the list (a stored layout): the lists it
   * owns are offered (`listedLists`). Omit: none.
   */
  layoutId?: number
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
  layoutId,
  header,
  filterDefinitions,
}: ListDefinitionPickerBodyProps) {
  const { listDefinitions } = useListDefinitionStore()

  const items = useMemo(() => {
    const all = listedLists([...listDefinitions].sort(bySortOrder), layoutId)
    let filtered: ListDefinition[]
    if (excludeIds != null) {
      const excluded = new Set(excludeIds)
      filtered = all.filter(d => d.id != null && !excluded.has(d.id))
    } else {
      filtered = all
    }
    return filterDefinitions ? filterDefinitions(filtered) : filtered
  }, [listDefinitions, excludeIds, filterDefinitions, layoutId])

  const isEmpty = items.length === 0
  const showEmptyCta = isEmpty && onCreateNew != null
  const create = onCreateNew ? () => onCreateNew() : undefined

  return (
    <>
      {header && <div className={styles.header}>{header}</div>}
      {isEmpty ? (
        showEmptyCta ? (
          <div className={styles.emptyCta}>
            <button
              type="button"
              className={styles.primaryCreateBtn}
              onClick={create}
              autoFocus
            >
              + Create new list…
            </button>
          </div>
        ) : emptyLabel ? <div className={styles.empty}>{emptyLabel}</div> : null
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
      {!showEmptyCta && onCreateNew && (
        <div className={styles.footer}>
          <button className={styles.createBtn} onClick={create}>
            + Create new list…
          </button>
        </div>
      )}
    </>
  )
}
