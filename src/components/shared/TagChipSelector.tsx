import { useState, useRef, useCallback } from 'react'
import type { Tag } from '../../models'
import { ChipSelector } from './ChipSelector'
import { AnchoredPicker } from './AnchoredPicker'
import styles from './TagChipSelector.module.css'
import { byName } from '../../utils/sort-order'

export interface TagChipSelectorProps {
  /** Tags currently assigned to this todo. Pre-resolved by the consumer. */
  assignedTags: readonly Tag[]
  /** Full tag registry — populates the lookup-or-create dropdown. */
  allTags: readonly Tag[]
  /** Toggle a tag's assignment by id. */
  onToggle: (tagId: number) => void
  /** Lookup-or-create-and-assign a tag by name. */
  onCreate: (name: string) => Promise<void> | void
  /** Controlled popover state (the task menu's "Add tag…" opens it). Uncontrolled when omitted. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Inline tag chip row + lookup-or-create popover. Mirrors the people
 * `ChipSelector` pattern on `TaskRow`: empty state shows a hover-revealed
 * `#` trigger; populated state shows clickable `#tag` chips. Click any chip
 * (or the trigger) to open a portaled dropdown over the full tag registry.
 *
 * Pre-resolution rule (mirrors `TaskPillBar`): the consumer threads
 * `assignedTags` and `allTags` in. This component does NOT subscribe to
 * `tag-store` — keeps per-row spam bounded on dense surfaces.
 */
export function TagChipSelector({
  assignedTags, allTags, onToggle, onCreate,
  open: openProp, onOpenChange,
}: TagChipSelectorProps) {
  const [innerOpen, setInnerOpen] = useState(false)
  const open = openProp ?? innerOpen
  const anchorRef = useRef<HTMLDivElement>(null)

  const setOpen = useCallback((next: boolean) => {
    if (onOpenChange) onOpenChange(next)
    else setInnerOpen(next)
  }, [onOpenChange])
  const close = useCallback(() => setOpen(false), [setOpen])
  const toggleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(!open)
  }, [open, setOpen])

  const hasTags = assignedTags.length > 0
  const assignedIds = new Set(assignedTags.map((t) => t.id!))

  return (
    <>
      <div
        ref={anchorRef}
        className={`${styles.chipGroup} ${hasTags ? '' : styles.tagChipEmpty}`}
        data-tag-chips=""
      >
        {assignedTags.map((tag) => (
          <button
            key={`tag-${tag.id}`}
            type="button"
            className={styles.tagChip}
            data-tag-chip=""
            style={tag.color ? { color: tag.color, borderColor: tag.color } : undefined}
            onClick={toggleOpen}
            title="Edit tags"
          >
            #{tag.name}
          </button>
        ))}
        {assignedTags.length > 1 && (
          // Narrow rows show only the first tag and this count.
          <button
            type="button"
            className={styles.tagMore}
            data-tag-more=""
            onClick={toggleOpen}
            title={assignedTags.slice(1).map((t) => `#${t.name}`).join(' ')}
            aria-label={`${assignedTags.length - 1} more ${assignedTags.length === 2 ? 'tag' : 'tags'}`}
          >
            +{assignedTags.length - 1}
          </button>
        )}
        {!hasTags && (
          <button
            type="button"
            className={styles.chipTrigger}
            onClick={toggleOpen}
            title="Add tag"
            aria-label="Add tag"
          >
            #
          </button>
        )}
      </div>
      {open && (
        <AnchoredPicker anchorRef={anchorRef} onClose={close}>
          <div className={styles.dropdown}>
            <ChipSelector
              items={[...allTags]
                .sort(byName)
                .map((t) => ({ id: t.id!, name: t.name, color: t.color }))}
              selectedIds={assignedIds}
              onToggle={onToggle}
              onCreate={(name) => { void onCreate(name) }}
              onClose={close}
              placeholder="Search tags..."
            />
          </div>
        </AnchoredPicker>
      )}
    </>
  )
}
