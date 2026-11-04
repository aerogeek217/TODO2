import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Person, PersistedTodoItem } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { usePopoverLevel } from '../shared/popover-level'
import { ChipSelector } from '../shared/ChipSelector'
import type { TagChipSelectorProps } from '../shared/TagChipSelector'
import type { TaskMenuHandlers } from './task-menu-entries'
import { TaskNotePopover } from './TaskNotePopover'
import { SubtasksPopover } from './subtasks/SubtasksPopover'
import { SubtasksSheet } from './subtasks/SubtasksSheet'

const NO_PEOPLE: Person[] = []

export interface TaskRowPickersOptions {
  todo: PersistedTodoItem
  assignedPeople: Person[] | undefined
  /** A drag-overlay copy of the row: no pickers, and its menu leaves the picker items out. */
  ghost?: boolean
  onOpenDetail?: (todoId: number) => void
  /** The people picker's panel class. */
  peoplePickerClassName: string | undefined
  /**
   * Where the people picker opens when the row shows no people trigger to
   * anchor it (`useFallbackPeopleAnchor`): the phone row's first line with
   * nobody assigned, or the desktop row when its people column is removed.
   * A click there is outside the picker, so it closes it.
   */
  fallbackPeopleAnchorRef?: RefObject<HTMLElement | null>
  useFallbackPeopleAnchor?: boolean
  /** How the checklist opens from the row's count: a popover under it (default), or the phone's bottom sheet. */
  subtasksPanel?: 'popover' | 'sheet'
  /**
   * Where the checklist popover opens when the row shows no count to anchor
   * it (`useFallbackSubtasksAnchor`: a task without a checklist, from the
   * menu's Add subtask…): the row. A click there is outside, so it closes it.
   */
  fallbackSubtasksAnchorRef?: RefObject<HTMLElement | null>
  useFallbackSubtasksAnchor?: boolean
}

/**
 * The pickers a task row opens — people, tags, follow-up, notes, the due-date
 * input — and the task menu's handlers, shared by `TaskRow` and
 * `MobileTaskRow`. Every change goes through the row's selection-aware
 * actions (`useTaskRowActions`). `panels` renders the open people picker,
 * follow-up popover, notes popover and subtasks popover (or sheet); the row
 * places its own triggers.
 */
