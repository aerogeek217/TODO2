import { create } from 'zustand'
import type { PersistedTodoItem } from '../models'
import { Priority } from '../models'
import { todoRepository } from '../data'
import type { TaskMutation } from '../services/task-placement'
import { undoable } from '../services/undoable'
import { computeNextDueDate } from '../services/recurrence'
import { loadWithState, mutate, optimistic, captureAssignments, captureAssignmentsBulk, bulkUpdateField } from './store-helpers'
import { useSettingsStore } from './settings-store'

interface TodoState {
  todos: PersistedTodoItem[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  loadByProject: (projectId: number) => Promise<void>
  loadAll: () => Promise<void>
  add: (title: string, canvasId?: number, projectId?: number) => Promise<number>
  addAt: (title: string, projectId: number, canvasId: number, parentId: number | undefined, sortOrder: number) => Promise<number>
  update: (todo: PersistedTodoItem) => Promise<void>
  toggleComplete: (id: number) => Promise<void>
  toggleStar: (id: number) => Promise<void>
  toggleAssigned: (id: number) => Promise<void>
  remove: (id: number) => Promise<void>
  bulkSetCompleted: (ids: number[], completed: boolean) => Promise<void>
  bulkSetStarred: (ids: number[], starred: boolean) => Promise<void>
  bulkSetAssigned: (ids: number[], assigned: boolean) => Promise<void>
  bulkSetPriority: (ids: number[], priority: Priority) => Promise<void>
  bulkSetStatus: (ids: number[], statusId: number | undefined) => Promise<void>
  bulkSetDueDate: (ids: number[], date: Date | undefined) => Promise<void>
  bulkSetProject: (ids: number[], projectId: number | undefined) => Promise<void>
  bulkRemove: (ids: number[]) => Promise<void>
  reorder: (id: number, newSortOrder: number) => Promise<void>
  applyMutations: (mutations: TaskMutation[]) => Promise<void>
  purgeExpiredCompleted: (retentionDays: number) => Promise<number>
  duplicate: (id: number) => Promise<number | undefined>
  /** Internal: restore a deleted todo (for undo). */
  _restore: (todo: PersistedTodoItem, personIds: number[], tagIds: number[], orgIds: number[]) => Promise<void>
  /** Internal: remove without undo registration (for redo of add). */
  _removeNoUndo: (id: number) => Promise<void>
}

export const useTodoStore = create<TodoState>((set, get) => ({
  todos: [],
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    const todos = await loadWithState(set, () => todoRepository.getByCanvas(canvasId), 'todos by canvas')
    if (todos) set({ todos })
  },

  async loadByProject(projectId: number) {
    const todos = await loadWithState(set, () => todoRepository.getByProject(projectId), 'todos by project')
    if (todos) set({ todos })
  },

  async loadAll() {
    const todos = await loadWithState(set, () => todoRepository.getAll(), 'all todos')
    if (todos) set({ todos })
  },

  async add(title: string, canvasId?: number, projectId?: number) {
    return mutate(set, async () => {
      const { todos } = get()
      const maxSort = todos.reduce((max, t) => Math.max(max, t.sortOrder), 0)
      const now = new Date()
      const defaultStatusId = useSettingsStore.getState().defaultStatusId
      const id = await todoRepository.insert({
        title,
        priority: Priority.Normal,
        isCompleted: false,
        isStarred: false,
        createdAt: now,
        modifiedAt: now,
        sortOrder: maxSort + 1,
        canvasId,
        projectId,
        ...(defaultStatusId != null && { statusId: defaultStatusId }),
      })
      const todo = await todoRepository.getById(id)
      if (todo) {
        set({ todos: [...get().todos, todo] })
      }
      undoable(
        `Add "${title}"`,
        async () => { await get().add(title, canvasId, projectId) },
        () => get()._removeNoUndo(id),
      )
      return id
    }, 'Failed to add task')
  },

  async addAt(title: string, projectId: number, canvasId: number, parentId: number | undefined, sortOrder: number) {
    return mutate(set, async () => {
      const now = new Date()
      const defaultStatusId = useSettingsStore.getState().defaultStatusId
      const id = await todoRepository.insert({
        title,
        priority: Priority.Normal,
        isCompleted: false,
        isStarred: false,
        createdAt: now,
        modifiedAt: now,
        sortOrder,
        canvasId,
        projectId,
        parentId,
        ...(defaultStatusId != null && { statusId: defaultStatusId }),
      })
      const todo = await todoRepository.getById(id)
      if (todo) {
        set({ todos: [...get().todos, todo] })
      }
      undoable(
        `Add "${title}"`,
        async () => { await get().addAt(title, projectId, canvasId, parentId, sortOrder) },
        () => get()._removeNoUndo(id),
      )
      return id
    }, 'Failed to add task')
  },

  async update(todo: PersistedTodoItem) {
    const prev = get().todos.find((t) => t.id === todo.id)
    if (!prev) return
    const snapshot = { ...prev }
    const now = new Date()
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) => (t.id === todo.id ? { ...todo, modifiedAt: now } : t)),
      }),
      () => todoRepository.update(todo),
      () => set({
        todos: get().todos.map((t) => (t.id === todo.id ? snapshot : t)),
      }),
      'Failed to update task',
      {
        description: `Edit "${todo.title}"`,
        redo: () => get().update(todo),
        undo: () => get().update(snapshot),
      },
    )
  },

  async toggleComplete(id: number) {
    const todo = get().todos.find((t) => t.id === id)
    if (!todo) return

    // Recurring task: advance due date instead of completing
    if (!todo.isCompleted && todo.recurrenceRule && todo.dueDate) {
      const prevDueDate = todo.dueDate
      const nextDueDate = computeNextDueDate(new Date(prevDueDate), todo.recurrenceRule)
      return optimistic(
        set,
        () => set({
          todos: get().todos.map((t) =>
            t.id === id ? { ...t, dueDate: nextDueDate, modifiedAt: new Date() } : t
          ),
        }),
        () => todoRepository.bulkUpdate([{ todoId: id, changes: { dueDate: nextDueDate } }]),
        () => set({
          todos: get().todos.map((t) =>
            t.id === id ? { ...t, dueDate: prevDueDate } : t
          ),
        }),
        'Failed to advance recurring task',
        {
          description: `Advance recurring "${todo.title}"`,
          redo: async () => {
            await todoRepository.bulkUpdate([{ todoId: id, changes: { dueDate: nextDueDate } }])
            set({
              todos: get().todos.map((t) =>
                t.id === id ? { ...t, dueDate: nextDueDate, modifiedAt: new Date() } : t
              ),
            })
          },
          undo: async () => {
            await todoRepository.bulkUpdate([{ todoId: id, changes: { dueDate: prevDueDate } }])
            set({
              todos: get().todos.map((t) =>
                t.id === id ? { ...t, dueDate: prevDueDate, modifiedAt: new Date() } : t
              ),
            })
          },
          showSnackbar: true,
        },
      )
    }

    const completed = !todo.isCompleted
    const label = completed ? 'Complete' : 'Uncomplete'
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isCompleted: completed, modifiedAt: new Date() } : t
        ),
      }),
      () => todoRepository.complete(id, completed),
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isCompleted: !completed } : t
        ),
      }),
      'Failed to toggle task completion',
      {
        description: `${label} "${todo.title}"`,
        redo: () => get().toggleComplete(id),
        undo: () => get().toggleComplete(id),
      },
    )
  },

  async toggleStar(id: number) {
    const todo = get().todos.find((t) => t.id === id)
    if (!todo) return
    const starred = !todo.isStarred
    const label = starred ? 'Star' : 'Unstar'
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isStarred: starred, modifiedAt: new Date() } : t
        ),
      }),
      () => todoRepository.toggleStar(id, starred),
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isStarred: !starred } : t
        ),
      }),
      'Failed to toggle star',
      {
        description: `${label} "${todo.title}"`,
        redo: () => get().toggleStar(id),
        undo: () => get().toggleStar(id),
      },
    )
  },

  async toggleAssigned(id: number) {
    const todo = get().todos.find((t) => t.id === id)
    if (!todo) return
    const assigned = !todo.isAssigned
    const label = assigned ? 'Assign' : 'Unassign'
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isAssigned: assigned || undefined, modifiedAt: new Date() } : t
        ),
      }),
      () => todoRepository.toggleAssigned(id, assigned),
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isAssigned: !assigned || undefined } : t
        ),
      }),
      'Failed to toggle assigned',
      {
        description: `${label} "${todo.title}"`,
        redo: () => get().toggleAssigned(id),
        undo: () => get().toggleAssigned(id),
      },
    )
  },

  async remove(id: number) {
    return mutate(set, async () => {
      const todo = get().todos.find((t) => t.id === id)
      if (!todo) return
      const snapshot = { ...todo }
      const { personIds, tagIds, orgIds } = await captureAssignments(id)

      await todoRepository.delete(id)
      set({ todos: get().todos.filter((t) => t.id !== id) })

      undoable(
        `Delete "${todo.title}"`,
        () => get()._removeNoUndo(id),
        () => get()._restore(snapshot, personIds, tagIds, orgIds),
        true,
      )
    }, 'Failed to delete task')
  },

  async bulkSetCompleted(ids: number[], completed: boolean) {
    // Split recurring tasks (advance date) from normal tasks (toggle completion)
    const allTodos = get().todos.filter((t) => ids.includes(t.id))
    const recurringTodos = completed
      ? allTodos.filter((t) => !t.isCompleted && t.recurrenceRule && t.dueDate)
      : []
    const recurringIds = new Set(recurringTodos.map((t) => t.id))
    const normalIds = ids.filter((id) => !recurringIds.has(id))

    // Capture previous state for rollback/undo
    const recurringPrevDates = recurringTodos.map((t) => ({ id: t.id, prevDueDate: t.dueDate! }))
    const recurringMutations = recurringTodos.map((t) => ({
      todoId: t.id,
      changes: { dueDate: computeNextDueDate(new Date(t.dueDate!), t.recurrenceRule!) },
    }))
    const prevStates = get().todos
      .filter((t) => normalIds.includes(t.id))
      .map((t) => ({ id: t.id, wasCompleted: t.isCompleted }))
    const normalIdSet = new Set(normalIds)
    const recurringDateMap = new Map(recurringMutations.map(m => [m.todoId, m.changes.dueDate]))

    const label = completed ? 'Complete' : 'Uncomplete'
    return optimistic(
      set,
      () => {
        const now = new Date()
        set({
          todos: get().todos.map((t) => {
            if (recurringDateMap.has(t.id)) {
              return { ...t, dueDate: recurringDateMap.get(t.id)!, modifiedAt: now }
            }
            if (normalIdSet.has(t.id)) {
              return { ...t, isCompleted: completed, modifiedAt: now }
            }
            return t
          }),
        })
      },
      async () => {
        if (recurringMutations.length > 0) {
          await todoRepository.bulkUpdate(recurringMutations)
        }
        await Promise.all(normalIds.map((id) => todoRepository.complete(id, completed)))
      },
      () => {
        // Item-level rollback: restore per-item previous values
        const prevDateMap = new Map(recurringPrevDates.map(s => [s.id, s.prevDueDate]))
        const prevCompletedMap = new Map(prevStates.map(s => [s.id, s.wasCompleted]))
        set({
          todos: get().todos.map((t) => {
            if (prevDateMap.has(t.id)) {
              return { ...t, dueDate: prevDateMap.get(t.id)! }
            }
            if (prevCompletedMap.has(t.id)) {
              return { ...t, isCompleted: prevCompletedMap.get(t.id)! }
            }
            return t
          }),
        })
      },
      `Failed to ${label.toLowerCase()} tasks`,
      {
        description: `${label} ${ids.length} tasks`,
        redo: () => get().bulkSetCompleted(ids, completed),
        undo: async () => {
          // Revert recurring date advances
          if (recurringPrevDates.length > 0) {
            const revertMutations = recurringPrevDates.map(s => ({
              todoId: s.id, changes: { dueDate: s.prevDueDate },
            }))
            await todoRepository.bulkUpdate(revertMutations)
            const revertDateMap = new Map(recurringPrevDates.map(s => [s.id, s.prevDueDate]))
            set({
              todos: get().todos.map((t) =>
                revertDateMap.has(t.id) ? { ...t, dueDate: revertDateMap.get(t.id)!, modifiedAt: new Date() } : t
              ),
            })
          }
          // Revert normal completions
          for (const { id, wasCompleted } of prevStates) {
            if (wasCompleted !== completed) {
              await todoRepository.complete(id, wasCompleted)
            }
          }
          const revertIds = prevStates.filter(s => s.wasCompleted !== completed).map(s => s.id)
          if (revertIds.length > 0) {
            const revertSet = new Set(revertIds)
            const stateMap = new Map(prevStates.map(s => [s.id, s.wasCompleted]))
            set({
              todos: get().todos.map((t) =>
                revertSet.has(t.id) ? { ...t, isCompleted: stateMap.get(t.id)!, modifiedAt: new Date() } : t
              ),
            })
          }
        },
        showSnackbar: true,
      },
    )
  },

  async bulkSetStarred(ids: number[], starred: boolean) {
    const prevStates = get().todos
      .filter((t) => ids.includes(t.id))
      .map((t) => ({ id: t.id, wasStarred: t.isStarred }))
    const idSet = new Set(ids)

    return optimistic(
      set,
      () => {
        const now = new Date()
        set({
          todos: get().todos.map((t) =>
            idSet.has(t.id) ? { ...t, isStarred: starred, modifiedAt: now } : t
          ),
        })
      },
      () => Promise.all(ids.map((id) => todoRepository.toggleStar(id, starred))).then(() => {}),
      () => {
        const prevMap = new Map(prevStates.map(s => [s.id, s.wasStarred]))
        set({
          todos: get().todos.map((t) =>
            prevMap.has(t.id) ? { ...t, isStarred: prevMap.get(t.id)! } : t
          ),
        })
      },
      'Failed to toggle stars',
      {
        description: `${starred ? 'Star' : 'Unstar'} ${ids.length} tasks`,
        redo: () => get().bulkSetStarred(ids, starred),
        undo: async () => {
          for (const { id, wasStarred } of prevStates) {
            if (wasStarred !== starred) {
              await todoRepository.toggleStar(id, wasStarred)
            }
          }
          const revertIds = prevStates.filter(s => s.wasStarred !== starred).map(s => s.id)
          if (revertIds.length > 0) {
            const revertSet = new Set(revertIds)
            const stateMap = new Map(prevStates.map(s => [s.id, s.wasStarred]))
            set({
              todos: get().todos.map((t) =>
                revertSet.has(t.id) ? { ...t, isStarred: stateMap.get(t.id)!, modifiedAt: new Date() } : t
              ),
            })
          }
        },
      },
    )
  },

  async bulkSetAssigned(ids: number[], assigned: boolean) {
    const prevStates = get().todos
      .filter((t) => ids.includes(t.id))
      .map((t) => ({ id: t.id, wasAssigned: !!t.isAssigned }))
    const idSet = new Set(ids)

    return optimistic(
      set,
      () => {
        const now = new Date()
        set({
          todos: get().todos.map((t) =>
            idSet.has(t.id) ? { ...t, isAssigned: assigned || undefined, modifiedAt: now } : t
          ),
        })
      },
      () => Promise.all(ids.map((id) => todoRepository.toggleAssigned(id, assigned))).then(() => {}),
      () => {
        const prevMap = new Map(prevStates.map(s => [s.id, s.wasAssigned]))
        set({
          todos: get().todos.map((t) =>
            prevMap.has(t.id) ? { ...t, isAssigned: prevMap.get(t.id)! || undefined } : t
          ),
        })
      },
      'Failed to toggle assigned',
      {
        description: `${assigned ? 'Assign' : 'Unassign'} ${ids.length} tasks`,
        redo: () => get().bulkSetAssigned(ids, assigned),
        undo: async () => {
          for (const { id, wasAssigned } of prevStates) {
            if (wasAssigned !== assigned) {
              await todoRepository.toggleAssigned(id, wasAssigned)
            }
          }
          const revertIds = prevStates.filter(s => s.wasAssigned !== assigned).map(s => s.id)
          if (revertIds.length > 0) {
            const revertSet = new Set(revertIds)
            const stateMap = new Map(prevStates.map(s => [s.id, s.wasAssigned]))
            set({
              todos: get().todos.map((t) =>
                revertSet.has(t.id) ? { ...t, isAssigned: stateMap.get(t.id)! || undefined, modifiedAt: new Date() } : t
              ),
            })
          }
        },
      },
    )
  },

  async bulkSetPriority(ids: number[], priority: Priority) {
    await bulkUpdateField(ids, 'priority', priority, `Set priority on ${ids.length} tasks`, get, set)
  },

  async bulkSetStatus(ids: number[], statusId: number | undefined) {
    await bulkUpdateField(ids, 'statusId', statusId, `Set status on ${ids.length} tasks`, get, set)
  },

  async bulkSetDueDate(ids: number[], date: Date | undefined) {
    await bulkUpdateField(ids, 'dueDate', date, `Set due date on ${ids.length} tasks`, get, set)
  },

  async bulkSetProject(ids: number[], projectId: number | undefined) {
    await bulkUpdateField(ids, 'projectId', projectId, `Move ${ids.length} tasks to project`, get, set)
  },

  async bulkRemove(ids: number[]) {
    return mutate(set, async () => {
      if (ids.length > 5) {
        const { backupScheduler } = await import('../services/backup-scheduler')
        await backupScheduler.snapshotBeforeDestructive().catch(() => {})
      }
      const snapshots = get().todos.filter((t) => ids.includes(t.id)).map(t => ({ ...t }))
      const assignments = await captureAssignmentsBulk(ids)
      const assignmentData = snapshots.map(t => {
        const a = assignments.find(a => a.todoId === t.id)!
        return { todo: t, personIds: a.personIds, tagIds: a.tagIds, orgIds: a.orgIds }
      })

      await todoRepository.bulkDelete(ids)
      const idSet = new Set(ids)
      set({ todos: get().todos.filter((t) => !idSet.has(t.id)) })

      undoable(
        `Delete ${ids.length} tasks`,
        () => get().bulkRemove(ids),
        async () => {
          for (const { todo, personIds, tagIds, orgIds } of assignmentData) {
            await get()._restore(todo, personIds, tagIds, orgIds)
          }
        },
        true,
      )
    }, 'Failed to delete tasks')
  },

  async reorder(id: number, newSortOrder: number) {
    const todo = get().todos.find((t) => t.id === id)
    if (!todo) return
    const prevSortOrder = todo.sortOrder
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, sortOrder: newSortOrder } : t
        ),
      }),
      () => todoRepository.reorder(id, newSortOrder),
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, sortOrder: prevSortOrder } : t
        ),
      }),
      'Failed to reorder task',
      {
        description: 'Reorder task',
        redo: () => get().reorder(id, newSortOrder),
        undo: () => get().reorder(id, prevSortOrder),
      },
    )
  },

  async applyMutations(mutations: TaskMutation[]) {
    if (mutations.length === 0) return
    // Capture previous state for undo/rollback
    const prevState = new Map<number, Partial<PersistedTodoItem>>()
    for (const m of mutations) {
      const todo = get().todos.find(t => t.id === m.todoId)
      if (todo) {
        const prev: Partial<PersistedTodoItem> = {}
        if ('projectId' in m.changes) prev.projectId = todo.projectId
        if ('parentId' in m.changes) prev.parentId = todo.parentId
        if ('sortOrder' in m.changes) prev.sortOrder = todo.sortOrder
        prevState.set(m.todoId, prev)
      }
    }
    const mutationMap = new Map(mutations.map(m => [m.todoId, m.changes]))

    return optimistic(
      set,
      () => {
        const now = new Date()
        set({
          todos: get().todos.map(t => {
            const changes = mutationMap.get(t.id)
            if (!changes) return t
            return { ...t, ...changes, modifiedAt: now }
          }),
        })
      },
      () => todoRepository.bulkUpdate(mutations),
      () => set({
        todos: get().todos.map(t => {
          const prev = prevState.get(t.id)
          if (!prev) return t
          return { ...t, ...prev }
        }),
      }),
      'Failed to apply task mutations',
      {
        description: `Move ${mutations.length} tasks`,
        redo: () => get().applyMutations(mutations),
        undo: () => get().applyMutations(
          Array.from(prevState.entries()).map(([todoId, changes]) => ({ todoId, changes })),
        ),
      },
    )
  },

  async duplicate(id: number) {
    return mutate(set, async () => {
      const todo = get().todos.find((t) => t.id === id)
      if (!todo) return undefined
      const now = new Date()
      const maxSort = get().todos.reduce((max, t) => Math.max(max, t.sortOrder), 0)
      const newId = await todoRepository.insert({
        title: todo.title,
        priority: todo.priority,
        isCompleted: false,
        isStarred: todo.isStarred,
        createdAt: now,
        modifiedAt: now,
        sortOrder: maxSort + 1,
        canvasId: todo.canvasId,
        projectId: todo.projectId,
        parentId: todo.parentId,
        dueDate: todo.dueDate,
        notes: todo.notes,
        progress: todo.progress,
        statusId: todo.statusId,
        recurrenceRule: todo.recurrenceRule,
        isHardDeadline: todo.isHardDeadline,
      })
      const newTodo = await todoRepository.getById(newId)
      if (newTodo) {
        set({ todos: [...get().todos, newTodo] })
      }
      // Copy assignments at repo level (bypasses store undo registration)
      const { personIds, tagIds, orgIds } = await captureAssignments(id)
      const { personRepository } = await import('../data/person-repository')
      const { tagRepository } = await import('../data/tag-repository')
      const { orgRepository } = await import('../data/org-repository')
      for (const pid of personIds) await personRepository.assignPerson(newId, pid)
      for (const tid of tagIds) await tagRepository.addTagToTodo(newId, tid)
      for (const oid of orgIds) await orgRepository.assignOrg(newId, oid)
      // Refresh assignment caches for the new task
      if (personIds.length > 0 || tagIds.length > 0 || orgIds.length > 0) {
        const { usePersonStore } = await import('./person-store')
        const { useTagStore } = await import('./tag-store')
        const { useOrgStore } = await import('./org-store')
        const todoIds = get().todos.map(t => t.id)
        if (personIds.length > 0) await usePersonStore.getState().loadAssignments(todoIds)
        if (tagIds.length > 0) await useTagStore.getState().loadAssignments(todoIds)
        if (orgIds.length > 0) await useOrgStore.getState().loadAssignments(todoIds)
      }
      undoable(
        `Duplicate "${todo.title}"`,
        async () => { await get().duplicate(id) },
        () => get()._removeNoUndo(newId),
      )
      return newId
    }, 'Failed to duplicate task')
  },

  async _restore(todo: PersistedTodoItem, personIds: number[], tagIds: number[], orgIds: number[] = []) {
    await todoRepository.restoreWithAssignments(todo, personIds, tagIds, orgIds)
    set({ todos: [...get().todos, todo] })
    // Refresh assignment caches
    const todoIds = get().todos.map(t => t.id)
    if (personIds.length > 0 || tagIds.length > 0 || orgIds.length > 0) {
      const { usePersonStore } = await import('./person-store')
      const { useTagStore } = await import('./tag-store')
      const { useOrgStore } = await import('./org-store')
      if (personIds.length > 0) {
        await usePersonStore.getState().loadAssignments(todoIds)
      }
      if (tagIds.length > 0) {
        await useTagStore.getState().loadAssignments(todoIds)
      }
      if (orgIds.length > 0) {
        await useOrgStore.getState().loadAssignments(todoIds)
      }
    }
  },

  async _removeNoUndo(id: number) {
    await todoRepository.delete(id)
    set({ todos: get().todos.filter((t) => t.id !== id) })
  },

  async purgeExpiredCompleted(retentionDays: number) {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - retentionDays)
    const expired = get().todos.filter(
      (t) => t.isCompleted && new Date(t.modifiedAt) < cutoff
    )
    if (expired.length === 0) return 0
    // Snapshot before destructive purge
    const { backupScheduler } = await import('../services/backup-scheduler')
    await backupScheduler.snapshotBeforeDestructive().catch(() => {})
    const ids = expired.map((t) => t.id)
    await todoRepository.bulkDelete(ids)
    const idSet = new Set(ids)
    set({ todos: get().todos.filter((t) => !idSet.has(t.id)) })
    return ids.length
  },

}))
