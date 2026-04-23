import { create } from 'zustand'
import type { PersistedTodoItem } from '../models'
import type { ScheduledValue } from '../models/scheduled-value'
import { todoRepository } from '../data'
import { db } from '../data/database'
import type { TaskMutation } from '../services/task-placement'
import { undoable } from '../services/undoable'
import { advanceRecurring } from '../services/recurrence'
import { loadWithState, mutate, optimistic, captureAssignments, captureAssignmentsBulk, bulkUpdateField, type SetFn } from './store-helpers'
import { useSettingsStore } from './settings-store'
import { useTagStore } from './tag-store'
import { resolveTags } from '../services/nlp-resolver'
import { normalizeTag, normalizeTags, renameTagInArray, tagsEqual } from '../utils/tags'

interface TodoState {
  todos: PersistedTodoItem[]
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  loadByProject: (projectId: number) => Promise<void>
  loadAll: () => Promise<void>
  add: (title: string, canvasId?: number, projectId?: number) => Promise<number>
  addAt: (title: string, projectId: number, canvasId: number, sortOrder: number) => Promise<number>
  update: (todo: PersistedTodoItem) => Promise<void>
  toggleComplete: (id: number) => Promise<void>
  remove: (id: number) => Promise<void>
  bulkSetCompleted: (ids: number[], completed: boolean) => Promise<void>
  bulkSetStatus: (ids: number[], statusId: number | undefined) => Promise<void>
  bulkSetScheduled: (ids: number[], value: ScheduledValue | null) => Promise<void>
  bulkSetDeadline: (ids: number[], date: Date | null) => Promise<void>
  bulkSetProject: (ids: number[], projectId: number | undefined) => Promise<void>
  bulkRemove: (ids: number[]) => Promise<void>
  reorder: (id: number, newSortOrder: number) => Promise<void>
  applyMutations: (mutations: TaskMutation[]) => Promise<void>
  purgeExpiredCompleted: (retentionDays: number) => Promise<number>
  duplicate: (id: number) => Promise<number | undefined>
  // ─── pre-migration tag adapters (Phases 1–8) ──────────────────────────────
  // These still write the inline `todo.tags` field AND mirror every change
  // through `tag-store.assignTag` / `unassignTag` so the v36 registry stays in
  // sync. Phase 9 deletes them and wires every caller directly to `tag-store`.
  /** Append `tag` to the todo's tag set (normalized). Idempotent; no-op if already present. */
  addTag: (todoId: number, tag: string) => Promise<void>
  /** Remove `tag` from the todo's tag set (normalized). Idempotent; no-op if absent. */
  removeTag: (todoId: number, tag: string) => Promise<void>
  /** Bulk-replace the todo's tag set. Input is normalized and deduped first-seen. */
  setTags: (todoId: number, tags: readonly string[]) => Promise<void>
  /** Rewrite every occurrence of `from` → `to` across all todos; returns count of touched rows. */
  renameTag: (from: string, to: string) => Promise<number>
  /** Internal: restore a deleted todo (for undo). */
  _restore: (todo: PersistedTodoItem, personIds: number[], orgIds: number[]) => Promise<void>
  /** Internal: remove without undo registration (for redo of add). */
  _removeNoUndo: (id: number) => Promise<void>
}

/**
 * Persist a todo's tag array to Dexie. Empty arrays drop the key entirely —
 * post-v35 schema convention ("omitted when empty"). Must be called inside a
 * `db.todos` write transaction or on its own (Dexie auto-scopes single calls).
 */
async function writeTodoTags(todoId: number, next: string[], now: Date): Promise<void> {
  await db.todos.where(':id').equals(todoId).modify((row) => {
    if (next.length === 0) delete row.tags
    else row.tags = next
    row.modifiedAt = now
  })
}

/**
 * Pre-migration sync: after an inline tag write, mirror the change through
 * `tag-store` so the normalized registry (v36 `tags` + `todoTags` tables) stays
 * aligned. `added` slugs are resolved-or-created; `removed` slugs are matched
 * case-insensitively in the current store snapshot and unassigned. The whole
 * thing is best-effort — the inline write already succeeded, so a registry
 * failure here surfaces as a warning but doesn't roll back the inline field.
 * Phase 9 deletes this mirror + the inline field together.
 */
