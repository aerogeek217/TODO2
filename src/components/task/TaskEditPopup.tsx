import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { TodoItem, TodoChanges, PersistedTodoItem, Person, RecurrenceType, Tag } from '../../models'
import { DEFAULT_STATUS_ICON } from '../../models'
import { useSettingsStore } from '../../stores/settings-store'
import { useStatusStore } from '../../stores/status-store'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { addFollowupInterval, describeFollowupInterval } from '../../utils/followup'
import { useFilterStore } from '../../stores/filter-store'
import { getFilterDefaults } from '../../utils/filter-defaults'
import { StatusIcon } from '../shared/StatusIcon'
import { FocusIcon, ImportantIcon, UrgentClockIcon, UrgentIcon } from '../shared/MarkerIcons'
import { useTooltip } from '../../hooks/use-tooltip'
import { askClearUrgent, clearUrgent, planClearUrgent } from '../../services/clear-urgent'
import { startOfToday } from '../../utils/date'
import { urgentByDateReason, urgentMark } from '../../utils/urgency'
import { useNlpAutocomplete } from '../../hooks/use-nlp-autocomplete'
import { personItems, statusItems, tagItems } from '../../services/nlp-autocomplete'
import { makeRecurrenceRule } from '../../services/recurrence'
import { parseTaskInput } from '../../services/nlp-task-creator'
import { draftEditorTitle, type TaskDraft } from '../../services/task-draft'
import { TaskEditHeader } from './TaskEditHeader'
import { TaskEditMetadata } from './TaskEditMetadata'
import { TaskEditFooter } from './TaskEditFooter'
import { NotesBody, type NotesSource } from '../shared/notes/NotesBody'
import { editorChanges, editorFieldsOf, storeUpdatesToShow, type EditorFields } from './editor-fields'
import { useLatestRef } from '../../hooks/use-latest-ref'
import styles from './TaskEditPopup.module.css'

interface TaskEditPopupBaseProps {
  assignedPeople: Person[]
  allPeople: Person[]
  assignedTags?: Tag[]
  allTags?: Tag[]
  onClose: () => void
  onAssignPerson: (personId: number) => void
  onUnassignPerson: (personId: number) => void
  onAssignTag?: (tagId: number) => void
  onUnassignTag?: (tagId: number) => void
  onCreatePerson?: (name: string) => Promise<number>
  onCreateTag?: (name: string) => Promise<number>
}

interface EditModeProps extends TaskEditPopupBaseProps {
  mode: 'edit'
  todo: PersistedTodoItem
  /** Saves the fields the user changed (only those). */
  onUpdate: (changes: TodoChanges) => void
  onToggleComplete: () => void
  onDelete: () => void
  onDuplicate?: () => void
  /** "Followed up" (bulk-aware in the views). Defaults to stamping just this task. */
  onFollowedUp?: () => void
  onCreate?: never
  /** Stacks the editor above dialogs (the task dialog it was opened from). */
  nested?: boolean
}

interface CreateModeProps extends TaskEditPopupBaseProps {
  mode: 'create'
  todo?: never
  onUpdate?: never
  onToggleComplete?: never
  onDelete?: never
  /** Resolves to the new task's id, or null when it couldn't be stored. */
  onCreate: (todo: Partial<TodoItem>, assignments?: { personIds: number[], tagIds: number[] }) => Promise<number | null>
  /**
   * Starts from this draft (a converted note line) instead of Quick Add's
   * handoff and the screen filter's defaults; the draft already carries
   * them. People and tags still to create show as `@` / `#` in the title.
   */
  seed?: TaskDraft
  /**
   * Draft mode (editing a row of the convert preview): nothing is stored.
   * The footer's Save draft hands the fields back instead of creating, and
   * there is no Last follow-up / Followed up (a draft has no history).
   */
  onSaveDraft?: (todo: Partial<TodoItem>, assignments: { personIds: number[], tagIds: number[] }) => void
  /** Stacks the editor above dialogs (the convert preview, another editor). */
  nested?: boolean
}

type TaskEditPopupProps = EditModeProps | CreateModeProps

