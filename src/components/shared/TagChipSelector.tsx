import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Tag } from '../../models'
import { ChipSelector } from './ChipSelector'
import { PortalDropdown } from './PortalDropdown'
import styles from './TagChipSelector.module.css'

interface TagChipSelectorProps {
  /** Tags currently assigned to this todo. Pre-resolved by the consumer. */
  assignedTags: readonly Tag[]
  /** Full tag registry — populates the lookup-or-create dropdown. */
  allTags: readonly Tag[]
  /** Toggle a tag's assignment by id. */
  onToggle: (tagId: number) => void
  /** Lookup-or-create-and-assign a tag by name. */
  onCreate: (name: string) => Promise<void> | void
  /** Ghost rows: suppress popover open. */
  disabled?: boolean
}

/**
 * Inline tag chip row + lookup-or-create popover. Mirrors the people/org
 * `ChipSelector` pattern on `TaskRow`: empty state shows a hover-revealed
 * `#` trigger; populated state shows clickable `#tag` chips. Click any chip
 * (or the trigger) to open a portaled dropdown over the full tag registry.
 *
 * Pre-resolution rule (mirrors `TaskPillBar`): the consumer threads
 * `assignedTags` and `allTags` in. This component does NOT subscribe to
 * `tag-store` — keeps per-row spam bounded on dense surfaces.
 */
export function TagChipSelector({
  assignedTags, allTags, onToggle, onCreate, disabled,
}: TagChipSelectorProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])
  const toggleOpen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (disabled) return
    setOpen((v) => !v)
  }, [disabled])

  const hasTags = assignedTags.length > 0
  const assignedIds = new Set(assignedTags.map((t) => t.id!))

  return (
    <>
      <div
        ref={anchorRef}
        className={`${styles.chipGroup} ${hasTags ? '' : styles.tagChipEmpty}`}
      >
        {assignedTags.map((tag) => (
          <button
            key={`tag-${tag.id}`}
            type="button"
            className={styles.tagChip}
            style={tag.color ? { color: tag.color, borderColor: tag.color } : undefined}
            onClick={toggleOpen}
            title="Edit tags"
          >
            #{tag.name}
          </button>
        ))}
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
      {open && !disabled && createPortal(
        <PortalDropdown anchorRef={anchorRef} onClickOutside={close}>
          <div className={styles.dropdown}>
            <ChipSelector
              items={[...allTags]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((t) => ({ id: t.id!, name: t.name, color: t.color }))}
              selectedIds={assignedIds}
              onToggle={onToggle}
              onCreate={(name) => { void onCreate(name) }}
              placeholder="Search tags..."
            />
          </div>
        </PortalDropdown>,
        document.body,
      )}
    </>
  )
}
