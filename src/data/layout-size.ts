import { isRecord } from '../utils/is-record'
import { LAYOUT_PART_LIMIT } from './layout-shape'

/**
 * The size of the layouts in a file, checked **before the schema upgrades
 * run** (`import-pipeline.prepareImport`): a layout holding far more parts
 * than the app keeps is refused with a message that says so (cr34 S1,
 * answer 21).
 *
 * What reads a layout takes time with the square of its parts — the v78
 * table conversion, the tab walk's close (`upgrades/layout-tabs`), the
 * tiling check — and the only limit before them was 100,000 rows a table:
 * an 80 KB file whose one layout held 40,000 tracks took 28 s, at every
 * launch when it was the sync file. The part limit a layout keeps
 * (`LAYOUT_PART_LIMIT`) is applied last, by the layout repair, to the
 * current shape only.
 *
 * Counted on the raw row of any supported schema version, by the keys that
 * hold a layout's parts in all of them (no upgrade has run yet): the table
 * of v78 on (`grid.columns`, `grid.rows`, `cells`, each cell's `tabs`), the
 * columns → rows → cells and the `top` / `bottom` bands before it, and a
 * retired Dashboard tab's part lists (`tiles`, `listTiles`, `sections`),
 * each of which v77 made a cell.
 */

/**
 * The most parts — column and row tracks, cells and tabs, all together — a
 * layout row in a file may hold: ten times what a layout keeps of any one
 * of them. A layout past `LAYOUT_PART_LIMIT` of one sort and within this
 * still imports, trimmed with a warning (the layout repair), as before.
 */
export const LAYOUT_FILE_PART_LIMIT = 10 * LAYOUT_PART_LIMIT

/**
 * The most the layouts of one file may hold together, as the sum of each
 * layout's parts squared: what one layout at `LAYOUT_FILE_PART_LIMIT` comes
 * to. The cost of reading a layout grows with that square, so this holds a
 * file of many large layouts to the cost of one at the limit — a hundred
 * layouts of a thousand parts each, or ten thousand of a hundred.
 */
export const LAYOUT_FILE_WORK_LIMIT = LAYOUT_FILE_PART_LIMIT ** 2

/** The keys whose list holds layout parts, in every schema version's shape. */
const PART_LIST_KEYS = ['columns', 'rows', 'cells', 'tabs'] as const
/** The keys whose object holds such lists: the table's grid (v78 on), the bands (before it). */
const PART_HOLDER_KEYS = ['grid', 'top', 'bottom'] as const
/**
 * A retired Dashboard tab's part lists, in its config — v77 made each entry
 * a widget in a cell of its own —, with how many entries a Dashboard
 * without the list had (its defaults) and the most v77 reads of one (the
 * tiles and sections it knows; any number of list tiles).
 */
const DASHBOARD_LISTS = [
  { key: 'tiles', absent: 5, most: 8 },
  { key: 'listTiles', absent: 0, most: Number.POSITIVE_INFINITY },
  { key: 'sections', absent: 5, most: 9 },
] as const

/** The cells a Dashboard tab becomes in v77: its part lists' entries, as v77 reads them. */
function dashboardParts(tab: Record<string, unknown>): number {
  const config = isRecord(tab.config) ? tab.config : {}
  let parts = 0
  for (const { key, absent, most } of DASHBOARD_LISTS) {
    const list: unknown = config[key]
    parts += Array.isArray(list) ? Math.min(list.length, most) : absent
  }
  return parts
}

/**
 * How many parts a raw layout row holds: every entry of a track list, a
 * cell list and a tab strip at any depth (a list under a key that holds
 * parts, found through the keys that hold them — a tab's settings are not
 * walked), plus the cells a Dashboard tab becomes. One pass, no recursion.
 */
export function layoutPartCount(row: unknown): number {
  let count = 0
  const stack: unknown[] = [row]
  while (stack.length > 0) {
    const node = stack.pop()
    if (!isRecord(node)) continue
    for (const key of PART_HOLDER_KEYS) {
      if (isRecord(node[key])) stack.push(node[key])
    }
    for (const key of PART_LIST_KEYS) {
      const list: unknown = node[key]
      if (!Array.isArray(list)) continue
      count += list.length
      for (const part of list as unknown[]) stack.push(part)
    }
    if (node.kind === 'dashboard') count += dashboardParts(node)
  }
  return count
}

/** Longest layout name a message quotes; longer ones end in `…`. */
const NAME_MAX = 60

function layoutLabel(row: unknown): string {
  const name = isRecord(row) && typeof row.name === 'string' && row.name.trim() !== '' ? row.name : null
  if (name === null) return 'A layout'
  return `Layout "${name.length > NAME_MAX ? `${name.slice(0, NAME_MAX)}…` : name}"`
}

const count = (n: number) => n.toLocaleString('en-US')

/**
 * Why a file's layouts are too large to read, in words for the import's
 * error; `null` when they are within the limits: one layout past
 * `LAYOUT_FILE_PART_LIMIT` (named), or all of them together past
 * `LAYOUT_FILE_WORK_LIMIT`.
 */
export function layoutSizeProblem(layouts: readonly unknown[]): string | null {
  let work = 0
  let total = 0
  for (const row of layouts) {
    const parts = layoutPartCount(row)
    if (parts > LAYOUT_FILE_PART_LIMIT) {
      return `${layoutLabel(row)} holds too many parts to read: ${count(parts)} columns, rows, cells and tabs. `
        + `TODO2 reads at most ${count(LAYOUT_FILE_PART_LIMIT)} in one layout (and keeps ${count(LAYOUT_PART_LIMIT)} of each).`
    }
    work += parts * parts
    total += parts
  }
  if (work > LAYOUT_FILE_WORK_LIMIT) {
    return `The layouts in this file are too large to read together: ${count(layouts.length)} layouts holding `
      + `${count(total)} columns, rows, cells and tabs. TODO2 reads one layout of ${count(LAYOUT_FILE_PART_LIMIT)}, or many smaller ones.`
  }
  return null
}
