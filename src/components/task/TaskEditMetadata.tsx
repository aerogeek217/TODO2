import { useEffect, useRef, useState } from 'react'
import type { Person, Tag, RecurrenceType } from '../../models'
import { ChipSelector } from '../shared/ChipSelector'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { isInLayerAbove } from '../../utils/dom-layers'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { DeadlinePicker } from '../shared/DeadlinePicker'
import styles from './TaskEditPopup.module.css'
import { byName } from '../../utils/sort-order'
import { PopoverRoot } from '../shared/PopoverRoot'

type MetadataDropdown = 'people' | 'tags'

interface TaskEditMetadataProps {
  // Due date + repeat
  deadline: Date | null
  recurrenceType: RecurrenceType | ''
  onDeadlineChange: (next: Date | null) => void
  onRecurrenceChange: (e: React.ChangeEvent<HTMLSelectElement>) => void

  // People & tags
  assignedPeople: Person[]
  assignedTags: Tag[]
  allPeople: Person[]
  allTags: Tag[]
  onTogglePerson: (id: number) => void
  onToggleTag: (id: number) => void
  onCreatePerson?: (name: string) => Promise<void>
  onCreateTag?: (name: string) => Promise<void>

  /** A people / tags picker opened or closed (the host's scroll body stops scrolling under it). */
  onDropdownChange?: (open: boolean) => void
}

/**
 * The task layout's fields block (D26 BB / BG — the task editor and the
 * review card alike): DUE with its repeat, PEOPLE and TAGS, in the inset
 * container. A chip's name opens its picker, its × unassigns; + Add opens
 * the picker. A press outside a picker closes it — not one in a layer
 * stacked above (a person's / tag's menu or the dialog it opened). The
 * Follow-up group is a block of its own, last (`FollowupBlock`).
 */
export function TaskEditMetadata({
  deadline, recurrenceType,
  onDeadlineChange, onRecurrenceChange,
  assignedPeople, assignedTags, allPeople, allTags,
  onTogglePerson, onToggleTag,
  onCreatePerson, onCreateTag,
  onDropdownChange,
}: TaskEditMetadataProps) {
  const [openDropdown, setOpenDropdownState] = useState<MetadataDropdown | null>(null)
  const sectionRef = useRef<HTMLDivElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const onDropdownChangeRef = useLatestRef(onDropdownChange)
  const setOpenDropdown = (next: MetadataDropdown | null) => {
    setOpenDropdownState(next)
    onDropdownChange?.(next !== null)
  }
  const toggleDropdown = (which: MetadataDropdown) => setOpenDropdown(openDropdown === which ? null : which)

  // Close the picker on an outside press — not one in a layer stacked above.
  useEffect(() => {
    if (!openDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      const section = sectionRef.current
      if (section && isInLayerAbove(section, target)) return
      const own = openDropdown === 'people' ? peopleRef.current : tagsRef.current
      if (own && !own.contains(target)) {
        setOpenDropdownState(null)
        onDropdownChangeRef.current?.(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [openDropdown, onDropdownChangeRef])

  const assignedPeopleIds = new Set(assignedPeople.flatMap((p) => (p.id != null ? [p.id] : [])))
  const assignedTagIds = new Set(assignedTags.flatMap((t) => (t.id != null ? [t.id] : [])))

  return (
    <div className={styles.metaSection} ref={sectionRef} data-task-fields="">
      {/* Due date */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Due</span>
        <DeadlinePicker value={deadline} onChange={onDeadlineChange} />
        {deadline && (
          <select
            className={styles.personSelect}
            value={recurrenceType}
            onChange={onRecurrenceChange}
            aria-label="Repeat"
          >
            <option value="">No repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="biweekly">Biweekly</option>
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        )}
      </div>

      {/* People */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>People</span>
        <div className={styles.chipArea} ref={peopleRef}>
          {/* A chip: its name opens the picker, its × (a button of its own, beside it) unassigns. */}
          {assignedPeople.map((person) => (
            <span key={`p-${person.id}`} className={styles.personTag}>
              <button type="button" className={styles.chipOpen}
                onClick={() => toggleDropdown('people')}>
                <span className={styles.personAvatar} style={{ background: person.color || NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                  {(person.initials || person.name).charAt(0).toUpperCase()}
                </span>
                <span className={styles.personName}>{person.name}</span>
              </button>
              <button type="button" className={styles.chipRemove} aria-label={`Remove ${person.name}`}
                onClick={() => { if (person.id != null) onTogglePerson(person.id) }}>&times;</button>
            </span>
          ))}
          <button type="button" className={styles.chipAddBtn}
            onClick={() => toggleDropdown('people')}>
            + Add
          </button>
          {openDropdown === 'people' && (
            <PopoverRoot className={styles.chipDropdown}>
              <ChipSelector
                items={personPickerItems(allPeople)}
                selectedIds={assignedPeopleIds}
                onToggle={onTogglePerson}
                onCreate={onCreatePerson}
                onClose={() => setOpenDropdown(null)}
                avatars
                entityMenu="person"
                placeholder={PERSON_PICKER_PLACEHOLDER}
              />
            </PopoverRoot>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Tags</span>
        <div className={styles.chipArea} ref={tagsRef}>
          {assignedTags.map((tag) => (
            <span key={`t-${tag.id}`} className={styles.tagChip} style={{ color: tag.color, borderColor: tag.color }}>
              <button type="button" className={styles.chipOpen}
                onClick={() => toggleDropdown('tags')}>
                #{tag.name}
              </button>
              <button type="button" className={styles.chipRemove} aria-label={`Remove #${tag.name}`}
                onClick={() => { if (tag.id != null) onToggleTag(tag.id) }}>&times;</button>
            </span>
          ))}
          <button type="button" className={styles.chipAddBtn}
            onClick={() => toggleDropdown('tags')}>
            + Add
          </button>
          {openDropdown === 'tags' && (
            <PopoverRoot className={styles.chipDropdown}>
              <ChipSelector
                items={allTags.toSorted(byName).flatMap((t) => (t.id != null ? [{ id: t.id, name: t.name, color: t.color }] : []))}
                selectedIds={assignedTagIds}
                onToggle={onToggleTag}
                onCreate={onCreateTag}
                onClose={() => setOpenDropdown(null)}
                placeholder="Search tags..."
                entityMenu="tag"
              />
            </PopoverRoot>
          )}
        </div>
      </div>
    </div>
  )
}
