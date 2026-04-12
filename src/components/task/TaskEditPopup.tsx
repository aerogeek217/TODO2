import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { TodoItem, PersistedTodoItem, Person, Tag, Org, RecurrenceType } from '../../models'
import { Priority } from '../../models'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { PriorityMenu, getPriorityLabel } from '../shared/PriorityMenu'
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { toDateInputValue } from '../../utils/date'
import { makeRecurrenceRule } from '../../services/recurrence'
import { TaskEditHeader } from './TaskEditHeader'
import { TaskEditMetadata } from './TaskEditMetadata'
import { TaskEditFooter } from './TaskEditFooter'
import styles from './TaskEditPopup.module.css'

interface TaskEditPopupBaseProps {
  assignedPeople: Person[]
  allPeople: Person[]
  assignedTags?: Tag[]
  allTags?: Tag[]
  assignedOrgs?: Org[]
  allOrgs?: Org[]
  onClose: () => void
  onAssignPerson: (personId: number) => void
  onUnassignPerson: (personId: number) => void
  onAssignTag?: (tagId: number) => void
  onUnassignTag?: (tagId: number) => void
  onAssignOrg?: (orgId: number) => void
  onUnassignOrg?: (orgId: number) => void
  onCreatePerson?: (name: string) => Promise<number>
  onCreateTag?: (name: string) => Promise<number>
  onCreateOrg?: (name: string) => Promise<number>
}

interface EditModeProps extends TaskEditPopupBaseProps {
  mode: 'edit'
  todo: PersistedTodoItem
  onUpdate: (todo: PersistedTodoItem) => void
  onToggleComplete: () => void
  onToggleStar: () => void
  onDelete: () => void
  onDuplicate?: () => void
  onCreate?: never
}

interface CreateModeProps extends TaskEditPopupBaseProps {
  mode: 'create'
  todo?: never
  onUpdate?: never
  onToggleComplete?: never
  onToggleStar?: never
  onDelete?: never
  onCreate: (todo: Partial<TodoItem>, assignments?: { personIds: number[], tagIds: number[], orgIds: number[] }) => Promise<number>
}

type TaskEditPopupProps = EditModeProps | CreateModeProps

