import type { DataRow, DataSet } from '../schema-upgrades'
import { startOfDay } from '../../utils/date'
import { isRecord } from '../../utils/is-record'

/**
 * v72 — status updates: a task's one-line Progress field (`todos.progress`)
 * becomes the first row of the new `statusUpdates` table (a dated line of
 * text; a task has any number of them).
 *
 * For each task whose `progress` is a non-empty string once trimmed (and
 * whose `id` is a positive whole number): one entry `{ todoId, date: the
 * local day of the task's modifiedAt, text: the trimmed text (at most 500
 * characters), createdAt: modifiedAt }` — a `modifiedAt` that doesn't read
 * falls back to the task's `createdAt`, and a task with neither gets no
 * entry. Every task row with a `progress` key loses it.
 *
 * Dates keep their form: ISO strings on import (validation revives them
 * after the pipeline) give ISO strings, `Date`s on the Dexie side give
 * `Date`s. Idempotent: no entry is added when `statusUpdates` already holds
 * one for the task with the same text. The `statusUpdates` key is set only
 * when there are rows to add or it is already there — a task archive is a
 * partial dataset.
 */
export function upgradeV72(data: DataSet): DataSet {
  const todos = data.todos
  if (!Array.isArray(todos) || !todos.some((t) => isRecord(t) && 'progress' in t)) return data

  const existing = Array.isArray(data.statusUpdates) ? data.statusUpdates : undefined
  const held = new Set((existing ?? []).flatMap((r) => (
    isRecord(r) && typeof r.text === 'string' ? [entryKey(r.todoId, r.text)] : []
  )))

  const added: DataRow[] = []
  const nextTodos = todos.map((t) => {
    if (!isRecord(t) || !('progress' in t)) return t
    const { progress, ...rest } = t
    const entry = entryOf(t.id, progress, t.modifiedAt, t.createdAt)
    if (entry && !held.has(entryKey(entry.todoId, entry.text))) {
      held.add(entryKey(entry.todoId, entry.text))
      added.push(entry)
    }
    return rest
  })

  if (added.length === 0) return { ...data, todos: nextTodos }
  return { ...data, todos: nextTodos, statusUpdates: [...(existing ?? []), ...added] }
}

/** Progress's cap, the entry's text's at v72 (a literal: the transform never changes once released). */
const TEXT_MAX = 500

function entryKey(todoId: unknown, text: string): string {
  return `${String(todoId)}\u0000${text}`
}

/** A task's Progress as its first status update, or none when it can't be read. */
function entryOf(id: unknown, progress: unknown, modifiedAt: unknown, createdAt: unknown): DataRow & { todoId: number; text: string } | undefined {
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1) return undefined
  if (typeof progress !== 'string') return undefined
  const text = progress.trim().slice(0, TEXT_MAX).trim()
  if (text === '') return undefined
  const when = readsAsDate(modifiedAt) ? modifiedAt : readsAsDate(createdAt) ? createdAt : undefined
  if (when === undefined) return undefined
  if (when instanceof Date) {
    return { todoId: id, date: startOfDay(when), text, createdAt: new Date(when.getTime()) }
  }
  return { todoId: id, date: startOfDay(new Date(Date.parse(when))).toISOString(), text, createdAt: when }
}

/** A `Date` that holds a time, or a string `Date.parse` reads. */
function readsAsDate(v: unknown): v is Date | string {
  if (v instanceof Date) return !isNaN(v.getTime())
  return typeof v === 'string' && !isNaN(Date.parse(v))
}
