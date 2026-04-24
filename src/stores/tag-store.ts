import { create } from 'zustand'
import type { Tag } from '../models'
import { db, tagRepository } from '../data'
import { createAssignmentActions } from './assignment-helpers'
import { loadWithState, optimistic, updateEntityInMap, captureJoinRows, restoreEntityWithJoins } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from '../services/undoable'
import { useSettingsStore } from './settings-store'

/**
 * Thrown when `useTagStore.add` is called while the registry is at the
 * configured ceiling (`settings.maxTags`). The message is phrased for direct
 * user surfacing; `nlp-resolver.resolveTags` catches and logs it so a single
 * runaway `#tag` input can't break the whole task-create flow.
 */
export class TagLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagLimitError'
  }
}

interface TagState {
  tags: Tag[]
  assignedTagsMap: Map<number, Tag[]>
  loading: boolean
  error: string | null

  load: () => Promise<void>
  add: (name: string, color?: string) => Promise<number>
  update: (tag: Tag) => Promise<void>
  remove: (id: number) => Promise<void>
  loadAssignments: (todoIds: number[]) => Promise<void>
  assignTag: (todoId: number, tagId: number) => Promise<void>
  unassignTag: (todoId: number, tagId: number) => Promise<void>
  bulkAssignTag: (todoIds: number[], tagId: number) => Promise<void>
  bulkUnassignTag: (todoIds: number[], tagId: number) => Promise<void>
  getAssignedTags: (todoId: number) => Tag[]
}

export const useTagStore = create<TagState>((set, get) => {
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
    set,
  )

  return {
    tags: [],
    assignedTagsMap: new Map(),
    loading: false,
    error: null,

    async load() {
      const tags = await loadWithState(set, () => tagRepository.getAll(), 'tags')
      if (tags) set({ tags })
    },

    async add(name: string, color = DEFAULT_ENTITY_COLOR) {
      const trimmed = name.trim()
      const target = trimmed.toLowerCase()
      const existing = get().tags.find(
        (t) => t.name.trim().toLowerCase() === target && t.id !== undefined,
      )
      if (existing?.id != null) return existing.id
      const { maxTags } = useSettingsStore.getState()
      if (get().tags.length >= maxTags) {
        throw new TagLimitError(
          `Tag limit reached (${maxTags}) — delete unused tags in Settings → Tags.`,
        )
      }
      const id = await tagRepository.getOrCreate(trimmed, color)
      if (!get().tags.some((t) => t.id === id)) {
        set({ tags: [...get().tags, { id, name: trimmed, color }] })
      }
      return id
    },

    async update(tag: Tag) {
      const prevTags = get().tags
      const prevMap = get().assignedTagsMap
      return optimistic(
        set,
        () => set({
          tags: prevTags.map((t) => (t.id === tag.id ? { ...tag } : t)),
          assignedTagsMap: updateEntityInMap(tag, prevMap),
        }),
        () => tagRepository.update(tag),
        () => set({ tags: prevTags, assignedTagsMap: prevMap }),
        'Failed to update tag',
      )
    },

    async remove(id: number) {
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
            await restoreEntityWithJoins(db.tags, tag, joins)
            await get().load()
            const { useTodoStore } = await import('./todo-store')
            const todoIds = useTodoStore.getState().todos.map((t) => t.id)
            await get().loadAssignments(todoIds)
          },
          true,
        )
      }
    },

    loadAssignments: assignment.loadAssignments,
    assignTag: assignment.assign,
    unassignTag: assignment.unassign,
    bulkAssignTag: assignment.bulkAssign,
    bulkUnassignTag: assignment.bulkUnassign,

    getAssignedTags(todoId: number) {
      return get().assignedTagsMap.get(todoId) ?? []
    },
  }
})
