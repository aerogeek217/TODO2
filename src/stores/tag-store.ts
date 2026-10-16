import { create } from 'zustand'
import type { Tag } from '../models'
import { db, tagRepository } from '../data'
import { captureJoinRows } from '../data/join-helpers'
import { createAssignmentActions, type LoadAssignmentsOptions } from './assignment-helpers'
import { loadFresh, optimistic, updateEntityInMap, makeEnsureLoaded, trackWrite } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from './undoable'
import { useSettingsStore } from './settings-store'
import { TagLimitError } from '../utils/tags'

interface TagState {
  tags: Tag[]
  assignedTagsMap: Map<number, Tag[]>
  /** A load has read the rows (a failed load leaves it false, so `ensureLoaded` retries). */
  loaded: boolean

  load: () => Promise<void>
  ensureLoaded: () => Promise<void>
  add: (name: string, color?: string) => Promise<number>
  update: (tag: Tag) => Promise<void>
  remove: (id: number) => Promise<void>
  loadAssignments: (todoIds: number[], options?: LoadAssignmentsOptions) => Promise<void>
  assignTag: (todoId: number, tagId: number) => Promise<void>
  unassignTag: (todoId: number, tagId: number) => Promise<void>
  bulkAssignTag: (todoIds: number[], tagId: number) => Promise<void>
  bulkUnassignTag: (todoIds: number[], tagId: number) => Promise<void>
  /**
   * Count todos currently tagged with `tagId`, derived from the in-memory
   * `assignedTagsMap`. Replaces `tagRepository.getTodoCount` for editor
   * delete-confirmation prompts. The count reflects whatever todos have had
   * their assignments loaded — caller should ensure `loadAssignments(allIds)`
   * has run for the visible todo set (TagEditor calls it on mount).
   */
  selectTodoCountByTagId: (tagId: number) => number
}

/** Tag id → number of loaded todos carrying it, from an `assignedTagsMap`. */
export function countTodosByTag(assignedTagsMap: ReadonlyMap<number, readonly Tag[]>): Map<number, number> {
  const counts = new Map<number, number>()
  for (const tags of assignedTagsMap.values()) {
    for (const tag of tags) {
      if (tag.id == null) continue
      counts.set(tag.id, (counts.get(tag.id) ?? 0) + 1)
    }
  }
  return counts
}

export const useTagStore = create<TagState>((set, get) => {
  const tagEnsure = makeEnsureLoaded(() => get().load(), () => get().loaded)
  const assignment = createAssignmentActions(
    {
      repo: {
        assign: tagRepository.assignTag,
        unassign: tagRepository.unassignTag,
        getForTodos: tagRepository.getAssignedTagsForTodos,
      },
      label: 'tag',
      getName: (t) => t.name,
    },
    () => get().tags,
    () => get().assignedTagsMap,
    (map) => set({ assignedTagsMap: map }),
  )

  return {
    tags: [],
    assignedTagsMap: new Map(),
    loaded: false,

    async load() {
      const tags = await loadFresh(() => tagRepository.getAll(), 'tags')
      if (tags) set({ tags, loaded: true })
    },
    ensureLoaded: tagEnsure,

    add(name: string, color = DEFAULT_ENTITY_COLOR) {
      return trackWrite(async () => {
        const trimmed = name.trim()
        const target = trimmed.toLowerCase()
        const existing = get().tags.find(
          (t) => t.name.trim().toLowerCase() === target && t.id !== undefined,
        )
        if (existing?.id != null) return existing.id
        const { maxTags } = useSettingsStore.getState()
        if (get().tags.length >= maxTags) {
          throw new TagLimitError(
            `Tag limit reached (${maxTags}) — delete unused tags in Settings → People, statuses & tags.`,
          )
        }
        const id = await tagRepository.getOrCreate(trimmed, color)
        if (!get().tags.some((t) => t.id === id)) {
          set({ tags: [...get().tags, { id, name: trimmed, color }] })
        }
        return id
      })
    },

    async update(tag: Tag) {
      const prev = get().tags.find((t) => t.id === tag.id)
      const applied = { ...tag }
      const put = (t: Tag) => set({
        tags: get().tags.map((q) => (q.id === t.id ? t : q)),
        assignedTagsMap: updateEntityInMap(t, get().assignedTagsMap),
      })
      return optimistic(
        () => put(applied),
        () => tagRepository.update(tag),
        // Only this tag, and only while it still holds this edit.
        () => { if (prev && get().tags.find((t) => t.id === tag.id) === applied) put(prev) },
        'Failed to update tag',
      )
    },

    remove(id: number) {
      return trackWrite(async () => {
        const tag = get().tags.find((t) => t.id === id)
        const joins = await captureJoinRows([
          { table: db.todoTags, key: 'tagId', id },
        ])
        await tagRepository.delete(id)
        const prevMap = get().assignedTagsMap
        const nextMap = new Map(
          Array.from(prevMap, ([k, tags]) => [k, tags.filter((t) => t.id !== id)] as const),
        )
        set({
          tags: get().tags.filter((t) => t.id !== id),
          assignedTagsMap: nextMap,
        })
        if (tag) {
          undoable(
            `Delete tag "${tag.name}"`,
            () => get().remove(id),
            async () => {
              await tagRepository.restoreWithJoins(tag, joins)
              await get().load()
              // Imported here: todo-store imports this store, so a static import back would be a cycle.
              const { useTodoStore } = await import('./todo-store')
              const todoIds = useTodoStore.getState().todos.map((t) => t.id)
              await get().loadAssignments(todoIds)
            },
            true,
          )
        }
      })
    },

    loadAssignments: assignment.loadAssignments,
    assignTag: assignment.assign,
    unassignTag: assignment.unassign,
    bulkAssignTag: assignment.bulkAssign,
    bulkUnassignTag: assignment.bulkUnassign,

    selectTodoCountByTagId(tagId: number) {
      let count = 0
      for (const tags of get().assignedTagsMap.values()) {
        if (tags.some((t) => t.id === tagId)) count++
      }
      return count
    },
  }
})
