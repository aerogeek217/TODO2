import type { Person, Tag, RecurrenceType, PersistedTodoItem } from '../../models'
import { ChipSelector } from '../shared/ChipSelector'
import { DeadlinePicker } from '../shared/DeadlinePicker'
import { FollowupEditorGroup } from '../shared/followup/FollowupEditorGroup'
import styles from './TaskEditPopup.module.css'

interface TaskEditMetadataProps {
  // Due date + repeat
  deadline: Date | null
  recurrenceType: RecurrenceType | ''
  onDeadlineChange: (next: Date | null) => void
  onRecurrenceChange: (e: React.ChangeEvent<HTMLSelectElement>) => void

  // Project
  projectId: number | undefined
  projects: { id?: number; name: string; color?: string }[]
  projectSearch: string
  projectRef: React.RefObject<HTMLDivElement | null>
  projectSearchRef: React.RefObject<HTMLInputElement | null>
  onProjectSelect: (id: number | undefined) => void
  onProjectSearchChange: (search: string) => void

  // People & tags
  assignedPeople: Person[]
  assignedTags: Tag[]
  allPeople: Person[]
  allTags: Tag[]
  assignedPeopleIds: Set<number>
  assignedTagIds: Set<number>
  isEdit: boolean
  peopleRef: React.RefObject<HTMLDivElement | null>
  tagsRef: React.RefObject<HTMLDivElement | null>
  onTogglePerson: (id: number) => void
  onToggleTag: (id: number) => void
  onCreatePerson?: (name: string) => Promise<void>
  onCreateTag?: (name: string) => Promise<void>

  // Dropdown state
  openDropdown: 'people' | 'project' | 'tags' | null
  setOpenDropdown: (dd: 'people' | 'project' | 'tags' | null) => void

  // For project select save in edit mode
  todo?: PersistedTodoItem
  onUpdate?: (todo: PersistedTodoItem) => void

  // Follow-up
  followupNext: Date | undefined
  followupLast: Date | undefined
  followupNextHint?: string
  onFollowupNextChange: (next: Date | null) => void
  onFollowupLastChange: (last: Date | null) => void
  onFollowedUp: () => void
}

export function TaskEditMetadata({
  deadline, recurrenceType,
  onDeadlineChange, onRecurrenceChange,
  projectId, projects, projectSearch, projectRef, projectSearchRef,
  onProjectSelect, onProjectSearchChange,
  assignedPeople, assignedTags, allPeople, allTags,
  assignedPeopleIds, assignedTagIds, isEdit,
  peopleRef, tagsRef,
  onTogglePerson, onToggleTag,
  onCreatePerson, onCreateTag,
  openDropdown, setOpenDropdown,
  todo, onUpdate,
  followupNext, followupLast, followupNextHint,
  onFollowupNextChange, onFollowupLastChange, onFollowedUp,
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

      {/* Project */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Project</span>
        <div className={styles.chipArea} ref={projectRef}>
          {(() => {
            const selectedProject = projectId ? projects.find(p => p.id === projectId) : null
            return selectedProject ? (
              <button className={styles.projectChip}
                style={selectedProject.color ? { borderColor: selectedProject.color, color: selectedProject.color } : undefined}
                onClick={() => { setOpenDropdown(openDropdown === 'project' ? null : 'project'); onProjectSearchChange('') }}>
                {selectedProject.color && <span className={styles.projectDot} style={{ background: selectedProject.color }} />}
                {selectedProject.name}
              </button>
            ) : (
              <button className={styles.chipAddBtn}
                onClick={() => { setOpenDropdown(openDropdown === 'project' ? null : 'project'); onProjectSearchChange('') }}>
                + Project
              </button>
            )
          })()}
          {openDropdown === 'project' && (
            <div className={styles.chipDropdown}>
              <input
                ref={projectSearchRef}
                className={styles.projectSearchInput}
                value={projectSearch}
                onChange={(e) => onProjectSearchChange(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search projects..."
                maxLength={200}
              />
              <div className={styles.projectList}>
                {!projectSearch && (
                  <button
                    className={`${styles.projectOption} ${!projectId ? styles.projectOptionActive : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      onProjectSelect(undefined)
                      if (isEdit && todo && onUpdate) onUpdate({ ...todo, projectId: undefined, modifiedAt: new Date() })
                      setOpenDropdown(null)
                      onProjectSearchChange('')
                    }}
                  >
                    <span className={styles.projectDot} style={{ background: 'var(--color-text-muted)' }} />
                    No project
                  </button>
                )}
                {projects
                  .filter(p => !projectSearch || p.name.toLowerCase().includes(projectSearch.toLowerCase()))
                  .toSorted((a, b) => a.name.localeCompare(b.name))
                  .map(p => (
                    <button
                      key={p.id}
                      className={`${styles.projectOption} ${projectId === p.id ? styles.projectOptionActive : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        onProjectSelect(p.id)
                        if (isEdit && todo && onUpdate) onUpdate({ ...todo, projectId: p.id, modifiedAt: new Date() })
                        setOpenDropdown(null)
                        onProjectSearchChange('')
                      }}
                    >
                      <span className={styles.projectDot} style={{ background: p.color || 'var(--color-text-muted)' }} />
                      {p.name}
                    </button>
                  ))
                }
              </div>
            </div>
          )}
        </div>
      </div>

      {/* People */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>People</span>
        <div className={styles.chipArea} ref={peopleRef}>
          {assignedPeople.map((person) => (
            <button key={`p-${person.id}`} className={styles.personTag}
              style={person.color ? { color: person.color, borderColor: person.color } : undefined}
              onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
              @{person.name}
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
                items={allPeople.toSorted((a, b) => a.name.localeCompare(b.name)).map(p => ({ id: p.id!, name: p.name }))}
                selectedIds={assignedPeopleIds}
                onToggle={onTogglePerson}
                onCreate={onCreatePerson}
                placeholder="Search people..."
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
        rowClassName={styles.metaRow}
        labelClassName={styles.metaLabel}
      />
    </div>
  )
}