export function useTaskRowPickers({
  todo, assignedPeople, ghost = false, onOpenDetail, peoplePickerClassName, fallbackPeopleAnchorRef, useFallbackPeopleAnchor = false,
  subtasksPanel = 'popover', fallbackSubtasksAnchorRef, useFallbackSubtasksAnchor = false,
}: TaskRowPickersOptions) {
  const { bulk, handleToggleComplete, handleSetMarker, handleDelete } = useTaskRowActions({ todo })
  const allPeople = usePersonStore((s) => s.people)
  const allTags = useTagStore((s) => s.tags)
  const assignedTagsForTodo = useTagStore((s) => s.assignedTagsMap.get(todo.id))
  const assignedTags = useMemo(() => assignedTagsForTodo ?? [], [assignedTagsForTodo])
  const people = assignedPeople ?? NO_PEOPLE
  const assignedPeopleIds = useMemo(() => new Set(people.map((p) => p.id!)), [people])

  const [peopleOpen, setPeopleOpen] = useState(false)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const [notesOpen, setNotesOpen] = useState(false)
  /** The checklist: open on its list, or on its add field (the menu's Add subtask…). */
  const [subtasksOpen, setSubtasksOpen] = useState<false | 'list' | 'add'>(false)
  const subtasksRef = useRef<HTMLButtonElement>(null)
  const peopleRef = useRef<HTMLElement>(null)
  const followupAnchorRef = useRef<HTMLButtonElement>(null)
  const followupOpen = useUIStore((s) => s.followupPopover?.triggerRef === followupAnchorRef)
  const popoverLevel = usePopoverLevel()
  /** The pill / flag open the follow-up popover on "Mark followed up"; the menu's "Pick a date or interval…" on the date field. */
  const openFollowup = useCallback((initialFocus: 'followedUp' | 'next') => {
    const el = followupAnchorRef.current
    if (!el) return
    const { left, top, right, bottom } = el.getBoundingClientRect()
    useUIStore.getState().openFollowupPopover({
      todoId: todo.id,
      anchor: { left, top, right, bottom },
      triggerRef: followupAnchorRef,
      initialFocus,
      level: popoverLevel,
    })
  }, [todo.id, popoverLevel])
  const deadlineInputRef = useRef<HTMLInputElement>(null)
  const notesIconRef = useRef<HTMLButtonElement>(null)

  const closeTagPicker = useCallback(() => setTagPickerOpen(false), [])
  const toggleTagPicker = useCallback(() => setTagPickerOpen((v) => !v), [])

  const closePeople = useCallback(() => setPeopleOpen(false), [])
  const togglePeople = useCallback(() => setPeopleOpen((v) => !v), [])
  const toggleFollowup = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    const ui = useUIStore.getState()
    if (ui.followupPopover?.triggerRef === followupAnchorRef) ui.closeFollowupPopover()
    else openFollowup('followedUp')
  }, [openFollowup])
  const closeNotes = useCallback(() => setNotesOpen(false), [])
  const toggleNotes = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setNotesOpen((v) => !v)
  }, [])
  const closeSubtasks = useCallback(() => setSubtasksOpen(false), [])
  const toggleSubtasks = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setSubtasksOpen((v) => (v ? false : 'list'))
  }, [])
  const openSubtasksAdd = useCallback(() => setSubtasksOpen('add'), [])

  const openDeadlinePicker = useCallback(() => {
    setTimeout(() => {
      try { deadlineInputRef.current?.showPicker?.() } catch { deadlineInputRef.current?.focus() }
    }, 0)
  }, [])
  const onDeadlineInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value
    bulk.setDeadline(todo.id, raw ? new Date(raw + 'T00:00:00') : null)
  }, [bulk, todo.id])

  const togglePerson = (id: number) => {
    if (ghost) return
    if (people.some((p) => p.id === id)) bulk.quickUnassignPerson(todo.id, id)
    else bulk.quickAssignPerson(todo.id, id)
  }
  const createPerson = async (name: string) => {
    if (ghost) return
    const id = await usePersonStore.getState().getOrCreate(name)
    bulk.quickAssignPerson(todo.id, id)
  }
  const toggleTag = useCallback((tagId: number) => {
    if (ghost) return
    if (assignedTags.some((t) => t.id === tagId)) bulk.quickUnassignTag(todo.id, tagId)
    else bulk.quickAssignTag(todo.id, tagId)
  }, [ghost, assignedTags, bulk, todo.id])
  const createTag = useCallback(async (name: string) => {
    if (ghost) return
    const id = await useTagStore.getState().add(name)
    bulk.quickAssignTag(todo.id, id)
  }, [ghost, bulk, todo.id])

  const tagSelectorProps: TagChipSelectorProps = {
    assignedTags,
    allTags,
    onToggle: toggleTag,
    onCreate: createTag,
    open: tagPickerOpen,
    onOpenChange: setTagPickerOpen,
  }

  const menuHandlers: TaskMenuHandlers = {
    onOpen: onOpenDetail ? () => onOpenDetail(todo.id) : undefined,
    onToggleComplete: handleToggleComplete,
    onSetDueDate: ghost ? undefined : openDeadlinePicker,
    onSetFollowup: (d) => bulk.setFollowup(todo.id, d),
    onPickFollowup: ghost ? undefined : () => openFollowup('next'),
    onFollowedUp: () => bulk.markFollowedUp(todo.id),
    onAssignPeople: ghost ? undefined : () => setPeopleOpen(true),
    onAddTag: ghost ? undefined : () => setTagPickerOpen(true),
    onAddSubtask: ghost ? undefined : openSubtasksAdd,
    onMakeSubtaskOf: ghost ? undefined : () => useUIStore.getState().openTaskPicker({ kind: 'make-subtask', todoId: todo.id }),
    onSetMarker: handleSetMarker,
    onDelete: handleDelete,
  }

  const peopleAnchor = useFallbackPeopleAnchor && fallbackPeopleAnchorRef ? fallbackPeopleAnchorRef : peopleRef
  const subtasksAnchor = useFallbackSubtasksAnchor && fallbackSubtasksAnchorRef ? fallbackSubtasksAnchorRef : subtasksRef
  const panels: ReactNode = ghost ? null : (
    <>
      {peopleOpen && (
        <AnchoredPicker anchorRef={peopleAnchor} anchorIsInside={peopleAnchor === peopleRef} onClose={closePeople}>
          <div className={peoplePickerClassName}>
            <ChipSelector
              items={personPickerItems(allPeople)}
              selectedIds={assignedPeopleIds}
              onToggle={togglePerson}
              onCreate={createPerson}
              onClose={closePeople}
              avatars
              entityMenu="person"
              placeholder={PERSON_PICKER_PLACEHOLDER}
            />
          </div>
        </AnchoredPicker>
      )}
      {notesOpen && createPortal(
        <TaskNotePopover todoId={todo.id} anchorRef={notesIconRef} onClose={closeNotes} />,
        document.body,
      )}
      {subtasksOpen && (subtasksPanel === 'sheet'
        ? <SubtasksSheet todo={todo} onClose={closeSubtasks} />
        : createPortal(
          <SubtasksPopover
            todo={todo}
            anchorRef={subtasksAnchor}
            anchorIsInside={subtasksAnchor === subtasksRef}
            onClose={closeSubtasks}
            onOpenDetail={onOpenDetail}
            focusAdd={subtasksOpen === 'add'}
          />,
          document.body,
        ))}
    </>
  )

  return {
    bulk,
    handleToggleComplete,
    assignedTags,
    allTags,
    tagSelectorProps,
    tagPickerOpen,
    toggleTagPicker,
    closeTagPicker,
    toggleTag,
    createTag,
    peopleOpen,
    togglePeople,
    peopleRef,
    followupOpen,
    toggleFollowup,
    followupAnchorRef,
    notesOpen,
    toggleNotes,
    notesIconRef,
    subtasksOpen: subtasksOpen !== false,
    toggleSubtasks,
    openSubtasksAdd,
    subtasksRef,
    deadlineInputRef,
    openDeadlinePicker,
    onDeadlineInputChange,
    menuHandlers,
    panels,
  }
}