async function mirrorTagsToRegistry(
  todoId: number,
  added: readonly string[],
  removed: readonly string[],
): Promise<void> {
  try {
    if (added.length > 0) {
      const ids = await resolveTags(added, { tagStore: useTagStore.getState() })
      for (const tagId of ids) {
        await useTagStore.getState().assignTag(todoId, tagId)
      }
    }
    if (removed.length > 0) {
      const snapshot = useTagStore.getState().tags
      for (const slug of removed) {
        const lower = slug.trim().toLowerCase()
        const tag = snapshot.find((t) => t.name.trim().toLowerCase() === lower && t.id !== undefined)
        if (tag?.id !== undefined) {
          await useTagStore.getState().unassignTag(todoId, tag.id)
        }
      }
    }
  } catch (e) {
    console.warn('tag-store mirror failed', e)
  }
}

/** Mirror a single-todo tag change back into the in-memory store. */
function applyTodoTagsToState(
  set: SetFn,
  get: () => { todos: PersistedTodoItem[] },
  todoId: number,
  next: string[],
  now: Date,
): void {
  set({
    todos: get().todos.map((t) => {
      if (t.id !== todoId) return t
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { tags: _prev, ...rest } = t
      return next.length > 0
        ? { ...rest, tags: next, modifiedAt: now }
        : { ...rest, modifiedAt: now }
    }),
  })
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
        isCompleted: false,
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

  async addAt(title: string, projectId: number, canvasId: number, sortOrder: number) {
    return mutate(set, async () => {
      const now = new Date()
      const defaultStatusId = useSettingsStore.getState().defaultStatusId
      const id = await todoRepository.insert({
        title,
        isCompleted: false,
        createdAt: now,
        modifiedAt: now,
        sortOrder,
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
        async () => { await get().addAt(title, projectId, canvasId, sortOrder) },
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

    // Recurring task: advance its anchor date (dueDate or precise scheduledDate) instead of completing
    if (!todo.isCompleted && todo.recurrenceRule) {
      const advance = advanceRecurring(todo)
      if (advance) {
        const isDue = advance.field === 'dueDate'
        const prevValue: Date | ScheduledValue | undefined = isDue ? todo.dueDate : todo.scheduledDate
        const nextChanges = isDue
          ? { dueDate: advance.dueDate! }
          : { scheduledDate: advance.scheduledDate! }
        const prevChanges = isDue
          ? { dueDate: prevValue as Date }
          : { scheduledDate: prevValue as ScheduledValue }
        return optimistic(
          set,
          () => set({
            todos: get().todos.map((t) =>
              t.id === id ? { ...t, ...nextChanges, modifiedAt: new Date() } : t
            ),
          }),
          () => todoRepository.bulkUpdate([{ todoId: id, changes: nextChanges }]),
          () => set({
            todos: get().todos.map((t) =>
              t.id === id ? { ...t, ...prevChanges } : t
            ),
          }),
          'Failed to advance recurring task',
          {
            description: `Advance recurring "${todo.title}"`,
            redo: async () => {
              await todoRepository.bulkUpdate([{ todoId: id, changes: nextChanges }])
              set({
                todos: get().todos.map((t) =>
                  t.id === id ? { ...t, ...nextChanges, modifiedAt: new Date() } : t
                ),
              })
            },
            undo: async () => {
              await todoRepository.bulkUpdate([{ todoId: id, changes: prevChanges }])
              set({
                todos: get().todos.map((t) =>
                  t.id === id ? { ...t, ...prevChanges, modifiedAt: new Date() } : t
                ),
              })
            },
            showSnackbar: true,
          },
        )
      }
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

  async remove(id: number) {
    return mutate(set, async () => {
      const todo = get().todos.find((t) => t.id === id)
      if (!todo) return
      const snapshot = { ...todo }
      const { personIds, orgIds } = await captureAssignments(id)

      await todoRepository.delete(id)
      set({ todos: get().todos.filter((t) => t.id !== id) })

      undoable(
        `Delete "${todo.title}"`,
        () => get()._removeNoUndo(id),
        () => get()._restore(snapshot, personIds, orgIds),
        true,
      )
    }, 'Failed to delete task')
  },

  async bulkSetCompleted(ids: number[], completed: boolean) {
    // Split recurring tasks (advance their anchor date) from normal tasks (toggle completion)
    const allTodos = get().todos.filter((t) => ids.includes(t.id))
    type RecurringAdvance = {
      id: number
      field: 'dueDate' | 'scheduledDate'
      prev: Date | ScheduledValue
      nextChanges: Partial<Pick<PersistedTodoItem, 'dueDate' | 'scheduledDate'>>
    }
    const recurringAdvances: RecurringAdvance[] = []
    if (completed) {
      for (const t of allTodos) {
        if (t.isCompleted || !t.recurrenceRule) continue
        const advance = advanceRecurring(t)
        if (!advance) continue
        const nextChanges = advance.field === 'dueDate'
          ? { dueDate: advance.dueDate! }
          : { scheduledDate: advance.scheduledDate! }
        const prev = advance.field === 'dueDate' ? t.dueDate! : t.scheduledDate!
        recurringAdvances.push({ id: t.id, field: advance.field, prev, nextChanges })
      }
    }
    const recurringIds = new Set(recurringAdvances.map((r) => r.id))
    const normalIds = ids.filter((id) => !recurringIds.has(id))

    const recurringMutations = recurringAdvances.map((r) => ({ todoId: r.id, changes: r.nextChanges }))
    const prevStates = get().todos
      .filter((t) => normalIds.includes(t.id))
      .map((t) => ({ id: t.id, wasCompleted: t.isCompleted }))
    const normalIdSet = new Set(normalIds)
    const recurringNextMap = new Map(recurringAdvances.map((r) => [r.id, r.nextChanges]))
    const recurringPrevMap = new Map(recurringAdvances.map((r) => [r.id, r]))

    const label = completed ? 'Complete' : 'Uncomplete'
    return optimistic(
      set,
      () => {
        const now = new Date()
        set({
          todos: get().todos.map((t) => {
            const next = recurringNextMap.get(t.id)
            if (next) return { ...t, ...next, modifiedAt: now }
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
        const prevCompletedMap = new Map(prevStates.map(s => [s.id, s.wasCompleted]))
        set({
          todos: get().todos.map((t) => {
            const r = recurringPrevMap.get(t.id)
            if (r) {
              return r.field === 'dueDate'
                ? { ...t, dueDate: r.prev as Date }
                : { ...t, scheduledDate: r.prev as ScheduledValue }
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
          if (recurringAdvances.length > 0) {
            const revertMutations = recurringAdvances.map(r => ({
              todoId: r.id,
              changes: r.field === 'dueDate'
                ? { dueDate: r.prev as Date }
                : { scheduledDate: r.prev as ScheduledValue },
            }))
            await todoRepository.bulkUpdate(revertMutations)
            set({
              todos: get().todos.map((t) => {
                const r = recurringPrevMap.get(t.id)
                if (!r) return t
                return r.field === 'dueDate'
                  ? { ...t, dueDate: r.prev as Date, modifiedAt: new Date() }
                  : { ...t, scheduledDate: r.prev as ScheduledValue, modifiedAt: new Date() }
              }),
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

  async bulkSetStatus(ids: number[], statusId: number | undefined) {
    await bulkUpdateField(ids, 'statusId', statusId, `Set status on ${ids.length} tasks`, get, set)
  },

  async bulkSetScheduled(ids: number[], value: ScheduledValue | null) {
    await bulkUpdateField(ids, 'scheduledDate', value ?? undefined, `Set scheduled on ${ids.length} tasks`, get, set)
  },

  async bulkSetDeadline(ids: number[], date: Date | null) {
    await bulkUpdateField(ids, 'dueDate', date ?? undefined, `Set deadline on ${ids.length} tasks`, get, set)
  },

  async bulkSetProject(ids: number[], projectId: number | undefined) {
    await bulkUpdateField(ids, 'projectId', projectId, `Move ${ids.length} tasks to project`, get, set)
  },

  async bulkRemove(ids: number[]) {
    return mutate(set, async () => {
      if (ids.length > 5) {
        const { backupScheduler } = await import('../services/backup-scheduler')
        await backupScheduler.snapshotBeforeDestructive().catch(e => console.warn('backup snapshot failed', e))
      }
      const snapshots = get().todos.filter((t) => ids.includes(t.id)).map(t => ({ ...t }))
      const assignments = await captureAssignmentsBulk(ids)
      const assignmentData = snapshots.map(t => {
        const a = assignments.find(a => a.todoId === t.id)!
        return { todo: t, personIds: a.personIds, orgIds: a.orgIds }
      })

      await todoRepository.bulkDelete(ids)
      const idSet = new Set(ids)
      set({ todos: get().todos.filter((t) => !idSet.has(t.id)) })

      undoable(
        `Delete ${ids.length} tasks`,
        () => get().bulkRemove(ids),
        async () => {
          for (const { todo, personIds, orgIds } of assignmentData) {
            await get()._restore(todo, personIds, orgIds)
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
        isCompleted: false,
        createdAt: now,
        modifiedAt: now,
        sortOrder: maxSort + 1,
        canvasId: todo.canvasId,
        projectId: todo.projectId,
        scheduledDate: todo.scheduledDate,
        dueDate: todo.dueDate,
        notes: todo.notes,
        progress: todo.progress,
        statusId: todo.statusId,
        recurrenceRule: todo.recurrenceRule,
      })
      const newTodo = await todoRepository.getById(newId)
      if (newTodo) {
        set({ todos: [...get().todos, newTodo] })
      }
      // Copy assignments at repo level (bypasses store undo registration)
      const { personIds, orgIds } = await captureAssignments(id)
      const { personRepository } = await import('../data/person-repository')
      const { orgRepository } = await import('../data/org-repository')
      for (const pid of personIds) await personRepository.assignPerson(newId, pid)
      for (const oid of orgIds) await orgRepository.assignOrg(newId, oid)
      // Refresh assignment caches for the new task
      if (personIds.length > 0 || orgIds.length > 0) {
        const { usePersonStore } = await import('./person-store')
        const { useOrgStore } = await import('./org-store')
        const todoIds = get().todos.map(t => t.id)
        if (personIds.length > 0) await usePersonStore.getState().loadAssignments(todoIds)
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

  async addTag(todoId: number, tag: string) {
    return mutate(set, async () => {
      const todo = get().todos.find((t) => t.id === todoId)
      if (!todo) return
      const slug = normalizeTag(tag)
      if (!slug) return
      const current = todo.tags ?? []
      if (current.includes(slug)) return
      const next = [...current, slug]
      const now = new Date()
      await writeTodoTags(todoId, next, now)
      applyTodoTagsToState(set, get, todoId, next, now)
      await mirrorTagsToRegistry(todoId, [slug], [])
    }, 'Failed to add tag')
  },

  async removeTag(todoId: number, tag: string) {
    return mutate(set, async () => {
      const todo = get().todos.find((t) => t.id === todoId)
      if (!todo) return
      const slug = normalizeTag(tag)
      if (!slug) return
      const current = todo.tags ?? []
      if (!current.includes(slug)) return
      const next = current.filter((t) => t !== slug)
      const now = new Date()
      await writeTodoTags(todoId, next, now)
      applyTodoTagsToState(set, get, todoId, next, now)
      await mirrorTagsToRegistry(todoId, [], [slug])
    }, 'Failed to remove tag')
  },

  async setTags(todoId: number, tags: readonly string[]) {
    return mutate(set, async () => {
      const todo = get().todos.find((t) => t.id === todoId)
      if (!todo) return
      const next = normalizeTags(tags)
      if (tagsEqual(todo.tags, next)) return
      const prev = todo.tags ?? []
      const prevSet = new Set(prev)
      const nextSet = new Set(next)
      const added = next.filter((t) => !prevSet.has(t))
      const removed = prev.filter((t) => !nextSet.has(t))
      const now = new Date()
      await writeTodoTags(todoId, next, now)
      applyTodoTagsToState(set, get, todoId, next, now)
      await mirrorTagsToRegistry(todoId, added, removed)
    }, 'Failed to set tags')
  },

  async renameTag(from: string, to: string) {
    return mutate(set, async () => {
      const src = normalizeTag(from)
      const dst = normalizeTag(to)
      if (!src || !dst || src === dst) return 0
      const now = new Date()
      const updates: { id: number; next: string[] }[] = []
      await db.transaction('rw', db.todos, async () => {
        const rows = await db.todos.toArray() as PersistedTodoItem[]
        for (const row of rows) {
          if (row.id == null || !row.tags?.length) continue
          const { changed, next } = renameTagInArray(row.tags, src, dst)
          if (!changed) continue
          await writeTodoTags(row.id, next, now)
          updates.push({ id: row.id, next })
        }
      })
      if (updates.length > 0) {
        const updateMap = new Map(updates.map((u) => [u.id, u.next]))
        set({
          todos: get().todos.map((t) => {
            const next = updateMap.get(t.id)
            if (!next) return t
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { tags: _prev, ...rest } = t
            return next.length > 0
              ? { ...rest, tags: next, modifiedAt: now }
              : { ...rest, modifiedAt: now }
          }),
        })
      }
      return updates.length
    }, 'Failed to rename tag')
  },

  async _restore(todo: PersistedTodoItem, personIds: number[], orgIds: number[] = []) {
    await todoRepository.restoreWithAssignments(todo, personIds, orgIds)
    set({ todos: [...get().todos, todo] })
    // Refresh assignment caches
    const todoIds = get().todos.map(t => t.id)
    if (personIds.length > 0 || orgIds.length > 0) {
      const { usePersonStore } = await import('./person-store')
      const { useOrgStore } = await import('./org-store')
      if (personIds.length > 0) {
        await usePersonStore.getState().loadAssignments(todoIds)
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
    await backupScheduler.snapshotBeforeDestructive().catch(e => console.warn('backup snapshot failed', e))
    const ids = expired.map((t) => t.id)
    await todoRepository.bulkDelete(ids)
    const idSet = new Set(ids)
    set({ todos: get().todos.filter((t) => !idSet.has(t.id)) })
    return ids.length
  },

}))
