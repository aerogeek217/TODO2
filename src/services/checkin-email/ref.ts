/**
 * Task refs: the short `Ref <token>` a check-in email prints next to each
 * task so a pasted reply can be matched back to the task. A ref is a prefix
 * of the task's ref key (derived from its `uid`), so the same task keeps the
 * same ref across emails.
 */

/** Length of a ref (longer only when needed to tell two tasks apart). */
export const TASK_REF_LENGTH = 8

/** FNV-1a (32-bit) of `s`'s UTF-16 code units, as 8 hex digits. */
function fnv1aHex(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** `s`'s ASCII letters and digits, lowercased. */
function alnumLower(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/**
 * The string a task's refs are prefixes of: the uid's ASCII letters and
 * digits, lowercased (a UUID → its 32 hex digits). A uid with fewer than
 * eight of them (an odd imported uid) uses a hash of the whole uid instead.
 */
export function taskRefKey(uid: string): string {
  const key = alnumLower(uid)
  return key.length >= TASK_REF_LENGTH ? key : fnv1aHex(uid)
}

/** A task's ref: the first eight characters of its ref key. */
export function taskRef(uid: string): string {
  return taskRefKey(uid).slice(0, TASK_REF_LENGTH)
}

/**
 * Refs for every uid in `uids`, as a lookup: each ref is the shortest prefix
 * (at least eight characters) of the uid's ref key that no other uid's key
 * starts with, so two tasks whose keys share their first eight characters
 * still get refs that tell them apart. Unknown uids get `taskRef`.
 */
export function createTaskRefLookup(uids: Iterable<string>): (uid: string) => string {
  const keys = [...new Set([...uids].map(taskRefKey))].sort()
  const refByKey = new Map<string, string>()
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] ?? ''
    // Sorted, so the keys sharing the longest prefix with `key` are its neighbours.
    const shared = Math.max(commonPrefix(key, keys[i - 1]), commonPrefix(key, keys[i + 1]))
    refByKey.set(key, key.slice(0, Math.max(TASK_REF_LENGTH, shared + 1)))
  }
  return (uid) => refByKey.get(taskRefKey(uid)) ?? taskRef(uid)
}

function commonPrefix(a: string, b: string | undefined): number {
  if (b == null) return 0
  let n = 0
  while (n < a.length && n < b.length && a[n] === b[n]) n++
  return n
}

export type ResolvedTaskRef<T> =
  | { status: 'found'; todo: T }
  | { status: 'not-found' }
  | { status: 'ambiguous'; matches: T[] }

/**
 * The task a ref names: the one task whose ref key starts with `ref` (after
 * the same lowercasing / letters-and-digits normalisation). `not-found` when
 * none does or the ref is shorter than eight characters; `ambiguous` when
 * several do (unless exactly one key is the whole ref).
 */
export function resolveTaskRef<T extends { uid: string }>(ref: string, todos: Iterable<T>): ResolvedTaskRef<T> {
  const needle = alnumLower(ref)
  if (needle.length < TASK_REF_LENGTH) return { status: 'not-found' }
  const matches: T[] = []
  for (const t of todos) {
    if (taskRefKey(t.uid).startsWith(needle)) matches.push(t)
  }
  const [only] = matches
  if (only === undefined) return { status: 'not-found' }
  if (matches.length === 1) return { status: 'found', todo: only }
  // A key that is the whole ref wins over keys that merely start with it.
  const exact = matches.filter((t) => taskRefKey(t.uid) === needle)
  const [exactOnly] = exact
  if (exact.length === 1 && exactOnly !== undefined) return { status: 'found', todo: exactOnly }
  return { status: 'ambiguous', matches }
}
