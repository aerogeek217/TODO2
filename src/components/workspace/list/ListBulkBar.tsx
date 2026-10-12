import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { PersistedTodoItem } from '../../../models'
import { useTodoStore } from '../../../stores/todo-store'
import { usePersonStore } from '../../../stores/person-store'
import { useTagStore } from '../../../stores/tag-store'
import { useUIStore } from '../../../stores/ui-store'
import { generateInitials } from '../../../utils/person'
import { ChipSelector } from '../../shared/ChipSelector'
import { PortalDropdown } from '../../shared/PortalDropdown'
import { StatusIcon } from '../../shared/StatusIcon'
import { FollowupFlagIcon } from '../../shared/FollowupIcons'
import { FollowupPopover } from '../../shared/followup/FollowupPopover'
import { setUrgent } from '../../../services/clear-urgent'
import { useSettingsStore } from '../../../stores/settings-store'
import { useToday } from '../../../hooks/use-today'
import { isFollowedUpToday } from '../../../utils/followup'
import { followedUpMenuEntry, markerMenuEntries } from '../../task/task-menu-entries'
import { MenuPopover } from '../MenuPopover'
import { AtIcon, CheckIcon, CloseIcon, HashIcon, MoreIcon, TrashIcon } from '../icons'
import styles from './ListWidget.module.css'

type OpenPicker = 'people' | 'tags' | 'followup' | 'more' | null

/** Ids assigned to every one of `todoIds` in `map`. */
function sharedIds(map: Map<number, Array<{ id?: number }>>, todoIds: readonly number[]): Set<number> {
  let shared: Set<number> | undefined
  for (const todoId of todoIds) {
    const ids = new Set<number>()
    for (const x of map.get(todoId) ?? []) if (x.id != null) ids.add(x.id)
    const kept: Set<number> = shared ?? ids
    shared = new Set([...kept].filter((id) => ids.has(id)))
    if (shared.size === 0) break
  }
  return shared ?? new Set<number>()
}

/**
 * The floating bar over a list widget with 2+ rows selected: set due date,
 * set follow-up, assign people, add tag, complete, ⋯ More, delete, clear.
 * ⋯ More holds Followed up and the Markers (Urgent / Important / Focus) as
 * tri-state checkbox items: when only some tasks have one, a click gives it
 * to all of them; when all have it, a click takes it off all (Urgent counts
 * tasks urgent by due date too, and turning it off asks about those dates —
 * `services/clear-urgent.ts`). Each goes through the existing bulk paths
 * (`bulkSet*`, `bulkAssign*`, `markFollowedUp`, `showBulkConfirmation`).
 */
