import { create } from 'zustand'
import type { NewTodoItem, PersistedTodoItem } from '../models'
import { todoRepository } from '../data'
import { undoable } from '../services/undoable'
import { useUndoStore } from './undo-store'
import { advanceRecurring } from '../services/recurrence'
import { loadWithState, mutate, optimistic, captureAssignments, captureAssignmentsBulk, bulkUpdateField, makeEnsureLoaded, trackWrite, type CapturedAssignments } from './store-helpers'
import { useSettingsStore } from './settings-store'
import { useListOrderStore } from './list-order-store'
import { listOrderRepository } from '../data/list-order-repository'
import { resolveCompletedAt } from '../utils/completed-at'
import { addFollowupInterval, formatFollowupDate } from '../utils/followup'

/** Next follow-up for a task created (or followed up) at `now`: today + the Settings default. */
function defaultNextFollowup(now: Date): Date {
  return addFollowupInterval(now, useSettingsStore.getState().followupDefaultInterval)
}

/** A task to create with the people and tags it starts with (`addMany`). */
export interface NewTaskWithAssignments {
  todo: Omit<NewTodoItem, 'sortOrder'>
  personIds: readonly number[]
  tagIds: readonly number[]
}

/** One task's Urgent / Important writes (`setMarkerFlags`): only the flags that change. */
export interface MarkerFlagChange {
  todoId: number
  urgent?: boolean
  important?: boolean
}

/**
 * `purgeCompleted`'s outcome. `cancelled`: the backup snapshot failed and the
 * user didn't continue without one — nothing was deleted. `noBackup`: deleted
 * without that snapshot (the user chose to continue).
 */
export type PurgeOutcome =
  | { status: 'done'; deleted: number; noBackup: boolean }
  | { status: 'cancelled' }

/** A bulk delete of more tasks than this is backed up first. */
export const BULK_DELETE_SNAPSHOT_MIN = 5

/** The backup gate before a destructive write (`services/safety-snapshot`). */
async function takeSafetySnapshot(operation: string) {
  const { takeSafetySnapshot: take } = await import('../services/safety-snapshot')
  return take(operation)
}

const NO_ASSIGNMENTS: CapturedAssignments = { personIds: [], tagIds: [] }

/** The stored form of a flag: only `true` is kept. */
function flagValue(on: boolean): true | undefined {
  return on ? true : undefined
}

/** Reloads the people / tag assignment caches for every loaded task. */
async function reloadAssignments(todoIds: number[]): Promise<void> {
  const { usePersonStore } = await import('./person-store')
  const { useTagStore } = await import('./tag-store')
  await usePersonStore.getState().loadAssignments(todoIds)
  await useTagStore.getState().loadAssignments(todoIds)
}

interface TodoState {
  todos: PersistedTodoItem[]
  /**
   * Monotonic counter bumped on every mutation that changes the id-set
   * (add / remove / bulkRemove / restore / purge). Callers that previously
   * derived cache keys via `todos.map(t => t.id).sort().join(',')` can use
   * `${todos.length}:${todosVersion}` instead — O(1) and stable.
   * Not bumped on pure-field edits (update, toggleComplete, reorder,
   * bulkSetStatus/Deadline) because those keep the same
   * ids.
   */
  todosVersion: number
  loading: boolean
  error: string | null

