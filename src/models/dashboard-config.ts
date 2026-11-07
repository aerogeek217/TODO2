/**
 * What a Dashboard tab shows — its layout `config` (saved with the layout):
 * which built-in tiles, which of the layout's lists as list tiles, and which sections,
 * each in display order. Absent from an array = hidden.
 */

import {
  DEFAULT_LOOK_AHEAD,
  DEFAULT_RECENT_DAYS,
  DEFAULT_STALE_DAYS,
  DEFAULT_TREND_RANGE,
  LOOK_AHEAD_CHOICES,
  pickSectionOptions,
  RECENT_DAYS_CHOICES,
  SECTION_IDS,
  STALE_DAYS_CHOICES,
  TILE_METRIC_IDS,
  TREND_RANGES,
  type LookAhead,
  type RecentDays,
  type SectionId,
  type SectionOptions,
  type StaleDays,
  type TileMetricId,
  type TrendRange,
} from './glance-widgets'

/** The built-in tiles, in catalog order (the Number metrics `models/glance-widgets` owns). */
export const DASHBOARD_TILE_IDS = TILE_METRIC_IDS
export type DashboardTileId = TileMetricId

/** The tiles a new dashboard shows. */
export const DEFAULT_DASHBOARD_TILES: readonly DashboardTileId[] = ['open', 'focus', 'urgent', 'overdue', 'followupDue']

/** The sections, in catalog order (Customize lists hidden ones in this order). */
export const DASHBOARD_SECTION_IDS = SECTION_IDS
export type DashboardSectionId = SectionId

/**
 * The sections a new dashboard shows, in order, filling a full-screen cell in
 * two rows. The rest are added from Customize.
 */
export const DEFAULT_DASHBOARD_SECTIONS: readonly DashboardSectionId[] = ['followup', 'next7', 'trend', 'status', 'people']

// The section options' choices and defaults (`models/glance-widgets`, shared with the glance widgets).
export const DASHBOARD_LOOK_AHEAD_CHOICES = LOOK_AHEAD_CHOICES
export type DashboardLookAhead = LookAhead
export const DASHBOARD_TREND_RANGES = TREND_RANGES
export type DashboardTrendRange = TrendRange
export const DASHBOARD_STALE_DAYS_CHOICES = STALE_DAYS_CHOICES
export type DashboardStaleDays = StaleDays
export const DASHBOARD_RECENT_DAYS_CHOICES = RECENT_DAYS_CHOICES
export type DashboardRecentDays = RecentDays

/** Section options; each belongs to one section (others ignore it). */
export type DashboardSectionOptions = SectionOptions

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

export const DEFAULT_DASHBOARD_LOOK_AHEAD = DEFAULT_LOOK_AHEAD
export const DEFAULT_DASHBOARD_TREND_RANGE = DEFAULT_TREND_RANGE
export const DEFAULT_DASHBOARD_STALE_DAYS = DEFAULT_STALE_DAYS
export const DEFAULT_DASHBOARD_RECENT_DAYS = DEFAULT_RECENT_DAYS

/** A new dashboard's config: the default tiles, no list tiles, the default sections. */
export function defaultDashboardConfig(): DashboardTabConfig {
  return {
    tiles: [...DEFAULT_DASHBOARD_TILES],
    listTiles: [],
    sections: DEFAULT_DASHBOARD_SECTIONS.map((id) => ({ id })),
  }
}

type Obj = Record<string, unknown>

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function includes<T extends string | number>(list: readonly T[], v: unknown): v is T {
  return (list as readonly unknown[]).includes(v)
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
      const options = pickSectionOptions(s.id, s.options)
      sections.push(options ? { id: s.id, options } : { id: s.id })
    }
  }

  return { tiles, listTiles, sections }
}
