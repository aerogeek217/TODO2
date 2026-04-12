import { create } from 'zustand'
import type { Tag } from '../models'
import { db, tagRepository } from '../data'
import { createAssignmentActions } from './assignment-helpers'
import { loadWithState, updateEntityInMap, captureJoinRows, restoreEntityWithJoins } from './store-helpers'
import { DEFAULT_ENTITY_COLOR } from '../constants'
import { undoable } from '../services/undoable'

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
}

export const useTagStore = create<TagState>((set, get) => {
  const assignment = createAssignmentActions(
    {
      repo: {
        assign: tagRepository.addTagToTodo,
        unassign: tagRepository.removeTagFromTodo,
        getForTodos: tagRepository.getTagsForTodos,
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
    loading: false,
    error: null,

    async load() {
      const tags = await loadWithState(set, () => tagRepository.getAll(), 'tags')
      if (tags) set({ tags })
    },

    async add(name: string, color = DEFAULT_ENTITY_COLOR) {
      const id = await tagRepository.insert({ name, color })
      set({ tags: [...get().tags, { id, name, color }] })
      return id
    },

    async update(tag: Tag) {
      await tagRepository.update(tag)
      set({
        tags: get().tags.map((t) => (t.id === tag.id ? { ...tag } : t)),
        assignedTagsMap: updateEntityInMap(tag, get().assignedTagsMap),
      })
    },

    async remove(id: number) {
      const tag = get().tags.find((t) => t.id === id)
      const joins = await captureJoinRows([
        { table: db.todoTags, key: 'tagId', id },
      ])
      await tagRepository.delete(id)
      set({ tags: get().tags.filter((t) => t.id !== id) })
      if (tag) {
        undoable(
          `Delete tag "${tag.name}"`,
          () => get().remove(id),
          async () => {
            await restoreEntityWithJoins(db.tags, tag, joins)
            await get().load()
            const { useTodoStore } = await import('./todo-store')
            const todoIds = useTodoStore.getState().todos.map(t => t.id)
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
  }
})