  loadAll: () => Promise<void>
  ensureAllLoaded: () => Promise<void>
  add: (title: string) => Promise<number>
  /**
   * Creates several tasks, with their people and tags, in one transaction
   * and as one undo step (`description`; `snackbar` shows the undo
   * snackbar). New tasks go last. Returns their ids in input order.
   */
  addMany: (
    items: readonly NewTaskWithAssignments[],
    options: { description: string; snackbar?: boolean },
  ) => Promise<number[]>
  update: (todo: PersistedTodoItem) => Promise<void>
  toggleComplete: (id: number) => Promise<void>
  remove: (id: number) => Promise<void>
  bulkSetCompleted: (ids: number[], completed: boolean) => Promise<void>
  bulkSetStatus: (ids: number[], statusId: number | undefined) => Promise<void>
  bulkSetDeadline: (ids: number[], date: Date | null) => Promise<void>
  /** Sets (or, with `null`, clears) `nextFollowupAt` on every task in `ids`. */
  bulkSetFollowup: (ids: number[], date: Date | null) => Promise<void>
  /** Sets (or, with `null`, clears) `lastFollowupAt` on every task in `ids`. */
  bulkSetLastFollowup: (ids: number[], date: Date | null) => Promise<void>
  /** Puts every task in `ids` in focus (`on`) or takes it out. One undo step. */
  bulkSetFocus: (ids: number[], on: boolean) => Promise<void>
  /** Flags every task in `ids` urgent (`on`) or clears the flag. One undo step. */
  bulkSetUrgent: (ids: number[], on: boolean) => Promise<void>
  /** Flags every task in `ids` important (`on`) or clears the flag. One undo step. */
  bulkSetImportant: (ids: number[], on: boolean) => Promise<void>
  /**
   * Writes per-task Urgent / Important changes (e.g. an Eisenhower drop) as
   * one undo step with the undo snackbar (`description`).
   */
  setMarkerFlags: (changes: readonly MarkerFlagChange[], description: string) => Promise<void>
  /** Removes the due date from every task in `ids`. One undo step, with the undo snackbar. */
  bulkClearDueDate: (ids: number[]) => Promise<void>
  /**
   * "Followed up": `lastFollowupAt = now`, `nextFollowupAt = today + the
   * Settings default interval`, on every task in `ids`. One undo step with
   * the undo snackbar. The timestamps are resolved once and shared by the
   * store and the DB write.
   */
  markFollowedUp: (ids: number[]) => Promise<void>
  /**
   * Deletes `ids` as one undo step (with the snackbar). More than
   * `BULK_DELETE_SNAPSHOT_MIN` tasks are backed up first; if that backup
   * fails and the user cancels, nothing is deleted. `beforeDelete` runs
   * once the delete is going ahead (not on cancel) — e.g. to clear the
   * selection, which a cancel keeps.
   */
  bulkRemove: (ids: number[], opts?: { beforeDelete?: () => void }) => Promise<void>
  reorder: (id: number, newSortOrder: number) => Promise<void>
  /**
   * Deletes the given completed tasks (snapshot first, `takeSafetySnapshot`).
   * Never called without the user's say-so: the launch prompt and Settings
   * cleanup pick the ids (`selectExpiredCompleted`) and ask before calling
   * this. Ids that are no longer completed are skipped.
   */
  purgeCompleted: (ids: number[]) => Promise<PurgeOutcome>
  duplicate: (id: number) => Promise<number | undefined>
  /** Internal: restore a deleted todo (for undo). */
  _restore: (todo: PersistedTodoItem, assignments: CapturedAssignments) => Promise<void>
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

  async loadAll() {
    const todos = await loadWithState(set, () => todoRepository.getAll(), 'all todos')
    if (todos) set({ todos, todosVersion: get().todosVersion + 1 })
  },
  ensureAllLoaded: () => allEnsure.ensureLoaded(),