export function TaskEditPopup(props: TaskEditPopupProps) {
  const {
    mode, allPeople, assignedPeople,
    assignedTags = [], allTags = [],
    onClose, onAssignPerson, onUnassignPerson,
    onCreatePerson,
    onAssignTag, onUnassignTag, onCreateTag,
  } = props

  const isEdit = mode === 'edit'
  const todo = isEdit ? props.todo : undefined
  // Read once: later prop changes mustn't clobber edits.
  const [seed] = useState(() => (props.mode === 'create' ? props.seed : undefined))
  const isDraft = props.mode === 'create' && props.onSaveDraft !== undefined
  const nested = props.nested === true

  const defaultStatusId = useSettingsStore((s) => s.defaultStatusId)
  const statuses = useStatusStore((s) => s.statuses)
  const followupInterval = useSettingsStore((s) => s.followupDefaultInterval)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)

  // Compute filter defaults once for create mode (views with filter UI only).
  // List-widget handoff: when the QuickAddBar was opened from a list's
  // "+ Add task" affordance, `ui-store.quickAddDraft.defaults` carries the
  // list's predicate-derived seed, which takes precedence over the global
  // filter (the top bar may have no filter even though the list itself
  // narrows). Falls back to the active filter otherwise.
  const filterDefaults = useMemo(() => {
    if (mode !== 'create' || seed) return null
    const draftDefaults = useUIStore.getState().quickAddDraft?.defaults
    if (draftDefaults) return draftDefaults
    return getFilterDefaults(useFilterStore.getState().filters)
  }, [mode, seed])

  // QuickAddBar handoff: when the create popup mounts and `ui-store.quickAddDraft`
  // is set (the bar's "Open full editor →" path stashed an in-progress draft),
  // pre-parse the raw title once on mount and seed every metadata field below.
  // One-shot via `useState` lazy initializer — subsequent draft/store changes
  // mustn't clobber user edits, and `closeEditPopup` clears the draft on close
  // so a re-mount starts clean unless re-seeded.
  const [quickAddSeed] = useState(() => {
    if (mode !== 'create' || seed) return null
    const draft = useUIStore.getState().quickAddDraft
    if (!draft) return null
    const { resolved } = parseTaskInput(
      draft.rawTitle,
      allPeople,
      useStatusStore.getState().statuses,
    )
    // Sync tag lookup against the registry — pre-fills chips for tags that
    // already exist. Novel `#foo` slugs aren't created here; the create-time
    // re-parse in `useTaskEditCallbacks.onCreate` runs `resolveTags`, which
    // resolves-or-creates against the same registry.
    const tagIds: number[] = []
    for (const slug of resolved.tags) {
      const lower = slug.toLowerCase()
      const match = allTags.find((t) => t.name.toLowerCase() === lower && t.id !== undefined)
      if (match?.id !== undefined) tagIds.push(match.id)
    }
    // The commands are carried by the fields below, so the title drops them;
    // `@` / `#` tokens stay (new people and tags are created on create).
    return { title: resolved.textWithoutCommands ?? draft.rawTitle, resolved, tagIds }
  })

  const [title, setTitle] = useState(todo?.title ?? (seed ? draftEditorTitle(seed) : quickAddSeed?.title) ?? '')
  const [notes, setNotes] = useState(todo?.notes ?? seed?.notes ?? '')
  const notesRef = useRef<string>(todo?.notes ?? seed?.notes ?? '')
  const [progress, setProgress] = useState(todo?.progress ?? seed?.progress ?? '')
  const [statusId, setStatusId] = useState<number | undefined>(
    seed ? seed.statusId : (
      todo?.statusId
      ?? quickAddSeed?.resolved.statusId
      ?? (mode === 'create' ? (defaultStatusId ?? filterDefaults?.statusId ?? undefined) : undefined)
    ),
  )
  const [deadline, setDeadline] = useState<Date | null>(
    todo?.dueDate ?? seed?.dueDate ?? quickAddSeed?.resolved.dueDate ?? null,
  )
  // Follow-up: edit mode reads/writes the task directly (edits apply as you
  // make them); create mode keeps a draft seeded with the Settings default.
  // A Quick Add `/followup` replaces the default (`none` clears it).
  // A draft's `nextFollowupAt`: undefined = the default, null = none.
  const seededFollowup = seed
    ? seed.nextFollowupAt !== undefined
    : quickAddSeed?.resolved.followupNone === true || quickAddSeed?.resolved.nextFollowupAt !== undefined
  const [draftNextFollowup, setDraftNextFollowup] = useState<Date | undefined>(() => {
    if (mode !== 'create') return undefined
    if (seededFollowup) return seed ? (seed.nextFollowupAt ?? undefined) : quickAddSeed?.resolved.nextFollowupAt
    return addFollowupInterval(new Date(), followupInterval)
  })
  const [draftLastFollowup, setDraftLastFollowup] = useState<Date | undefined>(undefined)
  // Create mode: marker drafts, seeded from a Markers filter and Quick Add's
  // `/urgent` `/important` `/focus`.
  const [draftUrgent, setDraftUrgent] = useState(seed?.urgent === true || filterDefaults?.markers?.urgent === true || quickAddSeed?.resolved.urgent === true)
  const [draftImportant, setDraftImportant] = useState(seed?.important === true || filterDefaults?.markers?.important === true || quickAddSeed?.resolved.important === true)
  const [draftFocus, setDraftFocus] = useState(seed?.focus === true || filterDefaults?.markers?.focus === true || quickAddSeed?.resolved.focus === true)
  const [nextFollowupIsDefault, setNextFollowupIsDefault] = useState(mode === 'create' && !seededFollowup)
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType | ''>(
    todo?.recurrenceRule?.type ?? seed?.recurrence ?? quickAddSeed?.resolved.recurrence ?? '',
  )
  // Local state for create mode assignments (no todoId exists yet). QuickAdd
  // seed merges with filter defaults — both contribute pre-checked entities.
  const [pendingPersonIds, setPendingPersonIds] = useState<Set<number>>(
    () => new Set([...(seed?.personIds ?? []), ...(filterDefaults?.personIds ?? []), ...(quickAddSeed?.resolved.personIds ?? [])]),
  )
  const [pendingTagIds, setPendingTagIds] = useState<Set<number>>(
    () => new Set([...(seed?.tagIds ?? []), ...(filterDefaults?.tagIds ?? []), ...(quickAddSeed?.tagIds ?? [])]),
  )

  const effectiveAssignedPeople = mode === 'create'
    ? allPeople.filter(p => pendingPersonIds.has(p.id!))
    : assignedPeople
  const effectiveAssignedTags = mode === 'create'
    ? allTags.filter(t => pendingTagIds.has(t.id!))
    : assignedTags

  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [openDropdown, setOpenDropdown] = useState<'people' | 'tags' | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const peopleRef = useRef<HTMLDivElement>(null)
  const tagsRef = useRef<HTMLDivElement>(null)
  const statusMenuRef = useRef<HTMLDivElement>(null)

  const acPeople = useMemo(() => personItems(allPeople), [allPeople])
  const acTags = useMemo(() => tagItems(allTags), [allTags])
  const acStatuses = useMemo(() => statusItems(statuses), [statuses])
  // Slash commands only in create mode: the title is parsed when the task is created.
  const ac = useNlpAutocomplete({
    people: acPeople,
    tags: acTags,
    statuses: acStatuses,
    commands: !isEdit,
    onApply: (value, cursor) => {
      setTitle(value)
      requestAnimationFrame(() => {
        titleRef.current?.setSelectionRange(cursor, cursor)
        titleRef.current?.focus()
      })
    },
  })

  // Stacked over a dialog, the editor takes focus so Esc reaches it, not the dialog.
  const backdropRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!isEdit) titleRef.current?.focus()
    else if (nested) backdropRef.current?.focus({ preventScroll: true })
  }, [isEdit, nested])

  // Edit mode: the editor shows changes made elsewhere (a bulk edit, a
  // calendar drop, undo) except in the fields the user has changed since the
  // last sync, which keep the user's text. `baselineRef` holds the task's
  // values at the last sync; saving writes only the fields that differ from
  // it (`editorChanges`), so nothing changed elsewhere is written back over.
  const todoId = todo?.id
  const todoTitle = todo?.title
  const todoNotes = todo?.notes
  const todoProgress = todo?.progress
  const todoStatusId = todo?.statusId
  const todoDueDate = todo?.dueDate
  const todoRecurrenceRule = todo?.recurrenceRule
  const baselineRef = useRef<EditorFields | null>(todo ? editorFieldsOf(todo) : null)
  const baselineIdRef = useRef(todoId)
  const formRef = useLatestRef<EditorFields>({ title, notes, progress, statusId, deadline, recurrenceType })
  useEffect(() => {
    if (todoId === undefined || todoTitle === undefined) return
    const store = editorFieldsOf({
      title: todoTitle, notes: todoNotes, progress: todoProgress, statusId: todoStatusId,
      dueDate: todoDueDate, recurrenceRule: todoRecurrenceRule,
    })
    const baseline = baselineRef.current
    // Another task: show all of it.
    const show = baseline && baselineIdRef.current === todoId
      ? storeUpdatesToShow(store, baseline, formRef.current)
      : store
    baselineRef.current = store
    baselineIdRef.current = todoId
    if (show.title !== undefined) setTitle(show.title)
    if (show.notes !== undefined) {
      setNotes(show.notes)
      notesRef.current = show.notes
    }
    if (show.progress !== undefined) setProgress(show.progress)
    if ('statusId' in show) setStatusId(show.statusId)
    if (show.deadline !== undefined) setDeadline(show.deadline)
    if (show.recurrenceType !== undefined) setRecurrenceType(show.recurrenceType)
  }, [todoId, todoTitle, todoNotes, todoProgress, todoStatusId, todoDueDate, todoRecurrenceRule, formRef])

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
      // Handled here: an editor stacked over another surface (the convert
      // preview, another editor) must not close that one too.
      e.stopPropagation()
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        ;(e.target as HTMLElement).blur()
        // Focus stays in the editor, so the next Esc closes it.
        ;(e.currentTarget as HTMLElement).focus({ preventScroll: true })
      } else {
        onClose()
      }
    }
  }, [onClose])

  const buildRule = useCallback(() => {
    if (!recurrenceType) return undefined
    if (deadline) return makeRecurrenceRule(recurrenceType, deadline)
    return undefined
  }, [recurrenceType, deadline])

  // Writes the fields the user changed since the last sync (title / progress
  // on blur; the other fields also save as they change).
  const saveEdit = () => {
    const baseline = baselineRef.current
    if (props.mode !== 'edit' || !baseline) return
    const changes = editorChanges(formRef.current, baseline)
    if (Object.keys(changes).length > 0) props.onUpdate(changes)
  }

  const handleTitleBlur = () => { if (isEdit) saveEdit() }

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value)
    ac.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (ac.handleKeyDown(e, titleRef.current)) {
      e.preventDefault()
      e.stopPropagation()
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (mode === 'create') handleCreate()
      else titleRef.current?.blur()
    }
    if (e.key === 'Escape') titleRef.current?.blur()
  }

  const onUpdateRef = useRef(isEdit ? props.onUpdate : undefined)
  onUpdateRef.current = isEdit ? props.onUpdate : undefined

  const notesSource = useMemo<NotesSource>(() => ({
    get: () => notesRef.current,
    set: (next) => {
      notesRef.current = next
      setNotes(next)
      onUpdateRef.current?.({ notes: next ? next : undefined })
    },
  }), [])

  const handleDeadlineChange = (next: Date | null) => {
    setDeadline(next)
    // The rule is anchored to the due date; clearing it drops the rule.
    if (!next) setRecurrenceType('')
    if (isEdit && todo) {
      const nextRule: typeof todo.recurrenceRule =
        recurrenceType && next ? makeRecurrenceRule(recurrenceType, next) : undefined
      props.onUpdate({ dueDate: next ?? undefined, recurrenceRule: nextRule })
    }
  }

  const handleRecurrenceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as RecurrenceType | ''
    setRecurrenceType(val)
    if (isEdit && todo) {
      const nextRule: typeof todo.recurrenceRule =
        val && deadline ? makeRecurrenceRule(val, deadline) : undefined
      props.onUpdate({ recurrenceRule: nextRule })
    }
  }

  const handleToggleComplete = () => {
    if (isEdit) props.onToggleComplete()
  }

  const handleNextFollowupChange = (next: Date | null) => {
    if (isEdit && todo) {
      props.onUpdate({ nextFollowupAt: next ?? undefined })
    } else {
      setDraftNextFollowup(next ?? undefined)
      setNextFollowupIsDefault(false)
    }
  }

  const handleLastFollowupChange = (last: Date | null) => {
    if (isEdit && todo) {
      props.onUpdate({ lastFollowupAt: last ?? undefined })
    } else {
      setDraftLastFollowup(last ?? undefined)
    }
  }

  const handleFollowedUp = () => {
    if (isEdit && todo) {
      if (props.onFollowedUp) props.onFollowedUp()
      else void useTodoStore.getState().markFollowedUp([todo.id])
      return
    }
    const now = new Date()
    setDraftLastFollowup(now)
    setDraftNextFollowup(addFollowupInterval(now, followupInterval))
    setNextFollowupIsDefault(false)
  }

  // Urgent is effective urgent: the flag, or the due date within the
  // Settings range (then the toggle shows the clock). Turning it off on a
  // task urgent by date asks about the due date (`services/clear-urgent`).
  const markerToday = startOfToday()
  const urgentSubject = {
    title: (isEdit ? todo?.title : title.trim()) || 'This task',
    urgent: isEdit ? todo?.urgent === true : draftUrgent,
    dueDate: deadline ?? undefined,
    isCompleted: isEdit ? todo?.isCompleted === true : false,
  }
  const urgentState = urgentMark(urgentSubject, markerToday, urgentRange)
  const urgentReason = urgentState === 'date' ? urgentByDateReason(urgentSubject, markerToday, urgentRange) : ''
  const handleToggleUrgent = () => {
    if (isEdit && todo) {
      if (urgentState === null) void useTodoStore.getState().bulkSetUrgent([todo.id], true)
      else void clearUrgent([todo.id])
      return
    }
    if (urgentState === null) {
      setDraftUrgent(true)
      return
    }
    const plan = planClearUrgent([urgentSubject], markerToday, urgentRange)
    if (plan.clearFlag.length > 0) setDraftUrgent(false)
    if (plan.prompt) askClearUrgent(plan.prompt, [], () => handleDeadlineChange(null))
  }

  const importantOn = isEdit ? todo?.important === true : draftImportant
  const handleToggleImportant = () => {
    if (isEdit && todo) {
      void useTodoStore.getState().bulkSetImportant([todo.id], !importantOn)
    } else {
      setDraftImportant((v) => !v)
    }
  }

  const focusOn = isEdit ? todo?.focus === true : draftFocus
  const handleToggleFocus = () => {
    if (isEdit && todo) {
      void useTodoStore.getState().bulkSetFocus([todo.id], !focusOn)
    } else {
      setDraftFocus((v) => !v)
    }
  }

  const handleCreate = async () => {
    if (props.mode !== 'create' || !title.trim()) return
    const partial: Partial<TodoItem> = {
      title: title.trim(),
      notes: notes || undefined,
      progress: progress || undefined,
      statusId,
      dueDate: deadline ?? undefined,
      // Left out while still the default, so a `/followup` in the title applies.
      ...(nextFollowupIsDefault ? {} : { nextFollowupAt: draftNextFollowup }),
      lastFollowupAt: draftLastFollowup,
      recurrenceRule: buildRule(),
      ...(draftUrgent ? { urgent: true } : {}),
      ...(draftImportant ? { important: true } : {}),
      ...(draftFocus ? { focus: true } : {}),
    }
    const assignments = { personIds: [...pendingPersonIds], tagIds: [...pendingTagIds] }
    if (props.onSaveDraft) props.onSaveDraft(partial, assignments)
    else await props.onCreate(partial, assignments)
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
    const isAssigned = assignedTags.some((t) => t.id === id)
    if (isAssigned) onUnassignTag(id)
    else onAssignTag(id)
  }

  const handleCreateTag = onCreateTag ? async (name: string) => {
    const id = await onCreateTag(name)
    if (mode === 'create') {
      setPendingTagIds(prev => new Set([...prev, id]))
    } else if (onAssignTag) {
      onAssignTag(id)
    }
  } : undefined

  const assignedPeopleIds = useMemo(() => new Set(effectiveAssignedPeople.map(p => p.id!)), [effectiveAssignedPeople])
  const assignedTagIds = useMemo(() => new Set(effectiveAssignedTags.map(t => t.id!)), [effectiveAssignedTags])

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
    <div ref={backdropRef} className={`${styles.backdrop} ${nested ? styles.backdropNested : ''}`} onMouseDown={handleBackdropMouseDown} onClick={handleBackdropClick} onKeyDown={handleKeyDown} tabIndex={-1}>
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
          onAcPick={(row) => ac.select(row, titleRef.current)}
          isDraft={isDraft}
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
                  <><span style={{ color: statuses.find(s => s.id === statusId)?.color }}><StatusIcon icon={statuses.find(s => s.id === statusId)?.icon || DEFAULT_STATUS_ICON} filled /></span> {statuses.find(s => s.id === statusId)?.name ?? 'Status'}</>
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
                      if (props.mode === 'edit') props.onUpdate({ statusId: undefined })
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
                        if (props.mode === 'edit') props.onUpdate({ statusId: s.id })
                      }}
                    >
                      <span style={{ color: s.color }}><StatusIcon icon={s.icon || DEFAULT_STATUS_ICON} filled /></span>
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {statuses.length > 0 && <span className={styles.badgeDivider} aria-hidden="true" />}
          <MarkerToggle
            className={`${styles.markerToggle} ${urgentState ? styles.markerToggleUrgentOn : ''}`}
            pressed={urgentState !== null}
            onClick={handleToggleUrgent}
            tooltip={urgentState === 'date'
              ? `Urgent: due soon\n${urgentReason} Click to make it not urgent.`
              : urgentState === 'flag' ? 'Remove urgent' : 'Mark urgent'}
            data-urgent={urgentState ?? undefined}
          >
            {urgentState === 'date' ? <UrgentClockIcon /> : <UrgentIcon />} Urgent
          </MarkerToggle>
          <MarkerToggle
            className={`${styles.markerToggle} ${importantOn ? styles.markerToggleImportantOn : ''}`}
            pressed={importantOn}
            onClick={handleToggleImportant}
            tooltip={importantOn ? 'Remove important' : 'Mark important'}
          >
            <ImportantIcon outline={!importantOn} /> Important
          </MarkerToggle>
          <MarkerToggle
            className={`${styles.markerToggle} ${focusOn ? styles.markerToggleFocusOn : ''}`}
            pressed={focusOn}
            onClick={handleToggleFocus}
            tooltip={focusOn ? 'Remove from Focus' : 'Add to Focus'}
          >
            <FocusIcon /> Focus
          </MarkerToggle>
        </div>

        <div className={`${styles.scrollBody} ${openDropdown ? styles.scrollBodyDropdownOpen : ''}`}>
          <TaskEditMetadata
            deadline={deadline}
            recurrenceType={recurrenceType}
            onDeadlineChange={handleDeadlineChange}
            onRecurrenceChange={handleRecurrenceChange}
            assignedPeople={effectiveAssignedPeople}
            assignedTags={effectiveAssignedTags}
            allPeople={allPeople}
            allTags={allTags}
            assignedPeopleIds={assignedPeopleIds}
            assignedTagIds={assignedTagIds}
            peopleRef={peopleRef}
            tagsRef={tagsRef}
            onTogglePerson={togglePerson}
            onToggleTag={toggleTag}
            onCreatePerson={handleCreatePerson}
            onCreateTag={handleCreateTag}
            openDropdown={openDropdown}
            setOpenDropdown={setOpenDropdown}
            followupNext={isEdit ? todo?.nextFollowupAt : draftNextFollowup}
            followupLast={isEdit ? todo?.lastFollowupAt : draftLastFollowup}
            followupNextHint={!isEdit && nextFollowupIsDefault && draftNextFollowup
              ? `Default · ${describeFollowupInterval(followupInterval)}`
              : undefined}
            onFollowupNextChange={handleNextFollowupChange}
            onFollowupLastChange={handleLastFollowupChange}
            onFollowedUp={handleFollowedUp}
            hideLastFollowup={isDraft}
          />

          {/* Progress */}
          <div className={styles.notesSection}>
            <div className={styles.notesLabel}>Progress</div>
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
                placeholder="Add notes..."
                convert={!seed}
              />
            </div>
          </div>
        </div>

        {isEdit && todo ? (
          <TaskEditFooter mode="edit" todo={todo} onDelete={props.onDelete} onDuplicate={props.onDuplicate} onClose={onClose} />
        ) : (
          <TaskEditFooter mode="create" onClose={onClose} onCreate={handleCreate} titleValid={!!title.trim()} isDraft={isDraft} />
        )}
      </div>
    </div>
  )
}

/** An editor marker toggle (Urgent / Important / Focus) with its tooltip. */
function MarkerToggle({ className, pressed, onClick, tooltip, children, ...rest }: {
  className: string
  pressed: boolean
  onClick: () => void
  tooltip: string
  children: React.ReactNode
  'data-urgent'?: string
}) {
  const { triggerProps, tooltip: tip } = useTooltip(tooltip)
  return (
    <button type="button" className={className} aria-pressed={pressed} onClick={onClick} {...rest} {...triggerProps}>
      {children}
      {tip}
    </button>
  )
}