export function ListBulkBar({ ids, bottom }: { ids: readonly number[]; bottom: number }) {
  const [open, setOpen] = useState<OpenPicker>(null)
  const dateRef = useRef<HTMLInputElement>(null)
  const followupRef = useRef<HTMLButtonElement>(null)
  const peopleRef = useRef<HTMLButtonElement>(null)
  const tagsRef = useRef<HTMLButtonElement>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const people = usePersonStore((s) => s.people)
  const assignedPeopleMap = usePersonStore((s) => s.assignedPeopleMap)
  const tags = useTagStore((s) => s.tags)
  const assignedTagsMap = useTagStore((s) => s.assignedTagsMap)
  const todos = useTodoStore((s) => s.todos)
  const list = [...ids]

  const selectedTodos = useMemo(() => {
    const set = new Set(ids)
    return todos.filter((t) => set.has(t.id))
  }, [todos, ids])
  const allCompleted = selectedTodos.length > 0 && selectedTodos.every((t) => t.isCompleted)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const today = useToday()
  const sharedPeople = useMemo(() => sharedIds(assignedPeopleMap, ids), [assignedPeopleMap, ids])
  const sharedTags = useMemo(() => sharedIds(assignedTagsMap, ids), [assignedTagsMap, ids])
  // The follow-up popover edits "the selection": it starts empty.
  const followupSeed = useMemo<PersistedTodoItem | undefined>(
    () => (selectedTodos[0] ? { ...selectedTodos[0], nextFollowupAt: undefined } : undefined),
    [selectedTodos],
  )

  const close = () => setOpen(null)
  const toggle = (picker: Exclude<OpenPicker, null>) => setOpen((cur) => (cur === picker ? null : picker))

  return (
    <div
      className={styles.bulkBar}
      style={{ bottom }}
      role="toolbar"
      aria-label="Selected tasks"
      data-testid="list-bulk-bar"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className={styles.bulkCount}>{ids.length} selected</span>
      <span className={styles.bulkDate}>
        <button
          type="button"
          className={styles.bulkButton}
          title="Set due date"
          aria-label="Set due date"
          onClick={() => {
            try { dateRef.current?.showPicker?.() } catch { dateRef.current?.focus() }
          }}
        >
          <StatusIcon icon="calendar" />
        </button>
        <input
          ref={dateRef}
          type="date"
          tabIndex={-1}
          aria-hidden="true"
          className={styles.bulkDateInput}
          value=""
          onChange={(e) => {
            const raw = e.target.value
            void useTodoStore.getState().bulkSetDeadline(list, raw ? new Date(raw + 'T00:00:00') : null)
          }}
        />
      </span>
      <button
        ref={followupRef}
        type="button"
        className={`${styles.bulkButton} ${open === 'followup' ? styles.bulkButtonOpen : ''}`}
        title="Set follow-up"
        aria-label="Set follow-up"
        onClick={() => toggle('followup')}
      >
        <FollowupFlagIcon />
      </button>
      <button
        ref={peopleRef}
        type="button"
        className={`${styles.bulkButton} ${open === 'people' ? styles.bulkButtonOpen : ''}`}
        title="Assign people"
        aria-label="Assign people"
        onClick={() => toggle('people')}
      >
        <AtIcon />
      </button>
      <button
        ref={tagsRef}
        type="button"
        className={`${styles.bulkButton} ${open === 'tags' ? styles.bulkButtonOpen : ''}`}
        title="Add tag"
        aria-label="Add tag"
        onClick={() => toggle('tags')}
      >
        <HashIcon />
      </button>
      <button
        type="button"
        className={styles.bulkButton}
        title={`${allCompleted ? 'Reopen' : 'Complete'} (Space)`}
        aria-label={allCompleted ? 'Reopen' : 'Complete'}
        onClick={() => useUIStore.getState().showBulkConfirmation(allCompleted ? 'uncomplete' : 'complete', list)}
      >
        <CheckIcon />
      </button>
      <button
        ref={moreRef}
        type="button"
        className={`${styles.bulkButton} ${open === 'more' ? styles.bulkButtonOpen : ''}`}
        title="More"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open === 'more'}
        onClick={() => toggle('more')}
      >
        <MoreIcon />
      </button>
      <button
        type="button"
        className={`${styles.bulkButton} ${styles.bulkDanger}`}
        title="Delete (Del)"
        aria-label="Delete"
        onClick={() => useUIStore.getState().showBulkConfirmation('delete', list)}
      >
        <TrashIcon />
      </button>
      <span className={styles.bulkSep} aria-hidden="true" />
      <button
        type="button"
        className={styles.bulkButton}
        title="Clear selection (Esc)"
        aria-label="Clear selection"
        onClick={() => useUIStore.getState().clearSelection()}
      >
        <CloseIcon size={12} />
      </button>

      {open === 'followup' && followupSeed && (
        <FollowupPopover
          todo={followupSeed}
          anchor={{ kind: 'ref', ref: followupRef }}
          onClose={close}
          onSetNext={(d) => { void useTodoStore.getState().bulkSetFollowup(list, d) }}
          onFollowedUp={() => { void useTodoStore.getState().markFollowedUp(list) }}
          followedUpToday={selectedTodos.length > 0 && selectedTodos.every((t) => isFollowedUpToday(t, today))}
        />
      )}
      {open === 'more' && (
        <MenuPopover
          anchorRef={moreRef}
          placement="top-start"
          label="More actions"
          width={220}
          entries={[
            followedUpMenuEntry(selectedTodos, today, () => { void useTodoStore.getState().markFollowedUp(list) }),
            { kind: 'separator' },
            ...markerMenuEntries(selectedTodos, today, urgentRange, (marker, on) => {
              const store = useTodoStore.getState()
              if (marker === 'urgent') void setUrgent(list, on)
              else if (marker === 'important') void store.bulkSetImportant(list, on)
              else void store.bulkSetFocus(list, on)
            }),
          ]}
          onClose={close}
        />
      )}
      {open === 'people' && createPortal(
        <PortalDropdown anchorRef={peopleRef} onClickOutside={close}>
          <div className={styles.bulkPicker}>
            <ChipSelector
              items={people.map((p) => ({ id: p.id!, name: p.name }))}
              selectedIds={sharedPeople}
              onToggle={(personId) => {
                const ps = usePersonStore.getState()
                void (sharedPeople.has(personId) ? ps.bulkUnassignPerson(list, personId) : ps.bulkAssignPerson(list, personId))
              }}
              onCreate={async (name) => {
                const personId = await usePersonStore.getState().add(name, generateInitials(name))
                await usePersonStore.getState().bulkAssignPerson(list, personId)
              }}
              placeholder="Search people..."
            />
          </div>
        </PortalDropdown>,
        document.body,
      )}
      {open === 'tags' && createPortal(
        <PortalDropdown anchorRef={tagsRef} onClickOutside={close}>
          <div className={styles.bulkPicker}>
            <ChipSelector
              items={tags.map((t) => ({ id: t.id!, name: t.name }))}
              selectedIds={sharedTags}
              onToggle={(tagId) => {
                const ts = useTagStore.getState()
                void (sharedTags.has(tagId) ? ts.bulkUnassignTag(list, tagId) : ts.bulkAssignTag(list, tagId))
              }}
              onCreate={async (name) => {
                const tagId = await useTagStore.getState().add(name)
                await useTagStore.getState().bulkAssignTag(list, tagId)
              }}
              placeholder="Search tags..."
            />
          </div>
        </PortalDropdown>,
        document.body,
      )}
    </div>
  )
}