  async add(title: string) {
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
        nextFollowupAt: defaultNextFollowup(now),
        ...(defaultStatusId != null && { statusId: defaultStatusId }),
      })
      const todo = await todoRepository.getById(id)
      if (todo) {
        set({ todos: [...get().todos, todo], todosVersion: get().todosVersion + 1 })
      }
      // Redo puts back the same row, so a later undo still finds it.
      undoable(
        `Add "${title}"`,
        async () => { if (todo) await get()._restore(todo, NO_ASSIGNMENTS) },
        () => get()._removeNoUndo(id),
      )
      return id
    }, 'Failed to add task')
  },

  async addMany(items, { description, snackbar = false }) {
    if (items.length === 0) return []
    return mutate(set, async () => {
      const maxSort = get().todos.reduce((max, t) => Math.max(max, t.sortOrder), 0)
      const rows = items.map((item, i) => ({ ...item, todo: { ...item.todo, sortOrder: maxSort + 1 + i } }))
      const ids = await todoRepository.insertManyWithAssignments(rows)
      const created = await todoRepository.getByIds(ids)
      const snapshots = ids.flatMap((id, i) => {
        const todo = created.find((t) => t.id === id)
        const item = items[i]
        return todo && item ? [{ todo, personIds: [...item.personIds], tagIds: [...item.tagIds] }] : []
      })
      const put = async () => {
        const present = new Set(get().todos.map((t) => t.id))
        set({
          todos: [...get().todos, ...snapshots.map((s) => s.todo).filter((t) => !present.has(t.id))],
          todosVersion: get().todosVersion + 1,
        })
        await reloadAssignments(get().todos.map((t) => t.id))
      }
      await put()
      undoable(
        description,
        async () => {
          await todoRepository.restoreManyWithAssignments(snapshots)
          await put()
        },
        async () => {
          await todoRepository.bulkDelete(ids)
          useListOrderStore.getState().forgetTodos(ids)
          const idSet = new Set(ids)
          set({ todos: get().todos.filter((t) => !idSet.has(t.id)), todosVersion: get().todosVersion + 1 })
        },
        snackbar,
      )
      return ids
    }, 'Failed to add tasks')
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

    // Recurring task: advance its due date instead of completing
    if (!todo.isCompleted && todo.recurrenceRule) {
      const advance = advanceRecurring(todo)
      if (advance) {
        const nextChanges = { dueDate: advance.dueDate }
        const prevChanges = { dueDate: todo.dueDate }
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
      const assignments = await captureAssignments(id)
      const ranks = await listOrderRepository.getByTodos([id])

      await todoRepository.delete(id)
      useListOrderStore.getState().forgetTodos([id])
      set({ todos: get().todos.filter((t) => t.id !== id), todosVersion: get().todosVersion + 1 })

      undoable(
        `Delete "${todo.title}"`,
        () => get()._removeNoUndo(id),
        async () => {
          await get()._restore(snapshot, assignments)
          await useListOrderStore.getState().restoreRows(ranks)
        },
        true,
      )
    }, 'Failed to delete task')
  },

  async bulkSetCompleted(ids: number[], completed: boolean) {
    // Split recurring tasks (advance their due date) from normal tasks (toggle completion)
    const allTodos = get().todos.filter((t) => ids.includes(t.id))
    type RecurringAdvance = {
      id: number
      prev: Date | undefined
      nextChanges: Pick<PersistedTodoItem, 'dueDate'>
    }
    const recurringAdvances: RecurringAdvance[] = []
    if (completed) {
      for (const t of allTodos) {
        if (t.isCompleted || !t.recurrenceRule) continue
        const advance = advanceRecurring(t)
        if (!advance) continue
        recurringAdvances.push({ id: t.id, prev: t.dueDate, nextChanges: { dueDate: advance.dueDate } })
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
            if (r) return { ...t, dueDate: r.prev }
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
              changes: { dueDate: r.prev },
            }))
            await todoRepository.bulkUpdate(revertMutations)
            set({
              todos: get().todos.map((t) => {
                const r = recurringPrevMap.get(t.id)
                if (!r) return t
                return { ...t, dueDate: r.prev, modifiedAt: new Date() }
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

  async bulkSetDeadline(ids: number[], date: Date | null) {
    await bulkUpdateField(ids, 'dueDate', date ?? undefined, `Set due date on ${ids.length} tasks`, get, set)
  },

  async bulkSetFollowup(ids: number[], date: Date | null) {
    const label = date ? `Set follow-up on ${ids.length} tasks` : `Clear follow-up on ${ids.length} tasks`
    await bulkUpdateField(ids, 'nextFollowupAt', date ?? undefined, label, get, set)
  },

  async bulkSetLastFollowup(ids: number[], date: Date | null) {
    const label = date ? `Set last follow-up on ${ids.length} tasks` : `Clear last follow-up on ${ids.length} tasks`
    await bulkUpdateField(ids, 'lastFollowupAt', date ?? undefined, label, get, set)
  },

  async bulkSetFocus(ids: number[], on: boolean) {
    if (ids.length === 0) return
    const what = ids.length === 1 ? 'task' : `${ids.length} tasks`
    const label = on ? `Add ${what} to Focus` : `Remove ${what} from Focus`
    await bulkUpdateField(ids, 'focus', on ? true : undefined, label, get, set)
  },

  async bulkSetUrgent(ids: number[], on: boolean) {
    if (ids.length === 0) return
    const what = ids.length === 1 ? 'task' : `${ids.length} tasks`
    const label = on ? `Flag ${what} urgent` : `Clear urgent on ${what}`
    await bulkUpdateField(ids, 'urgent', on ? true : undefined, label, get, set)
  },

  async bulkSetImportant(ids: number[], on: boolean) {
    if (ids.length === 0) return
    const what = ids.length === 1 ? 'task' : `${ids.length} tasks`
    const label = on ? `Flag ${what} important` : `Clear important on ${what}`
    await bulkUpdateField(ids, 'important', on ? true : undefined, label, get, set)
  },

  async setMarkerFlags(changes, description) {
    const byId = new Map(changes.map((c) => [c.todoId, c]))
    const targets = get().todos.filter((t) => byId.has(t.id))
    if (targets.length === 0) return
    const prev = new Map(targets.map((t) => [t.id, { urgent: t.urgent, important: t.important, modifiedAt: t.modifiedAt }]))
    const patch = (c: MarkerFlagChange): Partial<PersistedTodoItem> => ({
      ...(c.urgent !== undefined ? { urgent: flagValue(c.urgent) } : {}),
      ...(c.important !== undefined ? { important: flagValue(c.important) } : {}),
    })
    const ids = targets.map((t) => t.id)
    const restore = async (persist: boolean) => {
      if (persist) {
        await todoRepository.bulkUpdate(ids.map((todoId) => {
          const p = prev.get(todoId)
          return { todoId, changes: { urgent: p?.urgent, important: p?.important } }
        }))
      }
      set({
        todos: get().todos.map((t) => {
          const p = prev.get(t.id)
          return p ? { ...t, urgent: p.urgent, important: p.important, modifiedAt: p.modifiedAt } : t
        }),
      })
    }
    return optimistic(
      set,
      () => {
        const now = new Date()
        set({
          todos: get().todos.map((t) => {
            const c = byId.get(t.id)
            return c ? { ...t, ...patch(c), modifiedAt: now } : t
          }),
        })
      },
      () => todoRepository.bulkUpdate(targets.flatMap((t) => {
        const c = byId.get(t.id)
        return c ? [{ todoId: t.id, changes: patch(c) }] : []
      })),
      () => { void restore(false) },
      'Failed to update urgent / important',
      {
        description,
        redo: () => get().setMarkerFlags(changes, description),
        undo: () => restore(true),
        showSnackbar: true,
      },
    )
  },

  async bulkClearDueDate(ids: number[]) {
    if (ids.length === 0) return
    const label = ids.length === 1 ? 'Removed the due date' : `Removed ${ids.length} due dates`
    await bulkUpdateField(ids, 'dueDate', undefined, label, get, set, { showSnackbar: true })
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

  async bulkRemove(ids: number[], opts?: { beforeDelete?: () => void }) {
    // Backup gate outside the tracked write: it may wait on the user. A redo
    // skips it — the first run already backed up this data — so a redo
    // always does what the undo stack expects.
    let noBackup = false
    if (ids.length > BULK_DELETE_SNAPSHOT_MIN && !useUndoStore.getState().isPerformingUndoRedo) {
      const snapshot = await takeSafetySnapshot(`deleting ${ids.length} tasks`)
      if (snapshot === 'cancelled') return
      noBackup = snapshot === 'without-backup'
    }
    opts?.beforeDelete?.()
    return mutate(set, async () => {
      const snapshots = get().todos.filter((t) => ids.includes(t.id)).map(t => ({ ...t }))
      const assignments = await captureAssignmentsBulk(ids)
      const assignmentData = snapshots.map(t => {
        const a = assignments.find(a => a.todoId === t.id)
        return { todo: t, personIds: a?.personIds ?? [], tagIds: a?.tagIds ?? [] }
      })

      const ranks = await listOrderRepository.getByTodos(ids)

      await todoRepository.bulkDelete(ids)
      useListOrderStore.getState().forgetTodos(ids)
      const idSet = new Set(ids)
      set({ todos: get().todos.filter((t) => !idSet.has(t.id)), todosVersion: get().todosVersion + 1 })

      undoable(
        noBackup ? `Delete ${ids.length} tasks — no backup was taken` : `Delete ${ids.length} tasks`,
        () => get().bulkRemove(ids),
        async () => {
          for (const { todo, personIds, tagIds } of assignmentData) {
            await get()._restore(todo, { personIds, tagIds })
          }
          await useListOrderStore.getState().restoreRows(ranks)
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
        dueDate: todo.dueDate,
        nextFollowupAt: todo.nextFollowupAt,
        notes: todo.notes,
        progress: todo.progress,
        statusId: todo.statusId,
        recurrenceRule: todo.recurrenceRule,
        ...(todo.urgent === true ? { urgent: true } : {}),
        ...(todo.important === true ? { important: true } : {}),
      })
      const newTodo = await todoRepository.getById(newId)
      if (newTodo) {
        set({ todos: [...get().todos, newTodo], todosVersion: get().todosVersion + 1 })
      }
      // Copy assignments at repo level (bypasses store undo registration)
      const { personIds, tagIds } = await captureAssignments(id)
      const { personRepository } = await import('../data/person-repository')
      for (const pid of personIds) await personRepository.assignPerson(newId, pid)
      const { tagRepository } = await import('../data/tag-repository')
      for (const tid of tagIds) await tagRepository.assignTag(newId, tid)
      // Refresh assignment caches for the new task
      const todoIds = get().todos.map(t => t.id)
      if (personIds.length > 0) {
        const { usePersonStore } = await import('./person-store')
        await usePersonStore.getState().loadAssignments(todoIds)
      }
      if (tagIds.length > 0) {
        const { useTagStore } = await import('./tag-store')
        await useTagStore.getState().loadAssignments(todoIds)
      }
      undoable(
        `Duplicate "${todo.title}"`,
        async () => { if (newTodo) await get()._restore(newTodo, { personIds, tagIds }) },
        () => get()._removeNoUndo(newId),
      )
      return newId
    }, 'Failed to duplicate task')
  },

  _restore(todo: PersistedTodoItem, { personIds, tagIds }: CapturedAssignments) {
    return trackWrite(async () => {
      await todoRepository.restoreManyWithAssignments([{ todo, personIds, tagIds }])
      set({
        todos: [...get().todos.filter((t) => t.id !== todo.id), todo],
        todosVersion: get().todosVersion + 1,
      })
      // Refresh assignment caches (they keep the entries the delete left).
      await reloadAssignments(get().todos.map((t) => t.id))
    })
  },

  _removeNoUndo(id: number) {
    return trackWrite(async () => {
      await todoRepository.delete(id)
      useListOrderStore.getState().forgetTodos([id])
      set({ todos: get().todos.filter((t) => t.id !== id), todosVersion: get().todosVersion + 1 })
    })
  },

  async purgeCompleted(ids: number[]): Promise<PurgeOutcome> {
    // Only rows that are still completed — the caller's list came from a
    // prompt the user answered, and a task reopened meanwhile must survive.
    // Checked against the database, not `todos` (which may not be loaded yet).
    const stillCompleted = async () =>
      (await todoRepository.getByIds(ids)).filter((t) => t.isCompleted).map((t) => t.id)
    const candidates = await stillCompleted()
    if (candidates.length === 0) return { status: 'done', deleted: 0, noBackup: false }
    // Backup gate outside the tracked write: it may wait on the user.
    const snapshot = await takeSafetySnapshot(
      `deleting ${candidates.length} completed task${candidates.length === 1 ? '' : 's'}`,
    )
    if (snapshot === 'cancelled') return { status: 'cancelled' }
    return trackWrite(async () => {
      // Read again: a task may have been reopened while the backup ran.
      const doomed = await stillCompleted()
      if (doomed.length > 0) {
        await todoRepository.bulkDelete(doomed)
        useListOrderStore.getState().forgetTodos(doomed)
        const doomedSet = new Set(doomed)
        set({ todos: get().todos.filter((t) => !doomedSet.has(t.id)), todosVersion: get().todosVersion + 1 })
      }
      return { status: 'done', deleted: doomed.length, noBackup: snapshot === 'without-backup' } as const
    })
  },

  }
})
