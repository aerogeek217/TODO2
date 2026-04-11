import type { Person, Tag, Org, RecurrenceType, PersistedTodoItem } from '../../models'
import { ChipSelector } from '../shared/ChipSelector'
import styles from './TaskEditPopup.module.css'

interface TaskEditMetadataProps {
  // Due date
  dueDate: string
  recurrenceType: RecurrenceType | ''
  isHardDeadline: boolean
  dateRef: React.RefObject<HTMLInputElement | null>
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  onRecurrenceChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
  onToggleHardDeadline: () => void

  // Project
  projectId: number | undefined
  projects: { id?: number; name: string; color?: string }[]
  projectSearch: string
  projectRef: React.RefObject<HTMLDivElement | null>
  projectSearchRef: React.RefObject<HTMLInputElement | null>
  onProjectSelect: (id: number | undefined) => void
  onProjectSearchChange: (search: string) => void

  // People & Orgs
  assignedPeople: Person[]
  assignedOrgs: Org[]
  allPeople: Person[]
  allOrgs: Org[]
  assignedPeopleIds: Set<number>
  assignedOrgIds: Set<number>
  isEdit: boolean
  isAssigned: boolean
  peopleRef: React.RefObject<HTMLDivElement | null>
  orgsRef: React.RefObject<HTMLDivElement | null>
  onTogglePerson: (id: number) => void
  onToggleOrg: (id: number) => void
  onToggleAssigned: () => void
  onCreatePerson?: (name: string) => Promise<void>

  // Tags
  assignedTags: Tag[]
  allTags: Tag[]
  assignedTagIds: Set<number>
  tagsRef: React.RefObject<HTMLDivElement | null>
  onToggleTag: (id: number) => void
  onAssignTag?: (tagId: number) => void
  onCreateTag?: (name: string) => Promise<void>

  // Dropdown state
  openDropdown: 'people' | 'tags' | 'orgs' | 'project' | null
  setOpenDropdown: (dd: 'people' | 'tags' | 'orgs' | 'project' | null) => void

  // For project select save in edit mode
  todo?: PersistedTodoItem
  onUpdate?: (todo: PersistedTodoItem) => void
}

export function TaskEditMetadata({
  dueDate, recurrenceType, isHardDeadline, dateRef,
  onDateChange, onRecurrenceChange, onToggleHardDeadline,
  projectId, projects, projectSearch, projectRef, projectSearchRef,
  onProjectSelect, onProjectSearchChange,
  assignedPeople, assignedOrgs, allPeople, allOrgs,
  assignedPeopleIds, assignedOrgIds, isEdit, isAssigned,
  peopleRef, orgsRef, onTogglePerson, onToggleOrg, onToggleAssigned, onCreatePerson,
  assignedTags, allTags, assignedTagIds, tagsRef, onToggleTag, onAssignTag, onCreateTag,
  openDropdown, setOpenDropdown,
  todo, onUpdate,
}: TaskEditMetadataProps) {
  return (
    <div className={styles.metaSection}>
      {/* Due date */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Due date</span>
        <input
          ref={dateRef}
          type="date"
          className={styles.metaInput}
          value={dueDate}
          onChange={onDateChange}
          onMouseDown={(e) => {
            e.preventDefault()
            try { dateRef.current?.showPicker() } catch {}
          }}
        />
        {dueDate && (
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
        {dueDate && (
          <button
            className={`${styles.hardDeadlineBtn} ${isHardDeadline ? styles.hardDeadlineActive : ''}`}
            onClick={onToggleHardDeadline}
            title={isHardDeadline ? 'Hard deadline (click to make soft)' : 'Soft date (click to make hard deadline)'}
          >
            {isHardDeadline ? '⚑' : '⚐'}
          </button>
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

      {/* People & Orgs */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>People</span>
        <div className={styles.chipArea} ref={peopleRef}>
          {assignedPeople.map((person) => (
            <button key={`p-${person.id}`} className={styles.personTag}
              style={person.color ? { color: person.color, borderColor: person.color } : undefined}
              onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
              @{person.name}
            </button>
          ))}
          {assignedOrgs.map((org) => (
            <button key={`o-${org.id}`} className={styles.orgChip} style={org.color ? { borderColor: org.color, color: org.color } : undefined}
              onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
              {org.name}
            </button>
          ))}
          <button className={styles.chipAddBtn}
            onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
            + Add
          </button>
          {isEdit && (assignedPeople.length > 0 || assignedOrgs.length > 0) && (
            <button
              className={`${styles.assignedToggle} ${isAssigned ? styles.assignedToggleActive : ''}`}
              onClick={onToggleAssigned}
            >
              {isAssigned ? 'Assigned' : 'Assign'}
            </button>
          )}
          {openDropdown === 'people' && (
            <div className={styles.chipDropdown} ref={orgsRef}>
              <ChipSelector
                items={[
                  ...allPeople.map(p => ({ id: p.id!, name: p.name })),
                  ...allOrgs.map(o => ({ id: -o.id!, name: o.name, color: o.color })),
                ]}
                selectedIds={(() => {
                  const ids = new Set(assignedPeopleIds)
                  for (const oid of assignedOrgIds) ids.add(-oid)
                  return ids
                })()}
                onToggle={(id) => id < 0 ? onToggleOrg(-id) : onTogglePerson(id)}
                onCreate={onCreatePerson}
                placeholder="Search people & orgs..."
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
            <button key={tag.id} className={styles.tagChip} style={{ borderColor: tag.color, color: tag.color }}
              onClick={() => setOpenDropdown(openDropdown === 'tags' ? null : 'tags')}>
              {tag.name}
            </button>
          ))}
          {onAssignTag && (
            <button className={styles.chipAddBtn}
              onClick={() => setOpenDropdown(openDropdown === 'tags' ? null : 'tags')}>
              + Add
            </button>
          )}
          {openDropdown === 'tags' && (
            <div className={styles.chipDropdown}>
              <ChipSelector
                items={allTags.map(t => ({ id: t.id!, name: t.name, color: t.color }))}
                selectedIds={assignedTagIds}
                onToggle={onToggleTag}
                onCreate={onCreateTag}
                placeholder="Search tags..."
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
