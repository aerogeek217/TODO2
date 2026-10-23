import { create } from 'zustand'
import type { NewTodoItem, PersistedListOrder, PersistedTodoItem, TodoChanges, TodoEvent } from '../models'
import { todoRepository } from '../data'
import { undoable } from './undoable'
import { useUndoStore } from './undo-store'
import { advanceRecurring } from '../utils/recurrence'
import { loadFresh, mutate, optimistic, captureAssignments, captureAssignmentsBulk, bulkUpdateField, makeEnsureLoaded, trackWrite, type CapturedAssignments } from './store-helpers'
import { autoNextFollowup, newTaskDefaultFollowup, useSettingsStore } from './settings-store'
import { useListOrderStore } from './list-order-store'
import { listOrderRepository } from '../data/list-order-repository'
import { takeSafetySnapshot } from './safety-snapshot'
import { usePersonStore } from './person-store'
import { useTagStore } from './tag-store'
import { resolveCompletedAt } from '../utils/completed-at'
import { formatFollowupDate } from '../utils/followup'
import { fieldsOf, revertChanges, todoChanges, withOrphanedRuleDropped } from '../utils/todo-changes'

/** A task to create with the people and tags it starts with (`addMany`). */
export interface NewTaskWithAssignments {
  todo: Omit<NewTodoItem, 'sortOrder'>
  personIds: readonly number[]
  tagIds: readonly number[]
}

/** One task's Urgent / Important / Focus writes (`setMarkerFlags`): only the flags that change. */
export interface MarkerFlagChange {
  todoId: number
  urgent?: boolean
  important?: boolean
  focus?: boolean
}

