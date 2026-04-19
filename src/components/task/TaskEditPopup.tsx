import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { TodoItem, PersistedTodoItem, Person, Org, RecurrenceType } from '../../models'
import { AppView } from '../../models'
import type { ScheduledValue } from '../../models/scheduled-value'
import { useProjectStore } from '../../stores/project-store'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useFilterStore } from '../../stores/filter-store'
import { getFilterDefaults } from '../../utils/filter-defaults'
import { StatusIcon } from '../shared/StatusIcon'
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { makeRecurrenceRule } from '../../services/recurrence'
import { TaskEditHeader } from './TaskEditHeader'
import { TaskEditMetadata } from './TaskEditMetadata'
import { TaskEditFooter } from './TaskEditFooter'
import { NotesBody, type NotesSource } from '../shared/notes/NotesBody'
import styles from './TaskEditPopup.module.css'

interface TaskEditPopupBaseProps {
  assignedPeople: Person[]
  allPeople: Person[]
  assignedOrgs?: Org[]
  allOrgs?: Org[]
  onClose: () => void
  onAssignPerson: (personId: number) => void
  onUnassignPerson: (personId: number) => void
  onAssignOrg?: (orgId: number) => void
  onUnassignOrg?: (orgId: number) => void
  onCreatePerson?: (name: string) => Promise<number>
  onCreateOrg?: (name: string) => Promise<number>
}

interface EditModeProps extends TaskEditPopupBaseProps {
  mode: 'edit'
  todo: PersistedTodoItem
  onUpdate: (todo: PersistedTodoItem) => void
  onToggleComplete: () => void
  onDelete: () => void
  onDuplicate?: () => void
  onCreate?: never
}

interface CreateModeProps extends TaskEditPopupBaseProps {
  mode: 'create'
  todo?: never
  onUpdate?: never
  onToggleComplete?: never
  onDelete?: never
  onCreate: (todo: Partial<TodoItem>, assignments?: { personIds: number[], orgIds: number[] }) => Promise<number>
}

type TaskEditPopupProps = EditModeProps | CreateModeProps

