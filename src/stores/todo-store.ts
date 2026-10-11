import { create } from 'zustand'
import type { PersistedTodoItem } from '../models'
import type { ScheduledValue } from '../models/scheduled-value'
import { todoRepository } from '../data'
import type { TaskMutation } from '../services/task-placement'
import { undoable } from '../services/undoable'
import { advanceRecurring } from '../services/recurrence'
import { loadWithState, mutate, optimistic, captureAssignments, captureAssignmentsBulk, bulkUpdateField, makeEnsureLoaded } from './store-helpers'
import { useSettingsStore } from './settings-store'
import { resolveCompletedAt } from '../utils/completed-at'
import { addFollowupInterval, formatFollowupDate } from '../utils/followup'

/** Next follow-up for a task created (or followed up) at `now`: today + the Settings default. */
function defaultNextFollowup(now: Date): Date {
  return addFollowupInterval(now, useSettingsStore.getState().followupDefaultInterval)
}

interface TodoState {
  todos: PersistedTodoItem[]
  /**
   * Monotonic counter bumped on every mutation that changes the id-set
   * (add / remove / bulkRemove / restore / purge). Callers that previously
   * derived cache keys via `todos.map(t => t.id).sort().join(',')` can use
   * `${todos.length}:${todosVersion}` instead — O(1) and stable.
   * Not bumped on pure-field edits (update, toggleComplete, reorder,
   * bulkSetStatus/Scheduled/Deadline/Project) because those keep the same
   * ids.
   */
  todosVersion: number
  loading: boolean
  error: string | null

  loadByCanvas: (canvasId: number) => Promise<void>
  loadByProject: (projectId: number) => Promise<void>
  loadAll: () => Promise<void>
  ensureAllLoaded: () => Promise<void>
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
  /** Sets (or, with `null`, clears) `nextFollowupAt` on every task in `ids`. */
  bulkSetFollowup: (ids: number[], date: Date | null) => Promise<void>
  /**
   * "Followed up": `lastFollowupAt = now`, `nextFollowupAt = today + the
   * Settings default interval`, on every task in `ids`. One undo step with
   * the undo snackbar. The timestamps are resolved once and shared by the
   * store and the DB write.
   */
  markFollowedUp: (ids: number[]) => Promise<void>
  bulkRemove: (ids: number[]) => Promise<void>
  reorder: (id: number, newSortOrder: number) => Promise<void>
  applyMutations: (mutations: TaskMutation[]) => Promise<void>
  /**
   * Deletes the given completed tasks (snapshot first). Never called without
   * the user's say-so: the launch prompt and Settings cleanup pick
   * the ids (`selectExpiredCompleted`) and ask before calling this. Ids that
   * are no longer completed are skipped. Returns the number deleted.
   */
  purgeCompleted: (ids: number[]) => Promise<number>
  duplicate: (id: number) => Promise<number | undefined>
  /** Internal: restore a deleted todo (for undo). */
  _restore: (todo: PersistedTodoItem, personIds: number[], orgIds: number[]) => Promise<void>
  /** Internal: remove without undo registration (for redo of add). */
  _removeNoUndo: (id: number) => Promise<void>
}

