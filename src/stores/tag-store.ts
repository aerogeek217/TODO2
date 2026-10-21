import { create } from 'zustand'
import type { Tag } from '../models'
import { db, tagRepository } from '../data'
import { captureJoinRows } from '../data/join-helpers'
import { createAssignmentActions, type LoadAssignmentsOptions } from './assignment-helpers'
import { loadFresh, optimistic, updateEntityInMap, makeEnsureLoaded, trackWrite } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from './undoable'

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
  /** How many tasks (any, loaded or not) carry the tag — read from the database, for the delete confirm. */
  countTasks: (tagId: number) => Promise<number>
  loadAssignments: (todoIds: number[], options?: LoadAssignmentsOptions) => Promise<void>
  assignTag: (todoId: number, tagId: number) => Promise<void>
  unassignTag: (todoId: number, tagId: number) => Promise<void>
  bulkAssignTag: (todoIds: number[], tagId: number) => Promise<void>
  bulkUnassignTag: (todoIds: number[], tagId: number) => Promise<void>
}

export const useTagStore = create<TagState>((set, get) => {
  const tagEnsure = makeEnsureLoaded(() => get().load(), () => get().loaded)
  const assignment = createAssignmentActions(
    {
      repo: {
        assign: tagRepository.assignTag,
        unassign: tagRepository.unassignTag,
        bulkAssign: tagRepository.bulkAssignTag,
        bulkUnassign: tagRepository.bulkUnassignTag,
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

    countTasks(tagId: number) {
      return tagRepository.getTodoCount(tagId)
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
              // The restored joins are in the database, not in the map: re-read
              // the assignments of the tasks the map holds (its keys).
              await get().loadAssignments([...get().assignedTagsMap.keys()], { refetch: true })
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
  }
})
