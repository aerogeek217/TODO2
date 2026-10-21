import { useMemo, useRef, useState } from 'react'
import { useCopySources, type CopySource } from '../../hooks/use-copy-sources'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import type { ListDefinition } from '../../models'
import { listedLists } from '../../models/list-definition'
import { bySortOrder } from '../../utils/sort-order'
import { CopyFromMenu } from '../shared/CopyFromMenu'
import { ChevronRightIcon } from '../shared/icons'
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
   * Optional "Copy of ›" beside Create new list…: opens Copy from's chooser
   * (every layout's lists, then the Eisenhower's) and hands the picked list
   * over, to make a copy of it for the layout.
   */
  onCopyOf?: (source: CopySource) => void
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
  onCopyOf,
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

  const copyOf = onCopyOf ? <CopyOfButton onPick={onCopyOf} /> : null

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
            {copyOf && <div className={styles.emptyCopy}>{copyOf}</div>}
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
      {!showEmptyCta && (onCreateNew || copyOf) && (
        <div className={styles.footer}>
          {onCreateNew && (
            <button type="button" className={styles.createBtn} onClick={create}>
              + Create new list…
            </button>
          )}
          {copyOf}
        </div>
      )}
    </>
  )
}

/** "Copy of ›": opens Copy from's chooser beside it; a pick hands the list over. */
function CopyOfButton({ onPick }: { onPick: (source: CopySource) => void }) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const groups = useCopySources()
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.copyBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>Copy of</span>
        <ChevronRightIcon size={12} />
      </button>
      {open && (
        <CopyFromMenu
          anchorRef={ref}
          placement="right-start"
          label="Copy of"
          groups={groups}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