export function TaskEditPopup(props: TaskEditPopupProps) {
  const {
    mode, allPeople, assignedPeople,
    assignedOrgs = [], allOrgs = [],
    onClose, onAssignPerson, onUnassignPerson,
    onAssignOrg, onUnassignOrg, onCreatePerson,
  } = props

  const isEdit = mode === 'edit'
  const todo = isEdit ? props.todo : undefined

  const projects = useProjectStore((s) => s.projects)
  const defaultProjectId = useSettingsStore((s) => s.defaultProjectId)
  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const statuses = useStatusStore((s) => s.statuses)

  // Compute filter defaults once for create mode (views with filter UI only)
  const filterDefaults = useMemo(() => {
    if (mode !== 'create') return null
    const activeView = useUIStore.getState().activeView
    if (activeView === AppView.Dashboard || activeView === AppView.Settings) return null
    return getFilterDefaults(useFilterStore.getState().filters)
  }, [mode])

  const [title, setTitle] = useState(todo?.title ?? '')
  const [notes, setNotes] = useState(todo?.notes ?? '')
  const notesRef = useRef<string>(todo?.notes ?? '')
  const [progress, setProgress] = useState(todo?.progress ?? '')
  const [statusId, setStatusId] = useState<number | undefined>(
    todo?.statusId ?? (mode === 'create' ? (defaultStatusId ?? filterDefaults?.statusId ?? undefined) : undefined)
  )
  const [scheduledDate, setScheduledDate] = useState<ScheduledValue | null>(todo?.scheduledDate ?? null)
  const [deadline, setDeadline] = useState<Date | null>(todo?.dueDate ?? null)
  const [projectId, setProjectId] = useState<number | undefined>(
    todo?.projectId ?? (mode === 'create' ? (defaultProjectId ?? undefined) : undefined)
  )
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | ''>(
    todo?.recurrenceRule?.type ?? ''
  )
  // Local state for create mode assignments (no todoId exists yet)
  const [pendingPersonIds, setPendingPersonIds] = useState<Set<number>>(() => new Set(filterDefaults?.personIds ?? []))
  const [pendingOrgIds, setPendingOrgIds] = useState<Set<number>>(() => new Set(filterDefaults?.orgIds ?? []))

  const effectiveAssignedPeople = mode === 'create'
    ? allPeople.filter(p => pendingPersonIds.has(p.id!))
    : assignedPeople
  const effectiveAssignedOrgs = mode === 'create'
    ? allOrgs.filter(o => pendingOrgIds.has(o.id!))
    : assignedOrgs

  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'people' | 'orgs' | 'project' | null>(null)
  const [projectSearch, setProjectSearch] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const orgsRef = useRef<HTMLDivElement>(null)
  const projectRef = useRef<HTMLDivElement>(null)
  const projectSearchRef = useRef<HTMLInputElement>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const acPeople = useMemo(() => allPeople.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'person' as const })), [allPeople])
  const acProjects = useMemo(() => projects.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'project' as const })), [projects])
  const acOrgs = useMemo(() => allOrgs.map((o) => ({ id: o.id!, name: o.name, color: o.color, kind: 'org' as const })), [allOrgs])
  const ac = useNlpAutocomplete({ people: acPeople, projects: acProjects, orgs: acOrgs })

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
      notesRef.current = todo.notes ?? ''
      setProgress(todo.progress ?? '')
      setStatusId(todo.statusId ?? undefined)
      setProjectId(todo.projectId)
      setScheduledDate(todo.scheduledDate ?? null)
      setDeadline(todo.dueDate ?? null)
      setRecurrenceType(todo.recurrenceRule?.type ?? '')
    }
  }, [todo?.id, todo?.title, todo?.notes, todo?.progress, todo?.statusId, todo?.projectId, todo?.scheduledDate, todo?.dueDate, todo?.recurrenceRule?.type])

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
    if (!recurrenceType) return undefined
    if (deadline) return makeRecurrenceRule(recurrenceType, deadline)
    if (scheduledDate && scheduledDate.kind === 'date') {
      return makeRecurrenceRule(recurrenceType, scheduledDate.value)
    }
    return undefined
  }, [recurrenceType, deadline, scheduledDate])

  const saveEdit = useCallback((overrides: Partial<TodoItem> = {}) => {
    if (!isEdit || !todo) return
    props.onUpdate({
      ...todo,
      title: title.trim() || todo.title,
      notes: notes || undefined,
      progress: progress || undefined,
      statusId,
      scheduledDate: scheduledDate ?? undefined,
      dueDate: deadline ?? undefined,
      recurrenceRule: buildRule(),
      ...overrides,
    })
  }, [isEdit, todo, title, notes, progress, statusId, scheduledDate, deadline, buildRule, props])

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

  const todoRef = useRef(todo)
  todoRef.current = todo
  const onUpdateRef = useRef(isEdit ? props.onUpdate : undefined)
  onUpdateRef.current = isEdit ? props.onUpdate : undefined

  const notesSource = useMemo<NotesSource>(() => ({
    get: () => notesRef.current,
    set: (next) => {
      notesRef.current = next
      setNotes(next)
      const current = todoRef.current
      const update = onUpdateRef.current
      if (current && update) {
        update({
          ...current,
          notes: next ? next : undefined,
          modifiedAt: new Date(),
        })
      }
    },
  }), [])

  const handleScheduledChange = (next: ScheduledValue | null) => {
    setScheduledDate(next)
    // Recurrence is anchored to deadline first, then to a precise scheduled date.
    // If no anchor remains after this change, drop the rule.
    const stillAnchored = !!deadline || (next?.kind === 'date')
    if (!stillAnchored) setRecurrenceType('')
    if (isEdit && todo) {
      const nextRule: typeof todo.recurrenceRule = (() => {
        if (!recurrenceType) return undefined
        if (deadline) return makeRecurrenceRule(recurrenceType, deadline)
        if (next?.kind === 'date') return makeRecurrenceRule(recurrenceType, next.value)
        return undefined
      })()
      props.onUpdate({
        ...todo,
        scheduledDate: next ?? undefined,
        recurrenceRule: nextRule,
        modifiedAt: new Date(),
      })
    }
  }

  const handleDeadlineChange = (next: Date | null) => {
    setDeadline(next)
    // Rule can persist when a precise scheduled date anchors it.
    const stillAnchored = !!next || (scheduledDate?.kind === 'date')
    if (!stillAnchored) setRecurrenceType('')
    if (isEdit && todo) {
      const nextRule: typeof todo.recurrenceRule = (() => {
        if (!recurrenceType) return undefined
        if (next) return makeRecurrenceRule(recurrenceType, next)
        if (scheduledDate?.kind === 'date') return makeRecurrenceRule(recurrenceType, scheduledDate.value)
        return undefined
      })()
      props.onUpdate({
        ...todo,
        dueDate: next ?? undefined,
        recurrenceRule: nextRule,
        modifiedAt: new Date(),
      })
    }
  }

  const handleRecurrenceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as RecurrenceType | ''
    setRecurrenceType(val)
    if (isEdit && todo) {
      const nextRule: typeof todo.recurrenceRule = (() => {
        if (!val) return undefined
        if (deadline) return makeRecurrenceRule(val, deadline)
        if (scheduledDate?.kind === 'date') return makeRecurrenceRule(val, scheduledDate.value)
        return undefined
      })()
      props.onUpdate({
        ...todo,
        recurrenceRule: nextRule,
        modifiedAt: new Date(),
      })
    }
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
      scheduledDate: scheduledDate ?? undefined,
      dueDate: deadline ?? undefined,
      recurrenceRule: buildRule(),
      projectId,
    }, {
      personIds: [...pendingPersonIds],
      orgIds: [...pendingOrgIds],
    })
    void newTodoId
    onClose()
  }

  const handleCreatePerson = onCreatePerson ? async (name: string) => {
    const id = await onCreatePerson(name)
    if (mode === 'create') {
      setPendingPersonIds(prev => new Set([...prev, id]))
    } else {
      onAssignPerson(id)
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
  const assignedOrgIds = useMemo(() => new Set(effectiveAssignedOrgs.map(o => o.id!)), [effectiveAssignedOrgs])

  // Close dropdown on outside click
  useEffect(() => {
    if (!openDropdown) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (openDropdown === 'people' && peopleRef.current && !peopleRef.current.contains(target)) {
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
          mode={mode}
          titleRef={titleRef}
          onToggleComplete={handleToggleComplete}
          onTitleChange={handleTitleChange}
          onTitleBlur={handleTitleBlur}
          onTitleKeyDown={handleTitleKeyDown}
          onClose={onClose}
          acState={ac.state}
          onAcSelect={handleAcSelect}
        />

        {/* Status badge */}
        <div className={styles.badges}>
          {statuses.length > 0 && (
            <div className={styles.priorityWrapper} ref={statusMenuRef}>
              <button
                className={styles.badge}
                onClick={() => setShowStatusMenu((v) => !v)}
              >
                {statusId ? (
                  <><span style={{ color: statuses.find(s => s.id === statusId)?.color }}><StatusIcon icon={statuses.find(s => s.id === statusId)?.icon || 'circle'} filled /></span> {statuses.find(s => s.id === statusId)?.name ?? 'Status'}</>
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
                    <span style={{ color: 'var(--color-text-muted)' }}><StatusIcon icon="circle" /></span>
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
                      <span style={{ color: s.color }}><StatusIcon icon={s.icon || 'circle'} filled /></span>
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
            scheduledDate={scheduledDate}
            deadline={deadline}
            recurrenceType={recurrenceType}
            onScheduledChange={handleScheduledChange}
            onDeadlineChange={handleDeadlineChange}
            onRecurrenceChange={handleRecurrenceChange}
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
            peopleRef={peopleRef}
            orgsRef={orgsRef}
            onTogglePerson={togglePerson}
            onToggleOrg={toggleOrg}
            onCreatePerson={handleCreatePerson}
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
            <div className={styles.notesBodyWrap}>
              <NotesBody
                source={notesSource}
                showToolbar
                hideFooter
                placeholder="Add notes..."
              />
            </div>
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
