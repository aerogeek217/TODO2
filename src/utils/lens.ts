import { emptyPredicate, type TodoPredicate } from '../models/filter-predicate'
import type { Status } from '../models'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { predicateToCriteria, type FilterCriteria } from './filter-criteria'
import { withNormalizedNegation } from './filter-negation'
import { registerModuleReset } from './module-reset'

/**
 * Lenses: named, saved screen filters, defined once (Settings › Tasks ›
 * Lenses, one settings row — `data/lens-shape`) and picked per layout (the
 * layout's `lensId`, view state). The open layout's lens composes under the
 * top bar's chips wherever the screen filter applies (`withLens`). A lens
 * only hides: completed tasks are the chips' Show completed, never a lens's.
 *
 * Not to be confused with the list widget's stored kind id `lens` (its old
 * name, `models/workspace-layout`).
 */
export interface Lens {
  /** Unique among the lenses (`newLensId`); what a layout's `lensId` names. */
  id: string
  /** Trimmed, 1–`LENS_NAME_MAX` characters. */
  name: string
  /** What the lens keeps (its `showCompleted` is always false). */
  predicate: TodoPredicate
}

/** The longest lens name. */
export const LENS_NAME_MAX = 100

/** The most lenses kept (far past any hand-made set; a file holding more keeps the first ones). */
export const LENSES_MAX = 200

/** The longest lens id read (the app's are `lens-` + 8 characters). */
export const LENS_ID_MAX = 100

/** `name` as a lens keeps it: trimmed; `null` when blank or too long. */
export function cleanLensName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed.length > 0 && trimmed.length <= LENS_NAME_MAX ? trimmed : null
}

/** `p` as a lens keeps it: completed tasks off, its "is not" switches normalised. */
export function lensPredicate(p: TodoPredicate): TodoPredicate {
  return withNormalizedNegation({ ...p, showCompleted: false })
}

/** The last `withLens` call, so every caller with the same inputs gets the same object (stores compare by reference). */
let lastComposed: { screen: FilterCriteria; lens: Lens | undefined; out: FilterCriteria } | null = null
registerModuleReset(() => { lastComposed = null })

/**
 * The screen filter as every widget applies it: the top bar's chips
 * (`screen`) with `lens` (the open layout's, unless lifted) under them as
 * `FilterCriteria.lens`. No lens = `screen` itself. The same inputs give
 * the same object.
 */
export function withLens(screen: FilterCriteria, lens: Lens | undefined): FilterCriteria {
  if (!lens) return screen
  if (lastComposed && lastComposed.screen === screen && lastComposed.lens === lens) return lastComposed.out
  const out: FilterCriteria = { ...screen, lens: predicateToCriteria(lens.predicate) }
  lastComposed = { screen, lens, out }
  return out
}

/** An id no lens of `lenses` has. */
export function newLensId(lenses: readonly Lens[]): string {
  const used = new Set(lenses.map((l) => l.id))
  let id: string
  do id = `lens-${Math.random().toString(36).slice(2, 10)}`
  while (used.has(id))
  return id
}

/** The lens `id` names, or `undefined` (none picked, or a lens deleted since). */
export function findLens(lenses: readonly Lens[], id: string | null | undefined): Lens | undefined {
  return id == null ? undefined : lenses.find((l) => l.id === id)
}

/**
 * The layouts that picked lens `id`, in `layouts`' order — the open layout
 * as edited (`open`, which may be an unsaved new one) instead of its stored
 * copy.
 */
export function layoutsUsingLens<L extends Pick<WorkspaceLayout, 'name' | 'lensId'> & { id: number }>(
  layouts: readonly L[],
  open: L | null,
  id: string,
): L[] {
  const all = open && !layouts.some((l) => l.id === open.id) ? [...layouts, open] : layouts
  return all.map((l) => (open && l.id === open.id ? open : l)).filter((l) => l.lensId === id)
}

/** Layout names as a sentence's list: `Default`, `Default and Planning`, `A, B and C`. */
export function layoutNamesText(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

/** `name`, or `name 2`, `name 3`, … — the first no lens of `lenses` has (a duplicate's name). */
export function uniqueLensName(lenses: readonly Lens[], name: string): string {
  const taken = new Set(lenses.map((l) => l.name.toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const candidate = `${name.slice(0, LENS_NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
}

/** The status the Not waiting preset hides: the first named Waiting (any case), else none. */
export function waitingStatusId(statuses: readonly Status[]): number | null {
  return statuses.find((s) => s.id != null && s.name.trim().toLowerCase() === 'waiting')?.id ?? null
}

/**
 * The preset lenses, seeded once (the first open of Settings › Lenses): This
 * month (due within 30 days or none, follow-up within 14 days or none), Not
 * waiting (only when a status named Waiting exists), Has a person, Fresh
 * (modified within 30 days). `ids` gives each its id, in that order.
 */
export function presetLenses(waitingId: number | null, ids: () => string): Lens[] {
  const preset = (name: string, patch: Partial<TodoPredicate>): Lens => ({
    id: ids(),
    name,
    predicate: lensPredicate({ ...emptyPredicate(), ...patch }),
  })
  return [
    preset('This month', {
      dates: {
        deadline: { match: 'range', start: null, end: { kind: 'offset', days: 30 }, includeNoDate: true },
        followup: { match: 'range', start: null, end: { kind: 'offset', days: 14 }, includeNoDate: true },
      },
    }),
    ...(waitingId != null ? [preset('Not waiting', { statusIds: [waitingId], negate: { statusIds: true } })] : []),
    preset('Has a person', { personIds: [0], negate: { personIds: true } }),
    preset('Fresh', { dates: { modified: { match: 'range', start: { kind: 'offset', days: -30 }, end: null } } }),
  ]
}