export const useTodoStore = create<TodoState>((set, get) => {
  const allEnsure = makeEnsureLoaded(() => get().loadAll())
  return {
  todos: [],
  todosVersion: 0,
  loading: false,
  error: null,

  async loadByCanvas(canvasId: number) {
    const todos = await loadWithState(set, () => todoRepository.getByCanvas(canvasId), 'todos by canvas')
    if (todos) set({ todos, todosVersion: get().todosVersion + 1 })
  },

  async loadByProject(projectId: number) {
    const todos = await loadWithState(set, () => todoRepository.getByProject(projectId), 'todos by project')
    if (todos) set({ todos, todosVersion: get().todosVersion + 1 })
  },

  async loadAll() {
    const todos = await loadWithState(set, () => todoRepository.getAll(), 'all todos')
    if (todos) set({ todos, todosVersion: get().todosVersion + 1 })
  },
  ensureAllLoaded: () => allEnsure.ensureLoaded(),

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
        nextFollowupAt: defaultNextFollowup(now),
        ...(defaultStatusId != null && { statusId: defaultStatusId }),
      })
      const todo = await todoRepository.getById(id)
      if (todo) {
        set({ todos: [...get().todos, todo], todosVersion: get().todosVersion + 1 })
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
        nextFollowupAt: defaultNextFollowup(now),
        ...(defaultStatusId != null && { statusId: defaultStatusId }),
      })
      const todo = await todoRepository.getById(id)
      if (todo) {
        set({ todos: [...get().todos, todo], todosVersion: get().todosVersion + 1 })
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
    // Resolve completedAt once and hand the same value to the repository, so
    // the store and the DB never hold two independently minted timestamps.
    const resolved = { ...todo, completedAt: resolveCompletedAt(prev, todo, now) }
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) => (t.id === todo.id ? { ...resolved, modifiedAt: now } : t)),
      }),
      () => todoRepository.update(resolved),
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
    // One completion timestamp, shared by the optimistic state and the DB write.
    const now = new Date()
    const completedAt = resolveCompletedAt(todo, { isCompleted: completed }, now)
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isCompleted: completed, completedAt, modifiedAt: now } : t
        ),
      }),
      () => todoRepository.complete(id, completed, completedAt),
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isCompleted: !completed, completedAt: todo.completedAt } : t
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
      set({ todos: get().todos.filter((t) => t.id !== id), todosVersion: get().todosVersion + 1 })

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
      .map((t) => ({ id: t.id, wasCompleted: t.isCompleted, prevCompletedAt: t.completedAt }))
    const normalIdSet = new Set(normalIds)
    const recurringNextMap = new Map(recurringAdvances.map((r) => [r.id, r.nextChanges]))
    const recurringPrevMap = new Map(recurringAdvances.map((r) => [r.id, r]))

    // One completedAt per task, shared by the optimistic state and the DB write.
    const now = new Date()
    const completedAtById = new Map(
      allTodos
        .filter((t) => normalIdSet.has(t.id))
        .map((t) => [t.id, resolveCompletedAt(t, { isCompleted: completed }, now)]),
    )

    const label = completed ? 'Complete' : 'Uncomplete'
    return optimistic(
      set,
      () => {
        set({
          todos: get().todos.map((t) => {
            const next = recurringNextMap.get(t.id)
            if (next) return { ...t, ...next, modifiedAt: now }
            if (normalIdSet.has(t.id)) {
              return { ...t, isCompleted: completed, completedAt: completedAtById.get(t.id), modifiedAt: now }
            }
            return t
          }),
        })
      },
      async () => {
        if (recurringMutations.length > 0) {
          await todoRepository.bulkUpdate(recurringMutations)
        }
        await Promise.all(normalIds.map((id) => todoRepository.complete(id, completed, completedAtById.get(id))))
      },
      () => {
        const prevCompletedMap = new Map(prevStates.map(s => [s.id, s]))
        set({
          todos: get().todos.map((t) => {
            const r = recurringPrevMap.get(t.id)
            if (r) {
              return r.field === 'dueDate'
                ? { ...t, dueDate: r.prev as Date }
                : { ...t, scheduledDate: r.prev as ScheduledValue }
            }
            const prevState = prevCompletedMap.get(t.id)
            if (prevState) {
              return { ...t, isCompleted: prevState.wasCompleted, completedAt: prevState.prevCompletedAt }
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
          // (re-completing restores the original completion time)
          // Resolved once per task and written to both store and DB.
          const undoNow = new Date()
          const reverts = prevStates
            .filter(s => s.wasCompleted !== completed)
            .map(s => {
              const current = get().todos.find(t => t.id === s.id)
              const next = { isCompleted: s.wasCompleted, completedAt: s.prevCompletedAt }
              return { id: s.id, isCompleted: s.wasCompleted, completedAt: resolveCompletedAt(current, next, undoNow) }
            })
          for (const r of reverts) {
            await todoRepository.complete(r.id, r.isCompleted, r.completedAt)
          }
          if (reverts.length > 0) {
            const revertMap = new Map(reverts.map(r => [r.id, r]))
            set({
              todos: get().todos.map((t) => {
                const r = revertMap.get(t.id)
                return r ? { ...t, isCompleted: r.isCompleted, completedAt: r.completedAt, modifiedAt: undoNow } : t
              }),
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

  async bulkSetFollowup(ids: number[], date: Date | null) {
    const label = date ? `Set follow-up on ${ids.length} tasks` : `Clear follow-up on ${ids.length} tasks`
    await bulkUpdateField(ids, 'nextFollowupAt', date ?? undefined, label, get, set)
  },

  async markFollowedUp(ids: number[]) {
    const targets = get().todos.filter((t) => ids.includes(t.id))
    if (targets.length === 0) return
    const now = new Date()
    const next = defaultNextFollowup(now)
    const changes = { lastFollowupAt: now, nextFollowupAt: next }
    const prev = new Map(targets.map((t) => [t.id, {
      lastFollowupAt: t.lastFollowupAt,
      nextFollowupAt: t.nextFollowupAt,
      modifiedAt: t.modifiedAt,
    }]))
    const targetIds = targets.map((t) => t.id)
    const description = `Followed up · next follow-up ${formatFollowupDate(next, now)}`
    return optimistic(
      set,
      () => set({
        todos: get().todos.map((t) => (prev.has(t.id) ? { ...t, ...changes, modifiedAt: now } : t)),
      }),
      () => todoRepository.bulkUpdate(targetIds.map((todoId) => ({ todoId, changes }))),
      () => set({
        todos: get().todos.map((t) => {
          const p = prev.get(t.id)
          return p ? { ...t, ...p } : t
        }),
      }),
      'Failed to mark tasks followed up',
      {
        description,
        redo: () => get().markFollowedUp(targetIds),
        undo: async () => {
          const undoNow = new Date()
          await todoRepository.bulkUpdate(targetIds.map((todoId) => {
            const p = prev.get(todoId)
            return { todoId, changes: { lastFollowupAt: p?.lastFollowupAt, nextFollowupAt: p?.nextFollowupAt } }
          }))
          set({
            todos: get().todos.map((t) => {
              const p = prev.get(t.id)
              return p ? { ...t, lastFollowupAt: p.lastFollowupAt, nextFollowupAt: p.nextFollowupAt, modifiedAt: undoNow } : t
            }),
          })
        },
        showSnackbar: true,
      },
    )
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
      set({ todos: get().todos.filter((t) => !idSet.has(t.id)), todosVersion: get().todosVersion + 1 })

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
        nextFollowupAt: todo.nextFollowupAt,
        notes: todo.notes,
        progress: todo.progress,
        statusId: todo.statusId,
        recurrenceRule: todo.recurrenceRule,
      })
      const newTodo = await todoRepository.getById(newId)
      if (newTodo) {
        set({ todos: [...get().todos, newTodo], todosVersion: get().todosVersion + 1 })
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

  async _restore(todo: PersistedTodoItem, personIds: number[], orgIds: number[] = []) {
    await todoRepository.restoreWithAssignments(todo, personIds, orgIds)
    set({ todos: [...get().todos, todo], todosVersion: get().todosVersion + 1 })
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
    set({ todos: get().todos.filter((t) => t.id !== id), todosVersion: get().todosVersion + 1 })
  },

  async purgeCompleted(ids: number[]) {
    // Only rows that are still completed — the caller's list came from a
    // prompt the user answered, and a task reopened meanwhile must survive.
    // Checked against the database, not `todos`: the store may hold only one
    // canvas's tasks (`loadByCanvas`).
    const doomed = (await todoRepository.getByIds(ids)).filter((t) => t.isCompleted).map((t) => t.id)
    if (doomed.length === 0) return 0
    // Snapshot before destructive purge
    const { backupScheduler } = await import('../services/backup-scheduler')
    await backupScheduler.snapshotBeforeDestructive().catch(e => console.warn('backup snapshot failed', e))
    await todoRepository.bulkDelete(doomed)
    const doomedSet = new Set(doomed)
    set({ todos: get().todos.filter((t) => !doomedSet.has(t.id)), todosVersion: get().todosVersion + 1 })
    return doomed.length
  },

  }
})
