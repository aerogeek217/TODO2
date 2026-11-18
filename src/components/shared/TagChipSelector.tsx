import { type RefObject } from 'react'
import type { Tag } from '../../models'
import { ChipSelector } from './ChipSelector'
import { AnchoredPicker } from './AnchoredPicker'
import styles from './TagChipSelector.module.css'
import { byName } from '../../utils/sort-order'

/**
 * The tag lookup-or-create popover over the full tag registry, anchored to
 * `anchorRef` (`anchorIsInside`: the anchor is the trigger, so a click on it
 * is left to the trigger's own toggle). Shared by the desktop task row's
 * tags cell (and the other rows'); without `onCreate` it picks among the
 * tags there are (no Create row).
 */
export function TagPicker({ anchorRef, anchorIsInside = true, assignedTags, allTags, onToggle, onCreate, onClose }: {
  anchorRef: RefObject<HTMLElement | null>
  anchorIsInside?: boolean
  assignedTags: readonly Tag[]
  allTags: readonly Tag[]
  onToggle: (tagId: number) => void
  onCreate?: (name: string) => Promise<void> | void
  onClose: () => void
}) {
  const assignedIds = new Set(assignedTags.map((t) => t.id!))
  return (
    <AnchoredPicker anchorRef={anchorRef} anchorIsInside={anchorIsInside} onClose={onClose}>
      <div className={styles.dropdown}>
        <ChipSelector
          items={[...allTags]
            .sort(byName)
            .map((t) => ({ id: t.id!, name: t.name, color: t.color }))}
          selectedIds={assignedIds}
          onToggle={onToggle}
          onCreate={onCreate}
          onClose={onClose}
          placeholder="Search tags..."
          entityMenu="tag"
        />
      </div>
    </AnchoredPicker>
  )
}