/** `markFollowedUp`'s options. */
export interface MarkFollowedUpOptions {
  /** The next follow-up to set (`null` = none); omitted = the automatic rule (`autoNextFollowup`). */
  next?: Date | null
  /** The undo entry's name (default `Followed up · next follow-up …`). */
  description?: string
  /** The undo snackbar's second line. */
  detail?: string
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

const NO_ASSIGNMENTS: CapturedAssignments = { personIds: [], tagIds: [] }

/** The stored form of a flag: only `true` is kept. */
function flagValue(on: boolean): true | undefined {
  return on ? true : undefined
}

/** Reloads the people / tag assignment caches for every loaded task. */
async function reloadAssignments(todoIds: number[]): Promise<void> {
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
   * Not bumped on pure-field edits (update, toggleComplete,
   * bulkSetStatus/Deadline) because those keep the same
   * ids.
   */
  todosVersion: number
  /** A load has read the rows (a failed load leaves it false, so `ensureAllLoaded` retries). */
  loaded: boolean

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
  /**
   * Saves an edit to a task: `changes` holds just the fields the caller
   * changed, and only those are written (fields that already hold the value
   * are skipped). One undo step; undo restores only those fields. No change
   * → no write and no undo step. Never rejects: a failed write is rolled
   * back, the snackbar says so, and it resolves `false` (otherwise `true`).
   */
  update: (id: number, changes: TodoChanges) => Promise<boolean>
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
   * Writes per-task Urgent / Important / Focus changes (e.g. an Eisenhower drop) as
   * one undo step with the undo snackbar (`description`).
   */
  setMarkerFlags: (changes: readonly MarkerFlagChange[], description: string) => Promise<void>
  /** Removes the due date from every task in `ids`. One undo step, with the undo snackbar. */
  bulkClearDueDate: (ids: number[]) => Promise<void>
  /**
   * "Mark followed up": `lastFollowupAt = now` and `nextFollowupAt` = the
   * option's `next` when given (a date, or `null` = none — the follow-up
   * popover's field), else the automatic rule (`autoNextFollowup`: today + the
   * Settings interval, or none while that is off), on every task in `ids`.
   * One undo step with the undo snackbar — `description` names it (default
   * `Followed up · next follow-up …`), `detail` is the snackbar's second
   * line. The timestamps are resolved once and shared by the store and the
   * DB write.
   */
  markFollowedUp: (ids: number[], options?: MarkFollowedUpOptions) => Promise<void>
  /**
   * Deletes `ids` as one undo step (with the snackbar). More than
   * `BULK_DELETE_SNAPSHOT_MIN` tasks are backed up first; if that backup
   * fails and the user cancels, nothing is deleted. `beforeDelete` runs
   * once the delete is going ahead (not on cancel) — e.g. to clear the
   * selection, which a cancel keeps.
   */
  bulkRemove: (ids: number[], opts?: { beforeDelete?: () => void }) => Promise<void>
  /**
   * Deletes the given completed tasks (snapshot first, `takeSafetySnapshot`).
   * Never called without the user's say-so: the launch prompt and Settings
   * cleanup pick the ids (`selectExpiredCompleted`) and ask before calling
   * this. Ids that are no longer completed are skipped.
   */
  purgeCompleted: (ids: number[]) => Promise<PurgeOutcome>
  duplicate: (id: number) => Promise<number | undefined>
  /** Internal: restore a deleted todo with its people, tags and events (for undo). */
  _restore: (todo: PersistedTodoItem, assignments: CapturedAssignments, events?: readonly TodoEvent[]) => Promise<void>
  /** Internal: remove without undo registration (for undo of add); returns the deleted events. */
  _removeNoUndo: (id: number) => Promise<TodoEvent[]>
}

export const useTodoStore = create<TodoState>((set, get) => {
  const allEnsure = makeEnsureLoaded(() => get().loadAll(), () => get().loaded)

  /**
   * Writes `changes` to one task as an undoable edit (`description`). Only
   * the fields that differ from the task's current row are written — in the
   * store and in the database — so an edit never puts back an older value of
   * a field it didn't change. Undo writes back just those fields.
   */
  function patchTodo(id: number, changes: Partial<PersistedTodoItem>, description: string): Promise<void> {
    const prev = get().todos.find((t) => t.id === id)
    if (!prev) return Promise.resolve()
    const edit = todoChanges(prev, { ...prev, ...changes })
    if (Object.keys(edit).length === 0) return Promise.resolve()
    // As the repository writes it: a rule left without a due date goes (undo puts it back).
    const effective = withOrphanedRuleDropped({ ...prev, ...edit }, edit)
    const before = fieldsOf(prev, effective)
    const now = new Date()
    return optimistic(
      () => set({
        todos: get().todos.map((t) => (t.id === id ? { ...t, ...effective, modifiedAt: now } : t)),
      }),
      () => todoRepository.update(id, effective, now),
      // Field by field: a field another edit changed meanwhile keeps its value.
      () => set({
        todos: get().todos.map((t) => (t.id === id
          ? {
              ...t,
              ...revertChanges(t, effective, before),
              ...(t.modifiedAt === now ? { modifiedAt: prev.modifiedAt } : {}),
            }
          : t)),
      }),
      'Failed to update task',
      {
        description,
        redo: () => patchTodo(id, effective, description),
        undo: () => patchTodo(id, before, description),
      },
    )
  }

  /**
   * Sets one task's completion to `isCompleted` with `completedAt` (undo /
   * redo of a toggle): no undo entry, one timestamp for the store and the
   * database, nothing written when the task already has that completion.
   */
  async function writeCompletion(id: number, isCompleted: boolean, completedAt: Date | undefined): Promise<void> {
    const current = get().todos.find((t) => t.id === id)
    if (!current) return
    const at = new Date()
    const nextAt = resolveCompletedAt(current, { isCompleted, completedAt }, at)
    if (current.isCompleted === isCompleted && current.completedAt?.getTime() === nextAt?.getTime()) return
    await todoRepository.complete(id, isCompleted, nextAt, at)
    set({
      todos: get().todos.map((t) => (t.id === id ? { ...t, isCompleted, completedAt: nextAt, modifiedAt: at } : t)),
    })
  }

  /**
   * The undo step of a task just created (`row`, with `assignments`): undo
   * deletes it, redo puts it back as it was when undone — its row, people,
   * tags, list ranks and events read at that moment (as a delete's undo
   * does), so a change made after the create without an undo step of its own
   * (a manual-order move, a sync-file load) survives the round trip.
   */
  function registerCreated(description: string, row: PersistedTodoItem, assignments: CapturedAssignments): void {
    const id = row.id
    let snapshot = row
    let captured = assignments
    let ranks: PersistedListOrder[] = []
    let events: TodoEvent[] = []
    undoable(
      description,
      async () => {
        await get()._restore(snapshot, captured, events)
        await useListOrderStore.getState().restoreRows(ranks)
      },
      async () => {
        const current = get().todos.find((t) => t.id === id)
        if (current) snapshot = { ...current }
        captured = await captureAssignments(id)
        ranks = await listOrderRepository.getByTodos([id])
        events = await get()._removeNoUndo(id)
      },
    )
  }

  /**
   * `write`, and after a failed one the tasks read back from the database —
   * the rollback put back what the store had, this makes sure it matches
   * what is stored. Outside the tracked write: the load waits for writes in
   * flight, `write` included.
   */
  async function reloadOnFailure(write: Promise<void>): Promise<void> {
    try {
      await write
    } catch (e) {
      await get().loadAll().catch(() => {})
      throw e
    }
  }

  return {
  todos: [],
  todosVersion: 0,
  loaded: false,

  async loadAll() {
    const todos = await loadFresh(() => todoRepository.getAll(), 'tasks')
    if (todos) set({ todos, todosVersion: get().todosVersion + 1, loaded: true })
  },
  ensureAllLoaded: allEnsure,

  async add(title: string) {
    return mutate(async () => {
      const now = new Date()
      const defaultStatusId = useSettingsStore.getState().defaultStatusId
      const nextFollowupAt = newTaskDefaultFollowup(now)
      // Goes last (the repository picks the sort order in its transaction);
      // the row comes back from the insert itself, so nothing after it can
      // fail once the task exists.
      const [todo] = await todoRepository.insertManyWithAssignments([{
        todo: {
          title,
          isCompleted: false,
          createdAt: now,
          modifiedAt: now,
          ...(nextFollowupAt && { nextFollowupAt }),
          ...(defaultStatusId != null && { statusId: defaultStatusId }),
        },
        personIds: [],
        tagIds: [],
      }])
      if (!todo) throw new Error('The new task was not stored')
      set({ todos: [...get().todos, todo], todosVersion: get().todosVersion + 1 })
      registerCreated(`Add "${title}"`, todo, NO_ASSIGNMENTS)
      return todo.id
    }, 'Failed to add task')
  },

  async addMany(items, { description, snackbar = false }) {
    if (items.length === 0) return []
    return mutate(async () => {
      // The one step that can fail: once its transaction has committed the
      // tasks exist, so nothing after it may turn this into a reported
      // failure (a create surface stays open on failure, and a retry would
      // add the tasks twice). The rows come back from the insert itself.
      const created = await todoRepository.insertManyWithAssignments(items)
      const ids = created.map((t) => t.id)
      const snapshots = created.flatMap((todo, i) => {
        const item = items[i]
        return item ? [{ todo, personIds: [...item.personIds], tagIds: [...item.tagIds] }] : []
      })
      const show = () => {
        const present = new Set(get().todos.map((t) => t.id))
        set({
          todos: [...get().todos, ...snapshots.map((s) => s.todo).filter((t) => !present.has(t.id))],
          todosVersion: get().todosVersion + 1,
        })
      }
      const put = async () => {
        show()
        await reloadAssignments(get().todos.map((t) => t.id))
      }
      show()
      // Best effort: a failed cache reload leaves rows without their chips
      // until the next load, never an "add failed" for tasks that exist.
      await reloadAssignments(get().todos.map((t) => t.id)).catch((e: unknown) => {
        console.warn('[todo-store] reloading assignments after adding tasks failed', e)
      })
      let removedEvents: TodoEvent[] = []
      undoable(
        description,
        async () => {
          await todoRepository.restoreManyWithAssignments(
            snapshots.map((s) => ({ ...s, events: removedEvents.filter((e) => e.todoId === s.todo.id) })),
          )
          await put()
        },
        async () => {
          removedEvents = await todoRepository.bulkDelete(ids)
          useListOrderStore.getState().forgetTodos(ids)
          const idSet = new Set(ids)
          set({ todos: get().todos.filter((t) => !idSet.has(t.id)), todosVersion: get().todosVersion + 1 })
        },
        snackbar,
      )
      return ids
    }, 'Failed to add tasks')
  },

  async update(id: number, changes: TodoChanges) {
    const prev = get().todos.find((t) => t.id === id)
    if (!prev) return true
    // Resolve completedAt once and hand the same value to the repository, so
    // the store and the DB never hold two independently minted timestamps.
    const patch = changes.isCompleted === undefined ? changes : {
      ...changes,
      completedAt: resolveCompletedAt(prev, { isCompleted: changes.isCompleted, completedAt: changes.completedAt }, new Date()),
    }
    try {
      await patchTodo(id, patch, `Edit "${changes.title ?? prev.title}"`)
      return true
    } catch {
      // Rolled back and logged by `patchTodo`; most callers fire and forget.
      useUndoStore.getState().notify(`Couldn't save your change to "${prev.title}".`)
      return false
    }
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
        // Each write mints one timestamp for the store and the database.
        const write = async (changes: Pick<PersistedTodoItem, 'dueDate'>) => {
          const at = new Date()
          await todoRepository.bulkUpdate([{ todoId: id, changes }], at)
          set({ todos: get().todos.map((t) => (t.id === id ? { ...t, ...changes, modifiedAt: at } : t)) })
        }
        const now = new Date()
        return optimistic(
          () => set({
            todos: get().todos.map((t) =>
              t.id === id ? { ...t, ...nextChanges, modifiedAt: now } : t
            ),
          }),
          () => todoRepository.bulkUpdate([{ todoId: id, changes: nextChanges }], now),
          () => set({
            todos: get().todos.map((t) =>
              t.id === id ? { ...t, ...prevChanges, ...(t.modifiedAt === now ? { modifiedAt: todo.modifiedAt } : {}) } : t
            ),
          }),
          'Failed to advance recurring task',
          {
            description: `Advance recurring "${todo.title}"`,
            redo: () => write(nextChanges),
            undo: () => write(prevChanges),
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
      () => set({
        todos: get().todos.map((t) =>
          t.id === id ? { ...t, isCompleted: completed, completedAt, modifiedAt: now } : t
        ),
      }),
      () => todoRepository.complete(id, completed, completedAt, now),
      () => set({
        todos: get().todos.map((t) =>
          t.id === id
            ? { ...t, isCompleted: !completed, completedAt: todo.completedAt, ...(t.modifiedAt === now ? { modifiedAt: todo.modifiedAt } : {}) }
            : t
        ),
      }),
      'Failed to toggle task completion',
      {
        description: `${label} "${todo.title}"`,
        // Both write the completion this toggle went from / to — never a
        // second toggle from whatever the task is by then (which would
        // advance a recurring task, or re-complete with a fresh time).
        redo: () => writeCompletion(id, completed, completedAt),
        undo: () => writeCompletion(id, todo.isCompleted, todo.completedAt),
      },
    )
  },

  async remove(id: number) {
    return mutate(async () => {
      const todo = get().todos.find((t) => t.id === id)
      if (!todo) return
      const snapshot = { ...todo }
      const assignments = await captureAssignments(id)
      const ranks = await listOrderRepository.getByTodos([id])

      const events = await todoRepository.delete(id)
      useListOrderStore.getState().forgetTodos([id])
      set({ todos: get().todos.filter((t) => t.id !== id), todosVersion: get().todosVersion + 1 })

      undoable(
        `Delete "${todo.title}"`,
        async () => { await get()._removeNoUndo(id) },
        async () => {
          await get()._restore(snapshot, assignments, events)
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
      .map((t) => ({ id: t.id, wasCompleted: t.isCompleted, prevCompletedAt: t.completedAt, prevRule: t.recurrenceRule }))
    const normalIdSet = new Set(normalIds)
    // A rule without a due date to advance from: the write drops it
    // (`withOrphanedRuleDropped`, as the repository does), the undo puts it back.
    const ruleDropped = new Set(prevStates
      .filter((s) => s.prevRule != null && 'recurrenceRule' in withOrphanedRuleDropped(get().todos.find((t) => t.id === s.id) ?? {}, {}))
      .map((s) => s.id))
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
    return reloadOnFailure(optimistic(
      () => {
        set({
          todos: get().todos.map((t) => {
            const next = recurringNextMap.get(t.id)
            if (next) return { ...t, ...next, modifiedAt: now }
            if (normalIdSet.has(t.id)) {
              return {
                ...t,
                isCompleted: completed,
                completedAt: completedAtById.get(t.id),
                ...(ruleDropped.has(t.id) ? { recurrenceRule: undefined } : {}),
                modifiedAt: now,
              }
            }
            return t
          }),
        })
      },
      // One transaction: every task changes, or none does.
      () => todoRepository.bulkUpdate([
        ...recurringMutations,
        ...normalIds.map((id) => ({ todoId: id, changes: { isCompleted: completed, completedAt: completedAtById.get(id) } })),
      ], now),
      () => {
        const prevCompletedMap = new Map(prevStates.map(s => [s.id, s]))
        const prevModified = new Map(allTodos.map((t) => [t.id, t.modifiedAt]))
        const keepStamp = (t: PersistedTodoItem) =>
          t.modifiedAt === now ? { modifiedAt: prevModified.get(t.id) ?? t.modifiedAt } : {}
        set({
          todos: get().todos.map((t) => {
            const r = recurringPrevMap.get(t.id)
            if (r) return { ...t, dueDate: r.prev, ...keepStamp(t) }
            const prevState = prevCompletedMap.get(t.id)
            if (prevState) {
              const rule = ruleDropped.has(t.id) && t.recurrenceRule == null ? { recurrenceRule: prevState.prevRule } : {}
              return { ...t, isCompleted: prevState.wasCompleted, completedAt: prevState.prevCompletedAt, ...rule, ...keepStamp(t) }
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
          // One timestamp and one transaction for every write of the undo,
          // in the store and the DB: the recurring date advances go back,
          // and the completions (re-completing restores the original
          // completion time, resolved once per task).
          const undoNow = new Date()
          const reverts = prevStates
            .filter(s => s.wasCompleted !== completed || ruleDropped.has(s.id))
            .map(s => {
              const current = get().todos.find(t => t.id === s.id)
              const changes: Partial<PersistedTodoItem> = {}
              if (s.wasCompleted !== completed) {
                const next = { isCompleted: s.wasCompleted, completedAt: s.prevCompletedAt }
                changes.isCompleted = s.wasCompleted
                changes.completedAt = resolveCompletedAt(current, next, undoNow)
              }
              if (ruleDropped.has(s.id)) changes.recurrenceRule = s.prevRule
              return { id: s.id, changes }
            })
          if (recurringAdvances.length === 0 && reverts.length === 0) return
          await todoRepository.bulkUpdate([
            ...recurringAdvances.map(r => ({ todoId: r.id, changes: { dueDate: r.prev } })),
            ...reverts.map(r => ({ todoId: r.id, changes: r.changes })),
          ], undoNow)
          const revertMap = new Map(reverts.map(r => [r.id, r.changes]))
          set({
            todos: get().todos.map((t) => {
              const r = recurringPrevMap.get(t.id)
              if (r) return { ...t, dueDate: r.prev, modifiedAt: undoNow }
              const c = revertMap.get(t.id)
              return c ? { ...t, ...c, modifiedAt: undoNow } : t
            }),
          })
        },
        showSnackbar: true,
      },
    ))
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
    const prev = new Map(targets.map((t) => [t.id, { urgent: t.urgent, important: t.important, focus: t.focus, modifiedAt: t.modifiedAt }]))
    const patch = (c: MarkerFlagChange): Partial<PersistedTodoItem> => ({
      ...(c.urgent !== undefined ? { urgent: flagValue(c.urgent) } : {}),
      ...(c.important !== undefined ? { important: flagValue(c.important) } : {}),
      ...(c.focus !== undefined ? { focus: flagValue(c.focus) } : {}),
    })
    const ids = targets.map((t) => t.id)
    const restore = async (persist: boolean) => {
      if (persist) {
        // The earlier modifiedAt goes back too, as in the store below.
        await todoRepository.bulkUpdate(ids.map((todoId) => {
          const p = prev.get(todoId)
          return { todoId, changes: { urgent: p?.urgent, important: p?.important, focus: p?.focus, modifiedAt: p?.modifiedAt } }
        }))
      }
      set({
        todos: get().todos.map((t) => {
          const p = prev.get(t.id)
          return p ? { ...t, urgent: p.urgent, important: p.important, focus: p.focus, modifiedAt: p.modifiedAt } : t
        }),
      })
    }
    const now = new Date()
    return optimistic(
      () => {
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
      }), now),
      () => { void restore(false) },
      'Failed to update the priority flags',
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

  async markFollowedUp(ids: number[], options: MarkFollowedUpOptions = {}) {
    const targets = get().todos.filter((t) => ids.includes(t.id))
    if (targets.length === 0) return
    const { description, detail } = options
    const now = new Date()
    const next = options.next !== undefined ? options.next : autoNextFollowup(now)
    const changes = { lastFollowupAt: now, nextFollowupAt: next ?? undefined }
    const prev = new Map(targets.map((t) => [t.id, {
      lastFollowupAt: t.lastFollowupAt,
      nextFollowupAt: t.nextFollowupAt,
      modifiedAt: t.modifiedAt,
    }]))
    const targetIds = targets.map((t) => t.id)
    const name = description ?? (next ? `Followed up · next follow-up ${formatFollowupDate(next, now)}` : 'Followed up · no next follow-up')
    return optimistic(
      () => set({
        todos: get().todos.map((t) => (prev.has(t.id) ? { ...t, ...changes, modifiedAt: now } : t)),
      }),
      () => todoRepository.bulkUpdate(targetIds.map((todoId) => ({ todoId, changes })), now),
      // Each follow-up date back where it still holds what this write set (an
      // edit of it that landed meanwhile stays); the modifiedAt only where no
      // later write stamped it.
      () => set({
        todos: get().todos.map((t) => {
          const p = prev.get(t.id)
          if (!p) return t
          return {
            ...t,
            ...(t.lastFollowupAt?.getTime() === now.getTime() ? { lastFollowupAt: p.lastFollowupAt } : {}),
            ...(t.nextFollowupAt?.getTime() === next?.getTime() ? { nextFollowupAt: p.nextFollowupAt } : {}),
            ...(t.modifiedAt === now ? { modifiedAt: p.modifiedAt } : {}),
          }
        }),
      }),
      'Failed to mark tasks followed up',
      {
        description: name,
        detail,
        // The same next follow-up when it was given; else the rule again, from the redo's now.
        redo: () => get().markFollowedUp(targetIds, options),
        undo: async () => {
          const undoNow = new Date()
          await todoRepository.bulkUpdate(targetIds.map((todoId) => {
            const p = prev.get(todoId)
            return { todoId, changes: { lastFollowupAt: p?.lastFollowupAt, nextFollowupAt: p?.nextFollowupAt } }
          }), undoNow)
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
    return mutate(async () => {
      const snapshots = get().todos.filter((t) => ids.includes(t.id)).map(t => ({ ...t }))
      const assignments = await captureAssignmentsBulk(ids)
      const assignmentData = snapshots.map(t => {
        const a = assignments.find(a => a.todoId === t.id)
        return { todo: t, personIds: a?.personIds ?? [], tagIds: a?.tagIds ?? [] }
      })

      const ranks = await listOrderRepository.getByTodos(ids)

      const events = await todoRepository.bulkDelete(ids)
      useListOrderStore.getState().forgetTodos(ids)
      const idSet = new Set(ids)
      set({ todos: get().todos.filter((t) => !idSet.has(t.id)), todosVersion: get().todosVersion + 1 })

      undoable(
        noBackup ? `Delete ${ids.length} tasks — no backup was taken` : `Delete ${ids.length} tasks`,
        () => get().bulkRemove(ids),
        async () => {
          for (const { todo, personIds, tagIds } of assignmentData) {
            await get()._restore(todo, { personIds, tagIds }, events.filter((e) => e.todoId === todo.id))
          }
          await useListOrderStore.getState().restoreRows(ranks)
        },
        true,
      )
    }, 'Failed to delete tasks')
  },

  async duplicate(id: number) {
    return mutate(async () => {
      const todo = get().todos.find((t) => t.id === id)
      if (!todo) return undefined
      const now = new Date()
      const assignments = await captureAssignments(id)
      // The copy, its people and its tags in one transaction.
      const [newTodo] = await todoRepository.insertManyWithAssignments([{
        todo: {
          title: todo.title,
          isCompleted: false,
          createdAt: now,
          modifiedAt: now,
          dueDate: todo.dueDate,
          nextFollowupAt: todo.nextFollowupAt,
          notes: todo.notes,
          progress: todo.progress,
          statusId: todo.statusId,
          recurrenceRule: todo.recurrenceRule,
          ...(todo.urgent === true ? { urgent: true } : {}),
          ...(todo.important === true ? { important: true } : {}),
        },
        personIds: assignments.personIds,
        tagIds: assignments.tagIds,
      }])
      if (!newTodo) throw new Error('The copy was not stored')
      set({ todos: [...get().todos, newTodo], todosVersion: get().todosVersion + 1 })
      // Best effort: the copy exists; a failed cache reload only leaves its
      // chips missing until the next load.
      if (assignments.personIds.length > 0 || assignments.tagIds.length > 0) {
        await reloadAssignments(get().todos.map((t) => t.id)).catch((e: unknown) => {
          console.warn('[todo-store] reloading assignments after duplicating a task failed', e)
        })
      }
      registerCreated(`Duplicate "${todo.title}"`, newTodo, assignments)
      return newTodo.id
    }, 'Failed to duplicate task')
  },

  _restore(todo: PersistedTodoItem, { personIds, tagIds }: CapturedAssignments, events: readonly TodoEvent[] = []) {
    return trackWrite(async () => {
      await todoRepository.restoreManyWithAssignments([{ todo, personIds, tagIds, events }])
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
      const events = await todoRepository.delete(id)
      useListOrderStore.getState().forgetTodos([id])
      set({ todos: get().todos.filter((t) => t.id !== id), todosVersion: get().todosVersion + 1 })
      return events
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
