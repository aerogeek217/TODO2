import { useId, useMemo, useState } from 'react'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { ListDefinition } from '../../models'
import { listedLists, ownerLayoutId } from '../../models/list-definition'
import { bySortOrder } from '../../utils/sort-order'
import { LAYOUT_ONLY_NOTE } from '../shared/list-choice-entries'
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
   * Optional "+ Create new list…" footer button; `layoutOnly` = the user
   * chose This layout only (see `layoutId`). When the items list is empty,
   * swaps to a primary CTA button (autoFocused) instead of the muted footer
   * link — see `ListDefinitionPickerPopup`'s empty shape.
   */
  onCreateNew?: (layoutOnly: boolean) => void
  /**
   * The layout whose tab picks the list (a saved layout): its own
   * layout-only lists are offered too (`listedLists`), and a new list may
   * be made for it alone — Saved list / This layout only above "Create new
   * list…", Saved list first. Omit: saved lists only.
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
  const [layoutOnly, setLayoutOnly] = useState(false)
  const scopeName = useId()

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
  const create = onCreateNew ? () => onCreateNew(layoutId != null && layoutOnly) : undefined

  const scope = layoutId != null && onCreateNew && (
    <div className={styles.scope} role="radiogroup" aria-label="Keep the new list">
      <label className={styles.scopeOption} title="In your lists, for any layout (Settings › Lists)">
        <input type="radio" name={scopeName} checked={!layoutOnly} onChange={() => setLayoutOnly(false)} />
        Saved list
      </label>
      <label className={styles.scopeOption} title="Kept with this layout: no other layout or list chooser shows it">
        <input type="radio" name={scopeName} checked={layoutOnly} onChange={() => setLayoutOnly(true)} />
        This layout only
      </label>
    </div>
  )

  return (
    <>
      {header && <div className={styles.header}>{header}</div>}
      {isEmpty ? (
        showEmptyCta ? (
          <div className={styles.emptyCta}>
            {scope}
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
              {ownerLayoutId(d) != null && <span className={styles.itemNote}>{LAYOUT_ONLY_NOTE}</span>}
              {actionLabel && <span className={styles.itemAction}>{actionLabel}</span>}
            </button>
          ))}
        </div>
      )}
      {!showEmptyCta && onCreateNew && (
        <div className={styles.footer}>
          {scope}
          <button className={styles.createBtn} onClick={create}>
            + Create new list…
          </button>
        </div>
      )}
    </>
  )
}
