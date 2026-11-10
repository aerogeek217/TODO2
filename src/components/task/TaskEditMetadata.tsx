import { useRef, useState } from 'react'
import type { Person, Tag, RecurrenceType } from '../../models'
import { ChipSelector } from '../shared/ChipSelector'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { DeadlinePicker } from '../shared/DeadlinePicker'
import { PlusIcon, RepeatIcon } from '../shared/icons'
import { byName } from '../../utils/sort-order'
import { FactSection } from './TaskFacts'
import styles from './TaskDetails.module.css'

type MetadataDropdown = 'people' | 'tags'

interface TaskEditMetadataProps {
  // Due date + repeat
  deadline: Date | null
  recurrenceType: RecurrenceType | ''
  onDeadlineChange: (next: Date | null) => void
  onRecurrenceChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  /** The due date's state, as its row colours it (`row-date-state.dueState`). */
  dueTone?: 'past' | 'soon'

  // People & tags
  assignedPeople: Person[]
  assignedTags: Tag[]
  allPeople: Person[]
  allTags: Tag[]
  onTogglePerson: (id: number) => void
  onToggleTag: (id: number) => void
  onCreatePerson?: (name: string) => Promise<void>
  onCreateTag?: (name: string) => Promise<void>
}

/**
 * The facts rail's People, Tags and Due (board BJ — the task editor and the
 * review card alike), in that order between Status and Follow-up. A chip's
 * name opens its picker, its × unassigns; + opens the picker. The picker
 * is placed by `AnchoredPicker` under the section's chips (flipped above
 * near the bottom, clamped inside the viewport, following them as the rail
 * scrolls); a press outside closes it — not one in a layer stacked above
 * (a person's / tag's menu or the dialog it opened), and not one on the
 * chips, whose own toggle runs. Due: the date in the rows' words (its
 * tooltip the full date), a click opens the date picker, × clears it; its
 * repeat beside it.
 */
export function TaskEditMetadata({
  deadline, recurrenceType, dueTone,
  onDeadlineChange, onRecurrenceChange,
  assignedPeople, assignedTags, allPeople, allTags,
  onTogglePerson, onToggleTag,
  onCreatePerson, onCreateTag,
}: TaskEditMetadataProps) {
  const [openDropdown, setOpenDropdown] = useState<MetadataDropdown | null>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const toggleDropdown = (which: MetadataDropdown) => setOpenDropdown(openDropdown === which ? null : which)
  const close = () => setOpenDropdown(null)

  const assignedPeopleIds = new Set(assignedPeople.flatMap((p) => (p.id != null ? [p.id] : [])))
  const assignedTagIds = new Set(assignedTags.flatMap((t) => (t.id != null ? [t.id] : [])))

  return (
    <>
      <FactSection fact="people">
        <div className={styles.chipArea} ref={peopleRef} data-task-people="">
          {/* A chip: its name opens the picker, its × (a button of its own, beside it) unassigns. */}
          {assignedPeople.map((person) => (
            <span key={`p-${person.id}`} className={styles.personChip}>
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
          <button type="button" className={styles.chipAdd} aria-label="Add person" title="Add person"
            aria-expanded={openDropdown === 'people'}
            onClick={() => toggleDropdown('people')}>
            <PlusIcon size={12} strokeWidth={2} />
            {assignedPeople.length === 0 && <span>Add</span>}
          </button>
          {openDropdown === 'people' && (
            <AnchoredPicker anchorRef={peopleRef} onClose={close}>
              <div className={styles.chipDropdown}>
                <ChipSelector
                  items={personPickerItems(allPeople)}
                  selectedIds={assignedPeopleIds}
                  onToggle={onTogglePerson}
                  onCreate={onCreatePerson}
                  onClose={close}
                  avatars
                  entityMenu="person"
                  placeholder={PERSON_PICKER_PLACEHOLDER}
                />
              </div>
            </AnchoredPicker>
          )}
        </div>
      </FactSection>

      <FactSection fact="tags">
        <div className={styles.chipArea} ref={tagsRef} data-task-tags="">
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
          <button type="button" className={styles.chipAdd} aria-label="Add tag" title="Add tag"
            aria-expanded={openDropdown === 'tags'}
            onClick={() => toggleDropdown('tags')}>
            <PlusIcon size={12} strokeWidth={2} />
            {assignedTags.length === 0 && <span>Add</span>}
          </button>
          {openDropdown === 'tags' && (
            <AnchoredPicker anchorRef={tagsRef} onClose={close}>
              <div className={styles.chipDropdown}>
                <ChipSelector
                  items={allTags.toSorted(byName).flatMap((t) => (t.id != null ? [{ id: t.id, name: t.name, color: t.color }] : []))}
                  selectedIds={assignedTagIds}
                  onToggle={onToggleTag}
                  onCreate={onCreateTag}
                  onClose={close}
                  placeholder="Search tags..."
                  entityMenu="tag"
                />
              </div>
            </AnchoredPicker>
          )}
        </div>
      </FactSection>

      <FactSection fact="due">
        <div className={styles.dueLine}>
          <DeadlinePicker value={deadline} onChange={onDeadlineChange} tone={dueTone} />
          {deadline && (
            <label className={styles.repeat}>
              <RepeatIcon size={11} />
              <select
                className={styles.repeatSelect}
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
            </label>
          )}
        </div>
      </FactSection>
    </>
  )
}
