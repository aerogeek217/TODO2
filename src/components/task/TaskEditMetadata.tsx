import type { Person, Tag, RecurrenceType } from '../../models'
import { ChipSelector } from '../shared/ChipSelector'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import { personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { DeadlinePicker } from '../shared/DeadlinePicker'
import { FollowupEditorGroup } from '../shared/followup/FollowupEditorGroup'
import styles from './TaskEditPopup.module.css'

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
  assignedPeopleIds: Set<number>
  assignedTagIds: Set<number>
  peopleRef: React.RefObject<HTMLDivElement | null>
  tagsRef: React.RefObject<HTMLDivElement | null>
  onTogglePerson: (id: number) => void
  onToggleTag: (id: number) => void
  onCreatePerson?: (name: string) => Promise<void>
  onCreateTag?: (name: string) => Promise<void>

  // Dropdown state
  openDropdown: 'people' | 'tags' | null
  setOpenDropdown: (dd: 'people' | 'tags' | null) => void

  // Follow-up
  followupNext: Date | undefined
  followupLast: Date | undefined
  followupNextHint?: string
  onFollowupNextChange: (next: Date | null) => void
  onFollowupLastChange: (last: Date | null) => void
  onFollowedUp: () => void
  /** Draft mode: no Last follow-up row or Followed up button. */
  hideLastFollowup?: boolean
}

export function TaskEditMetadata({
  deadline, recurrenceType,
  onDeadlineChange, onRecurrenceChange,
  assignedPeople, assignedTags, allPeople, allTags,
  assignedPeopleIds, assignedTagIds,
  peopleRef, tagsRef,
  onTogglePerson, onToggleTag,
  onCreatePerson, onCreateTag,
  openDropdown, setOpenDropdown,
  followupNext, followupLast, followupNextHint,
  onFollowupNextChange, onFollowupLastChange, onFollowedUp, hideLastFollowup = false,
}: TaskEditMetadataProps) {
  return (
    <div className={styles.metaSection}>
      {/* Due date */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Due</span>
        <DeadlinePicker value={deadline} onChange={onDeadlineChange} />
        {deadline && (
          <select
            className={styles.personSelect}
            value={recurrenceType}
            onChange={onRecurrenceChange}
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
          {assignedPeople.map((person) => (
            <button key={`p-${person.id}`} className={styles.personTag}
              onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
              <span className={styles.personAvatar} style={{ background: person.color || NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                {(person.initials || person.name).charAt(0).toUpperCase()}
              </span>
              <span className={styles.personName}>{person.name}</span>
              <span className={styles.chipRemove} onClick={(e) => { e.stopPropagation(); onTogglePerson(person.id!) }}>&times;</span>
            </button>
          ))}
          <button className={styles.chipAddBtn}
            onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
            + Add
          </button>
          {openDropdown === 'people' && (
            <div className={styles.chipDropdown}>
              <ChipSelector
                items={personPickerItems(allPeople)}
                selectedIds={assignedPeopleIds}
                onToggle={onTogglePerson}
                onCreate={onCreatePerson}
                onClose={() => setOpenDropdown(null)}
                avatars
                placeholder={PERSON_PICKER_PLACEHOLDER}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Tags</span>
        <div className={styles.chipArea} ref={tagsRef}>
          {assignedTags.map((tag) => (
            <button key={`t-${tag.id}`} className={styles.tagChip}
              style={{ color: tag.color, borderColor: tag.color }}
              onClick={() => setOpenDropdown(openDropdown === 'tags' ? null : 'tags')}>
              #{tag.name}
              <span className={styles.chipRemove} onClick={(e) => { e.stopPropagation(); onToggleTag(tag.id!) }}>&times;</span>
            </button>
          ))}
          <button className={styles.chipAddBtn}
            onClick={() => setOpenDropdown(openDropdown === 'tags' ? null : 'tags')}>
            + Add
          </button>
          {openDropdown === 'tags' && (
            <div className={styles.chipDropdown}>
              <ChipSelector
                items={allTags.toSorted((a, b) => a.name.localeCompare(b.name)).map(t => ({ id: t.id!, name: t.name, color: t.color }))}
                selectedIds={assignedTagIds}
                onToggle={onToggleTag}
                onCreate={onCreateTag}
                placeholder="Search tags..."
              />
            </div>
          )}
        </div>
      </div>

      <FollowupEditorGroup
        next={followupNext}
        last={followupLast}
        nextHint={followupNextHint}
        onNextChange={onFollowupNextChange}
        onLastChange={onFollowupLastChange}
        onFollowedUp={onFollowedUp}
        hideLast={hideLastFollowup}
        rowClassName={styles.metaRow}
        labelClassName={styles.metaLabel}
      />
    </div>
  )
}
