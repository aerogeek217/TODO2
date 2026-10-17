/**
 * What a Dashboard tab shows — its layout `config` (saved with the layout):
 * which built-in tiles, which saved lists as list tiles, and which sections,
 * each in display order. Absent from an array = hidden.
 */

/** The built-in tiles, in catalog order. */
export const DASHBOARD_TILE_IDS = [
  'open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup',
] as const
export type DashboardTileId = (typeof DASHBOARD_TILE_IDS)[number]

/** The tiles a new dashboard shows (six fit in a row). */
export const DEFAULT_DASHBOARD_TILES: readonly DashboardTileId[] = ['open', 'hot', 'focus', 'urgent', 'overdue', 'followupDue']

/** The sections, in default order. */
export const DASHBOARD_SECTION_IDS = ['hot', 'followup', 'next7', 'trend', 'status', 'people'] as const
export type DashboardSectionId = (typeof DASHBOARD_SECTION_IDS)[number]

/** Needs follow-up: how many days ahead (starting today) the section looks. */
export const DASHBOARD_LOOK_AHEAD_CHOICES = [3, 7, 14] as const
export type DashboardLookAhead = (typeof DASHBOARD_LOOK_AHEAD_CHOICES)[number]

/** Created vs completed: 14 days (daily bars) or 4 / 12 weeks (weekly bars). */
export const DASHBOARD_TREND_RANGES = ['14d', '4w', '12w'] as const
export type DashboardTrendRange = (typeof DASHBOARD_TREND_RANGES)[number]

/** Section options; each belongs to one section (others ignore it). */
export interface DashboardSectionOptions {
  /** Needs follow-up (default 7). */
  lookAhead?: DashboardLookAhead
  /** Created vs completed (default `14d`). */
  range?: DashboardTrendRange
  /** People: show the Unassigned row (default `true`). */
  showUnassigned?: boolean
}

export interface DashboardSectionConfig {
  id: DashboardSectionId
  options?: DashboardSectionOptions
}

export interface DashboardTabConfig {
  tiles: DashboardTileId[]
  /** List definition ids shown as list tiles. */
  listTiles: number[]
  sections: DashboardSectionConfig[]
}

export const DEFAULT_DASHBOARD_LOOK_AHEAD: DashboardLookAhead = 7
export const DEFAULT_DASHBOARD_TREND_RANGE: DashboardTrendRange = '14d'

/** A new dashboard's config: the default tiles, no list tiles, every section. */
export function defaultDashboardConfig(): DashboardTabConfig {
  return {
    tiles: [...DEFAULT_DASHBOARD_TILES],
    listTiles: [],
    sections: DASHBOARD_SECTION_IDS.map((id) => ({ id })),
  }
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
}

/** The section's known options (each section has its own). */
function pickOptions(id: DashboardSectionId, raw: unknown): DashboardSectionOptions | undefined {
  if (!isObj(raw)) return undefined
  const out: DashboardSectionOptions = {}
  if (id === 'followup' && includes(DASHBOARD_LOOK_AHEAD_CHOICES, raw.lookAhead)) out.lookAhead = raw.lookAhead
  if (id === 'trend' && includes(DASHBOARD_TREND_RANGES, raw.range)) out.range = raw.range
  if (id === 'people' && typeof raw.showUnassigned === 'boolean') out.showUnassigned = raw.showUnassigned
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * A dashboard config from untrusted input (a stored layout, an import):
 * known ids only, each once, in the given order; unknown option values
 * dropped. A missing array falls back to the default for that part, so a
 * tab saved before a part existed still shows it.
 */
export function normalizeDashboardConfig(raw: unknown): DashboardTabConfig {
  const config = isObj(raw) ? raw : {}
  const defaults = defaultDashboardConfig()

  const tiles = Array.isArray(config.tiles)
    ? [...new Set(config.tiles.filter((t): t is DashboardTileId => includes(DASHBOARD_TILE_IDS, t)))]
    : defaults.tiles

  const listTiles = Array.isArray(config.listTiles)
    ? [...new Set(config.listTiles.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))]
    : defaults.listTiles

  let sections = defaults.sections
  if (Array.isArray(config.sections)) {
    const seen = new Set<DashboardSectionId>()
    sections = []
    for (const s of config.sections) {
      if (!isObj(s) || !includes(DASHBOARD_SECTION_IDS, s.id) || seen.has(s.id)) continue
      seen.add(s.id)
      const options = pickOptions(s.id, s.options)
      sections.push(options ? { id: s.id, options } : { id: s.id })
    }
  }

  return { tiles, listTiles, sections }
}
