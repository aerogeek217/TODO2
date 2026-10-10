import type { DataRow, DataSet } from '../schema-upgrades'
import { newTodoUid } from '../../utils/todo-uid'

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

/** Epoch ms of a `Date` / parseable string, else `null`. */
function toMs(v: unknown): number | null {
  const ms = v instanceof Date ? v.getTime() : typeof v === 'string' ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? ms : null
}

/**
 * cyrb128 (public-domain 128-bit string hash by bryc). Not cryptographic —
 * it only has to spread distinct inputs; uniqueness is enforced separately.
 */
function hash128(str: string): [number, number, number, number] {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i)
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067)
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233)
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213)
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179)
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067)
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233)
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213)
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179)
  h1 ^= h2 ^ h3 ^ h4
  h2 ^= h1
  h3 ^= h1
  h4 ^= h1
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0]
}

/**
 * Deterministic backfill uid for an existing task: a UUID-shaped (version 8,
 * "custom") hash of `id | createdAt | title`.
 *
 * Deterministic on purpose: the live DB (Dexie upgrade) and a copy of the
 * same data in a sync file / backup (import upgrade) must end up with the
 * *same* uid for the same task — otherwise every upgraded file would differ
 * from the upgraded browser DB (release gate: first-deploy sync comparison)
 * and a re-imported archive of an existing task wouldn't match by uid.
 * Distinct tasks in one DB differ in `id`, so they hash apart; across
 * databases the inputs only coincide for copies of the same task.
 */
export function backfillTodoUid(row: DataRow): string {
  const created = toMs(row.createdAt)
  const key = `${String(row.id)}|${created ?? ''}|${typeof row.title === 'string' ? row.title : ''}`
  const hex = hash128(key).map((n) => n.toString(16).padStart(8, '0')).join('')
  const variant = ((parseInt(hex.charAt(16), 16) & 0x3) | 0x8).toString(16)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

/** todoId → latest `'completed'` event time (ms). Tolerates a missing table. */
function lastCompletedByTodo(events: DataRow[] | undefined): Map<unknown, number> {
  const out = new Map<unknown, number>()
  if (!Array.isArray(events)) return out
  for (const ev of events) {
    if (!isRecord(ev) || ev.type !== 'completed') continue
    const ms = toMs(ev.timestamp)
    if (ms === null) continue
    const prev = out.get(ev.todoId)
    if (prev === undefined || ms > prev) out.set(ev.todoId, ms)
  }
  return out
}

/**
 * v51 — `TodoItem.uid` + `completedAt`.
 *
 * - **uid**: every todo gets one. An existing non-empty string uid is kept
 *   unless an earlier row already holds it; otherwise `backfillTodoUid`
 *   (deterministic — see there), with a random uid only if that collides.
 *   The result is unique across the table (Dexie index `&uid`).
 * - **completedAt** for completed todos that lack it: the latest
 *   `'completed'` todoEvent, else `modifiedAt` (pre-v42 completions have no
 *   event — `modifiedAt` is the best remaining evidence, and it errs late,
 *   i.e. towards keeping the task longer), else `createdAt`. A non-completed
 *   todo carrying a `completedAt` has it removed.
 *
 * Runs for the live DB and imported files alike; tolerates a missing
 * `todoEvents` table (task archives) and passes malformed rows through for
 * validation. Idempotent: a table already in the v51 shape keeps its array
 * reference.
 */
export function upgradeV51(data: DataSet): DataSet {
  const todos = data.todos
  if (!Array.isArray(todos)) return data
  const completedAtByTodo = lastCompletedByTodo(data.todoEvents)
  const seen = new Set<string>()
  let changed = false

  const next = todos.map((row) => {
    if (!isRecord(row)) return row
    let out: DataRow | null = null

    let uid = row.uid
    if (typeof uid !== 'string' || uid.length === 0 || seen.has(uid)) {
      uid = backfillTodoUid(row)
      if (seen.has(uid as string)) uid = newTodoUid()
      ;(out ??= { ...row }).uid = uid
    }
    seen.add(uid as string)

    if (row.isCompleted === true) {
      if (row.completedAt == null) {
        const ms = completedAtByTodo.get(row.id) ?? toMs(row.modifiedAt) ?? toMs(row.createdAt)
        if (ms !== null) (out ??= { ...row }).completedAt = new Date(ms)
      }
    } else if ('completedAt' in row) {
      out ??= { ...row }
      delete out.completedAt
    }

    if (out) changed = true
    return out ?? row
  })

  return changed ? { ...data, todos: next } : data
}
