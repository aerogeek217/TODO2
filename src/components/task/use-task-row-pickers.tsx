import { useCallback, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Person, PersistedTodoItem } from '../../models'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useTaskRowActions } from '../../hooks/use-task-row-actions'
import { personPickerItems, PERSON_PICKER_PLACEHOLDER } from '../../utils/person'
import { AnchoredPicker } from '../shared/AnchoredPicker'
import { ChipSelector } from '../shared/ChipSelector'
import { FollowupPopover } from '../shared/followup/FollowupPopover'
import type { TagChipSelectorProps } from '../shared/TagChipSelector'
import type { TaskMenuHandlers } from './task-menu-entries'
import { TaskNotePopover } from './TaskNotePopover'

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
}

/**
 * The pickers a task row opens — people, tags, follow-up, notes, the due-date
 * input — and the task menu's handlers, shared by `TaskRow` and
 * `MobileTaskRow`. Every change goes through the row's selection-aware
 * actions (`useTaskRowActions`). `panels` renders the open people picker,
 * follow-up popover and notes popover; the row places its own triggers.
 */
export function useTaskRowPickers({
  todo, assignedPeople, ghost = false, onOpenDetail, peoplePickerClassName, fallbackPeopleAnchorRef, useFallbackPeopleAnchor = false,
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
  const [followupOpen, setFollowupOpen] = useState(false)
  /** The pill / flag open the follow-up popover on "Followed up"; the menu's "Pick a date or interval…" on the date field. */
  const [followupFocus, setFollowupFocus] = useState<'followedUp' | 'next'>('followedUp')
  const [notesOpen, setNotesOpen] = useState(false)
  const peopleRef = useRef<HTMLElement>(null)
  const followupAnchorRef = useRef<HTMLButtonElement>(null)
  const deadlineInputRef = useRef<HTMLInputElement>(null)
  const notesIconRef = useRef<HTMLButtonElement>(null)

  const closeTagPicker = useCallback(() => setTagPickerOpen(false), [])
  const toggleTagPicker = useCallback(() => setTagPickerOpen((v) => !v), [])

  const closePeople = useCallback(() => setPeopleOpen(false), [])
  const togglePeople = useCallback(() => setPeopleOpen((v) => !v), [])
  const closeFollowup = useCallback(() => setFollowupOpen(false), [])
  const toggleFollowup = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setFollowupFocus('followedUp')
    setFollowupOpen((v) => !v)
  }, [])
  const closeNotes = useCallback(() => setNotesOpen(false), [])
  const toggleNotes = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setNotesOpen((v) => !v)
  }, [])

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
    onPickFollowup: ghost ? undefined : () => { setFollowupFocus('next'); setFollowupOpen(true) },
    onFollowedUp: () => bulk.markFollowedUp(todo.id),
    onAssignPeople: ghost ? undefined : () => setPeopleOpen(true),
    onAddTag: ghost ? undefined : () => setTagPickerOpen(true),
    onSetMarker: handleSetMarker,
    onDelete: handleDelete,
  }

  const peopleAnchor = useFallbackPeopleAnchor && fallbackPeopleAnchorRef ? fallbackPeopleAnchorRef : peopleRef
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
      {followupOpen && (
        <FollowupPopover
          todo={todo}
          anchor={{ kind: 'ref', ref: followupAnchorRef }}
          onClose={closeFollowup}
          onSetNext={(d) => bulk.setFollowup(todo.id, d)}
          onFollowedUp={() => bulk.markFollowedUp(todo.id)}
          initialFocus={followupFocus}
        />
      )}
      {notesOpen && createPortal(
        <TaskNotePopover todoId={todo.id} anchorRef={notesIconRef} onClose={closeNotes} />,
        document.body,
      )}
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
    deadlineInputRef,
    openDeadlinePicker,
    onDeadlineInputChange,
    menuHandlers,
    panels,
  }
}
