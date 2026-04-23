import type { Person, Org, Tag, RecurrenceType, PersistedTodoItem } from '../../models'
import type { ScheduledValue } from '../../models/scheduled-value'
import { ChipSelector } from '../shared/ChipSelector'
import { SchedulePicker } from '../shared/SchedulePicker'
import { DeadlinePicker } from '../shared/DeadlinePicker'
import { scheduledLabel } from '../../utils/effective-date'
import { formatDate, startOfToday } from '../../utils/date'
import { useOrgStore } from '../../stores/org-store'
import { resolvePersonColor } from '../../utils/person-color'
import styles from './TaskEditPopup.module.css'

interface TaskEditMetadataProps {
  // Scheduled + Deadline
  scheduledDate: ScheduledValue | null
  deadline: Date | null
  recurrenceType: RecurrenceType | ''
  onScheduledChange: (next: ScheduledValue | null) => void
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

  // People & Orgs
  assignedPeople: Person[]
  assignedOrgs: Org[]
  assignedTags: Tag[]
  allPeople: Person[]
  allOrgs: Org[]
  allTags: Tag[]
  assignedPeopleIds: Set<number>
  assignedOrgIds: Set<number>
  assignedTagIds: Set<number>
  isEdit: boolean
  peopleRef: React.RefObject<HTMLDivElement | null>
  orgsRef: React.RefObject<HTMLDivElement | null>
  tagsRef: React.RefObject<HTMLDivElement | null>
  onTogglePerson: (id: number) => void
  onToggleOrg: (id: number) => void
  onToggleTag: (id: number) => void
  onCreatePerson?: (name: string) => Promise<void>
  onCreateTag?: (name: string) => Promise<void>

  // Dropdown state
  openDropdown: 'people' | 'orgs' | 'project' | 'tags' | null
  setOpenDropdown: (dd: 'people' | 'orgs' | 'project' | 'tags' | null) => void

  // For project select save in edit mode
  todo?: PersistedTodoItem
  onUpdate?: (todo: PersistedTodoItem) => void
}

export function TaskEditMetadata({
  scheduledDate, deadline, recurrenceType,
  onScheduledChange, onDeadlineChange, onRecurrenceChange,
  projectId, projects, projectSearch, projectRef, projectSearchRef,
  onProjectSelect, onProjectSearchChange,
  assignedPeople, assignedOrgs, assignedTags, allPeople, allOrgs, allTags,
  assignedPeopleIds, assignedOrgIds, assignedTagIds, isEdit,
  peopleRef, orgsRef, tagsRef,
  onTogglePerson, onToggleOrg, onToggleTag,
  onCreatePerson, onCreateTag,
  openDropdown, setOpenDropdown,
  todo, onUpdate,
}: TaskEditMetadataProps) {
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const orgs = useOrgStore((s) => s.orgs)
  return (
    <div className={styles.metaSection}>
      {/* Scheduled */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Scheduled</span>
        <SchedulePicker value={scheduledDate} onChange={onScheduledChange} />
      </div>

      {/* Deadline */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>Deadline</span>
        <DeadlinePicker value={deadline} onChange={onDeadlineChange} />
        {(deadline || (scheduledDate && scheduledDate.kind === 'date')) && (
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

      {/* Combined helper line — shown only when both are set */}
      {scheduledDate && deadline && (
        <div className={styles.scheduleHint}>
          Deadline {formatDate(deadline)} — scheduled {scheduledLabel(scheduledDate, startOfToday()).toLowerCase()}
        </div>
      )}

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

      {/* People & Orgs */}
      <div className={styles.metaRow}>
        <span className={styles.metaLabel}>People</span>
        <div className={styles.chipArea} ref={peopleRef}>
          {assignedPeople.map((person) => {
            const derived = resolvePersonColor(person.id, personOrgMap, orgs)
            return (
            <button key={`p-${person.id}`} className={styles.personTag}
              style={derived ? { color: derived, borderColor: derived } : undefined}
              onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
              @{person.name}
              <span className={styles.chipRemove} onClick={(e) => { e.stopPropagation(); onTogglePerson(person.id!) }}>&times;</span>
            </button>
          )})}
          {assignedOrgs.map((org) => (
            <button key={`o-${org.id}`} className={styles.orgChip} style={org.color ? { borderColor: org.color, color: org.color } : undefined}
              onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
              {org.name}
              <span className={styles.chipRemove} onClick={(e) => { e.stopPropagation(); onToggleOrg(org.id!) }}>&times;</span>
            </button>
          ))}
          <button className={styles.chipAddBtn}
            onClick={() => setOpenDropdown(openDropdown === 'people' ? null : 'people')}>
            + Add
          </button>
          {openDropdown === 'people' && (
            <div className={styles.chipDropdown} ref={orgsRef}>
              <ChipSelector
                items={[
                  ...allPeople.toSorted((a, b) => a.name.localeCompare(b.name)).map(p => ({ id: p.id!, name: p.name })),
                  ...allOrgs.toSorted((a, b) => a.name.localeCompare(b.name)).map(o => ({ id: -o.id!, name: o.name, color: o.color })),
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

    </div>
  )
}