export function TaskEditPopup(props: TaskEditPopupProps) {
  const {
    mode, allPeople, assignedPeople, assignedTags = [], allTags = [],
    assignedOrgs = [], allOrgs = [],
    onClose, onAssignPerson, onUnassignPerson, onAssignTag, onUnassignTag,
    onAssignOrg, onUnassignOrg, onCreatePerson, onCreateTag,
  } = props

  const isEdit = mode === 'edit'
  const todo = isEdit ? props.todo : undefined

  const projects = useProjectStore((s) => s.projects)
  const defaultProjectId = useSettingsStore((s) => s.defaultProjectId)
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const statuses = useStatusStore((s) => s.statuses)

  const [title, setTitle] = useState(todo?.title ?? '')
  const [notes, setNotes] = useState(todo?.notes ?? '')
  const [progress, setProgress] = useState(todo?.progress ?? '')
  const [statusId, setStatusId] = useState<number | undefined>(
    todo?.statusId ?? (mode === 'create' ? (defaultStatusId ?? undefined) : undefined)
  )
  const [dueDate, setDueDate] = useState(toDateInputValue(todo?.dueDate))
  const [isHardDeadline, setIsHardDeadline] = useState(todo?.isHardDeadline ?? false)
  const [priority, setPriorityState] = useState<Priority>(todo?.priority ?? Priority.Normal)
  const [isStarred, setIsStarred] = useState(todo?.isStarred ?? false)
  const [isAssigned, setIsAssigned] = useState(todo?.isAssigned ?? false)
  const [projectId, setProjectId] = useState<number | undefined>(
    todo?.projectId ?? (mode === 'create' ? (defaultProjectId ?? undefined) : undefined)
  )
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | ''>(
    todo?.recurrenceRule?.type ?? ''
  )
  // Local state for create mode assignments (no todoId exists yet)
  const [pendingPersonIds, setPendingPersonIds] = useState<Set<number>>(new Set())
  const [pendingTagIds, setPendingTagIds] = useState<Set<number>>(new Set())
  const [pendingOrgIds, setPendingOrgIds] = useState<Set<number>>(new Set())

  const effectiveAssignedPeople = mode === 'create'
    ? allPeople.filter(p => pendingPersonIds.has(p.id!))
    : assignedPeople
  const effectiveAssignedTags = mode === 'create'
    ? allTags.filter(t => pendingTagIds.has(t.id!))
    : assignedTags
  const effectiveAssignedOrgs = mode === 'create'
    ? allOrgs.filter(o => pendingOrgIds.has(o.id!))
    : assignedOrgs

  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'people' | 'tags' | 'orgs' | 'project' | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const orgsRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)
  const projectSearchRef = useRef<HTMLInputElement>(null)
  const priorityRef = useRef<HTMLDivElement>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const acPeople = useMemo(() => allPeople.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'person' as const })), [allPeople])
  const acTags = useMemo(() => allTags.map((t) => ({ id: t.id!, name: t.name, color: t.color, kind: 'tag' as const })), [allTags])
  const acProjects = useMemo(() => projects.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'project' as const })), [projects])
  const acOrgs = useMemo(() => allOrgs.map((o) => ({ id: o.id!, name: o.name, color: o.color, kind: 'org' as const })), [allOrgs])
  const ac = useNlpAutocomplete({ people: acPeople, tags: acTags, projects: acProjects, orgs: acOrgs })

  useEffect(() => {
    if (!isEdit) titleRef.current?.focus()
  }, [isEdit])

  useEffect(() => {
    if (openDropdown === 'project') projectSearchRef.current?.focus()
  }, [openDropdown])

  // Sync state when todo changes externally (edit mode)
  useEffect(() => {
    if (todo) {
      setTitle(todo.title)
      setNotes(todo.notes ?? '')
      setProgress(todo.progress ?? '')
      setStatusId(todo.statusId ?? undefined)
      setProjectId(todo.projectId)
      setDueDate(toDateInputValue(todo.dueDate))
      setIsHardDeadline(todo.isHardDeadline ?? false)
      setPriorityState(todo.priority)
      setIsStarred(todo.isStarred)
      setIsAssigned(todo.isAssigned ?? false)
      setRecurrenceType(todo.recurrenceRule?.type ?? '')
    }
  }, [todo?.id, todo?.title, todo?.notes, todo?.progress, todo?.statusId, todo?.projectId, todo?.dueDate, todo?.isHardDeadline, todo?.priority, todo?.isStarred, todo?.isAssigned, todo?.recurrenceRule?.type])

  // Auto-clear isAssigned when all people and orgs are removed
  useEffect(() => {
    if (isAssigned && effectiveAssignedPeople.length === 0 && effectiveAssignedOrgs.length === 0) {
      setIsAssigned(false)
      if (isEdit && todo) props.onUpdate({ ...todo, isAssigned: undefined })
    }
  }, [effectiveAssignedPeople.length, effectiveAssignedOrgs.length])

  // Track whether mousedown started on the backdrop itself.
  // Prevents closing when user selects text inside and drags outside.
  const mouseDownOnBackdropRef = useRef(false)
  const handleBackdropMouseDown = (e: React.MouseEvent) => {
    mouseDownOnBackdropRef.current = e.target === e.currentTarget
  }
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && mouseDownOnBackdropRef.current) onClose()
  }

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        ;(e.target as HTMLElement).blur()
        e.stopPropagation()
      } else {
        onClose()
      }
    }
  }, [onClose])

  const buildRule = useCallback(() => {
    return recurrenceType ? makeRecurrenceRule(recurrenceType, dueDate ? new Date(dueDate + 'T00:00:00') : null) : undefined
  }, [recurrenceType, dueDate])

  const saveEdit = useCallback((overrides: Partial<TodoItem> = {}) => {
    if (!isEdit || !todo) return
    props.onUpdate({
      ...todo,
      title: title.trim() || todo.title,
      notes: notes || undefined,
      progress: progress || undefined,
      statusId,
      dueDate: dueDate ? new Date(dueDate + 'T00:00:00') : undefined,
      isHardDeadline: isHardDeadline || undefined,
      isAssigned: isAssigned || undefined,
      recurrenceRule: dueDate ? buildRule() : undefined,
      priority,
      isStarred,
      ...overrides,
    })
  }, [isEdit, todo, title, notes, progress, statusId, dueDate, isHardDeadline, isAssigned, recurrenceType, priority, isStarred, props.onUpdate])

  const handleTitleBlur = () => { if (isEdit) saveEdit() }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value)
    ac.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)
  }

  const handleAcSelect = (item: AutocompleteItem) => {
    const input = titleRef.current
    if (!input) return
    const result = ac.applySelection(input.value, input.selectionStart ?? input.value.length, item)
    if (result) {
      setTitle(result.value)
      requestAnimationFrame(() => {
        input.setSelectionRange(result.cursor, result.cursor)
        input.focus()
      })
    }
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ac.state.visible) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        ac.handleKeyDown(e)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && ac.state.items.length > 0)) {
        e.preventDefault()
        const input = titleRef.current
        if (input) {
          const result = ac.applySelection(input.value, input.selectionStart ?? input.value.length)
          if (result) {
            setTitle(result.value)
            requestAnimationFrame(() => {
              input.setSelectionRange(result.cursor, result.cursor)
              input.focus()
            })
          }
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        ac.dismiss()
        return
      }
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'create') handleCreate()
      else titleRef.current?.blur()
    }
    if (e.key === 'Escape') titleRef.current?.blur()
  }

  const handleNotesBlur = () => { if (isEdit) saveEdit() }

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = e.target.value
    setDueDate(newDate)
    if (!newDate) setRecurrenceType('')
    if (isEdit && todo) {
      props.onUpdate({
        ...todo,
        title: title.trim() || todo.title,
        notes: notes || undefined,
        dueDate: newDate ? new Date(newDate + 'T00:00:00') : undefined,
        isHardDeadline: isHardDeadline || undefined,
        recurrenceRule: newDate && recurrenceType ? makeRecurrenceRule(recurrenceType, new Date(newDate + 'T00:00:00')) : undefined,
      })
    }
  }

  const handleRecurrenceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as RecurrenceType | ''
    setRecurrenceType(val)
    if (isEdit && todo) {
      const dueDateObj = dueDate ? new Date(dueDate + 'T00:00:00') : null
      props.onUpdate({
        ...todo,
        title: title.trim() || todo.title,
        notes: notes || undefined,
        dueDate: dueDateObj ?? undefined,
        isHardDeadline: isHardDeadline || undefined,
        recurrenceRule: val ? makeRecurrenceRule(val, dueDateObj) : undefined,
      })
    }
  }

  const handleToggleHardDeadline = () => {
    const next = !isHardDeadline
    setIsHardDeadline(next)
    if (isEdit && todo) {
      props.onUpdate({
        ...todo,
        title: title.trim() || todo.title,
        notes: notes || undefined,
        dueDate: dueDate ? new Date(dueDate + 'T00:00:00') : undefined,
        isHardDeadline: next || undefined,
      })
    }
  }

  const handleSetPriority = (p: Priority) => {
    setPriorityState(p)
    setShowPriorityMenu(false)
    if (isEdit && todo) {
      props.onUpdate({ ...todo, priority: p })
    }
  }

  const handleToggleStar = () => {
    const next = !isStarred
    setIsStarred(next)
    if (isEdit) props.onToggleStar()
  }

  const handleToggleComplete = () => {
    if (isEdit) props.onToggleComplete()
  }

  const handleCreate = async () => {
    if (mode !== 'create' || !title.trim()) return
    const newTodoId = await props.onCreate({
      title: title.trim(),
      notes: notes || undefined,
      progress: progress || undefined,
      statusId,
      dueDate: dueDate ? new Date(dueDate + 'T00:00:00') : undefined,
      isHardDeadline: isHardDeadline || undefined,
      recurrenceRule: dueDate && recurrenceType ? makeRecurrenceRule(recurrenceType, new Date(dueDate + 'T00:00:00')) : undefined,
      priority,
      isStarred,
      isAssigned: isAssigned || undefined,
      projectId,
    }, {
      personIds: [...pendingPersonIds],
      tagIds: [...pendingTagIds],
      orgIds: [...pendingOrgIds],
    })
    void newTodoId
    onClose()
  }

  const handleToggleAssigned = () => {
    const next = !isAssigned
    setIsAssigned(next)
    saveEdit({ isAssigned: next || undefined })
  }

  const handleCreatePerson = onCreatePerson ? async (name: string) => {
    const id = await onCreatePerson(name)
    if (mode === 'create') {
      setPendingPersonIds(prev => new Set([...prev, id]))
    } else {
      onAssignPerson(id)
    }
  } : undefined

  const handleCreateTag = (onCreateTag && onAssignTag) ? async (name: string) => {
    const id = await onCreateTag(name)
    if (mode === 'create') {
      setPendingTagIds(prev => new Set([...prev, id]))
    } else {
      onAssignTag(id)
    }
  } : undefined

  const togglePerson = (id: number) => {
    if (mode === 'create') {
      setPendingPersonIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      return
    }
    const assigned = assignedPeople.some((p) => p.id === id)
    if (assigned) onUnassignPerson(id)
    else onAssignPerson(id)
  }

  const toggleTag = (id: number) => {
    if (mode === 'create') {
      setPendingTagIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      return
    }
    if (!onAssignTag || !onUnassignTag) return
    const assigned = assignedTags.some((t) => t.id === id)
    if (assigned) onUnassignTag(id)
    else onAssignTag(id)
  }

  const toggleOrg = (id: number) => {
    if (mode === 'create') {
      setPendingOrgIds(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id); else next.add(id)
        return next
      })
      return
    }
    if (!onAssignOrg || !onUnassignOrg) return
    const isAssignedOrg = assignedOrgs.some((o) => o.id === id)
    if (isAssignedOrg) onUnassignOrg(id)
    else onAssignOrg(id)
  }

  const assignedPeopleIds = useMemo(() => new Set(effectiveAssignedPeople.map(p => p.id!)), [effectiveAssignedPeople])
  const assignedTagIds = useMemo(() => new Set(effectiveAssignedTags.map(t => t.id!)), [effectiveAssignedTags])
  const assignedOrgIds = useMemo(() => new Set(effectiveAssignedOrgs.map(o => o.id!)), [effectiveAssignedOrgs])

  const priorityBadgeClass =
    priority === Priority.High
      ? styles.badgePriorityHigh
      : priority === Priority.Medium
        ? styles.badgePriorityMedium
        : styles.badgePriorityNormal

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (openDropdown === 'people' && peopleRef.current && !peopleRef.current.contains(target)) {
        setOpenDropdown(null)
      }
      if (openDropdown === 'tags' && tagsRef.current && !tagsRef.current.contains(target)) {
        setOpenDropdown(null)
      }
      if (openDropdown === 'orgs' && orgsRef.current && !orgsRef.current.contains(target)) {
        setOpenDropdown(null)
      }
      if (openDropdown === 'project' && projectRef.current && !projectRef.current.contains(target)) {
        setOpenDropdown(null)
        setProjectSearch('')
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [openDropdown])

  // Close priority menu on outside click
  useEffect(() => {
    if (!showPriorityMenu) return
    const handler = (e: MouseEvent) => {
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) {
        setShowPriorityMenu(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [showPriorityMenu])

  // Close status menu on outside click
  useEffect(() => {
    if (!showStatusMenu) return
    const handler = (e: MouseEvent) => {
      if (statusMenuRef.current && !statusMenuRef.current.contains(e.target as Node)) {
        setShowStatusMenu(false)
      }
    }
    document.addEventListener('mousedown', handler, true)
    return () => document.removeEventListener('mousedown', handler, true)
  }, [showStatusMenu])

  return (
    <div className={styles.backdrop} onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className={styles.card}>
        <TaskEditHeader
          isEdit={isEdit}
          isCompleted={todo?.isCompleted}
          title={title}
          isStarred={isStarred}
          mode={mode}
          titleRef={titleRef}
          onToggleComplete={handleToggleComplete}
          onTitleChange={handleTitleChange}
          onTitleBlur={handleTitleBlur}
          onTitleKeyDown={handleTitleKeyDown}
          onToggleStar={handleToggleStar}
          onClose={onClose}
          acState={ac.state}
          onAcSelect={handleAcSelect}
        />

        {/* Priority & Status badges */}
        <div className={styles.badges}>
          <div className={styles.priorityWrapper} ref={priorityRef}>
            <button
              className={`${styles.badge} ${priorityBadgeClass}`}
              onClick={() => setShowPriorityMenu((v) => !v)}
            >
              {getPriorityLabel(priority)} &#x25BE;
            </button>
            {showPriorityMenu && (
              <PriorityMenu currentPriority={priority} onSelect={handleSetPriority} />
            )}
          </div>
          {statuses.length > 0 && (
            <div className={styles.priorityWrapper} ref={statusMenuRef}>
              <button
                className={styles.badge}
                onClick={() => setShowStatusMenu((v) => !v)}
              >
                {statusId ? (
                  <><span className={styles.statusBadgeDot} style={{ background: statuses.find(s => s.id === statusId)?.color }} />{statuses.find(s => s.id === statusId)?.name ?? 'Status'}</>
                ) : (
                  'Status'
                )}
                {' '}&#x25BE;
              </button>
              {showStatusMenu && (
                <div className={styles.statusMenu}>
                  <button
                    className={`${styles.statusOption} ${!statusId ? styles.statusOptionActive : ''}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setStatusId(undefined)
                      setShowStatusMenu(false)
                      if (isEdit && todo) props.onUpdate({ ...todo, statusId: undefined, modifiedAt: new Date() })
                    }}
                  >
                    <span className={styles.statusBadgeDot} style={{ background: 'var(--color-text-muted)' }} />
                    No Status
                  </button>
                  {statuses.map(s => (
                    <button
                      key={s.id}
                      className={`${styles.statusOption} ${statusId === s.id ? styles.statusOptionActive : ''}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setStatusId(s.id)
                        setShowStatusMenu(false)
                        if (isEdit && todo) props.onUpdate({ ...todo, statusId: s.id, modifiedAt: new Date() })
                      }}
                    >
                      <span className={styles.statusBadgeDot} style={{ background: s.color }} />
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={`${styles.scrollBody} ${openDropdown ? styles.scrollBodyDropdownOpen : ''}`}>
          <TaskEditMetadata
            dueDate={dueDate}
            recurrenceType={recurrenceType}
            isHardDeadline={isHardDeadline}
            dateRef={dateRef}
            onDateChange={handleDateChange}
            onRecurrenceChange={handleRecurrenceChange}
            onToggleHardDeadline={handleToggleHardDeadline}
            projectId={projectId}
            projects={projects}
            projectSearch={projectSearch}
            projectRef={projectRef}
            projectSearchRef={projectSearchRef}
            onProjectSelect={setProjectId}
            onProjectSearchChange={setProjectSearch}
            assignedPeople={effectiveAssignedPeople}
            assignedOrgs={effectiveAssignedOrgs}
            allPeople={allPeople}
            allOrgs={allOrgs}
            assignedPeopleIds={assignedPeopleIds}
            assignedOrgIds={assignedOrgIds}
            isEdit={isEdit}
            isAssigned={isAssigned}
            peopleRef={peopleRef}
            orgsRef={orgsRef}
            onTogglePerson={togglePerson}
            onToggleOrg={toggleOrg}
            onToggleAssigned={handleToggleAssigned}
            onCreatePerson={handleCreatePerson}
            assignedTags={effectiveAssignedTags}
            allTags={allTags}
            assignedTagIds={assignedTagIds}
            tagsRef={tagsRef}
            onToggleTag={toggleTag}
            onAssignTag={onAssignTag}
            onCreateTag={handleCreateTag}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            todo={todo}
            onUpdate={isEdit ? props.onUpdate : undefined}
          />

          {/* Status Notes */}
          <div className={styles.notesSection}>
            <div className={styles.notesLabel}>Status Notes</div>
            <input
              className={styles.metaInput}
              value={progress}
              maxLength={500}
              onChange={(e) => setProgress(e.target.value)}
              onBlur={() => { if (isEdit) saveEdit() }}
              placeholder="e.g. 50% done, Waiting on review..."
            />
          </div>

          {/* Notes */}
          <div className={styles.notesSection}>
            <div className={styles.notesLabel}>Notes</div>
            <textarea
              className={styles.notesTextarea}
              value={notes}
              maxLength={50000}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Add notes..."
            />
          </div>
        </div>

        {isEdit && todo ? (
          <TaskEditFooter mode="edit" todo={todo} onDelete={props.onDelete} onDuplicate={props.onDuplicate} onClose={onClose} />
        ) : (
          <TaskEditFooter mode="create" onClose={onClose} onCreate={handleCreate} titleValid={!!title.trim()} />
        )}
      </div>
    </div>
  )
}
