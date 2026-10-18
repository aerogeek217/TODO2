import {
  DASHBOARD_SECTION_IDS,
  DASHBOARD_TILE_IDS,
  DEFAULT_DASHBOARD_LOOK_AHEAD,
  DEFAULT_DASHBOARD_RECENT_DAYS,
  DEFAULT_DASHBOARD_STALE_DAYS,
  DEFAULT_DASHBOARD_TREND_RANGE,
  type DashboardSectionConfig,
  type DashboardSectionId,
  type DashboardSectionOptions,
  type DashboardTabConfig,
  type DashboardTileId,
} from '../../../models/dashboard-config'

/**
 * What the Customize dialog keeps beside the tab's config: every tile and
 * section in the order the dialog lists them (shown ones first, in the
 * config's order, then the hidden ones), and each section's options — so a
 * hidden item keeps its place and options while the dialog is open. The
 * config is always derived from it: shown items in this order.
 */
export interface CustomizeState {
  tileOrder: DashboardTileId[]
  sectionOrder: DashboardSectionId[]
  options: Partial<Record<DashboardSectionId, DashboardSectionOptions>>
}

/** The dialog's starting state for `config`. */
export function customizeStateFrom(config: DashboardTabConfig): CustomizeState {
  const shownSections = config.sections.map((s) => s.id)
  const options: CustomizeState['options'] = {}
  for (const s of config.sections) if (s.options) options[s.id] = s.options
  return {
    tileOrder: [...config.tiles, ...DASHBOARD_TILE_IDS.filter((id) => !config.tiles.includes(id))],
    sectionOrder: [...shownSections, ...DASHBOARD_SECTION_IDS.filter((id) => !shownSections.includes(id))],
    options,
  }
}

/** `list` with the item at `from` moved to `to`. */
export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list]
  const [moved] = next.splice(from, 1)
  if (moved === undefined) return next
  next.splice(to, 0, moved)
  return next
}

/** `set` with `item` added or removed. */
export function toggled<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set)
  if (next.has(item)) next.delete(item)
  else next.add(item)
  return next
}

/** The config's tiles: the shown ones, in the dialog's order. */
export function tilesFor(state: CustomizeState, shown: ReadonlySet<DashboardTileId>): DashboardTileId[] {
  return state.tileOrder.filter((id) => shown.has(id))
}

/** A section's options without the defaults (a default reads the same stored or not). */
function storedOptions(id: DashboardSectionId, options: DashboardSectionOptions | undefined): DashboardSectionOptions | undefined {
  if (!options) return undefined
  const out: DashboardSectionOptions = {}
  if (id === 'followup' && options.lookAhead != null && options.lookAhead !== DEFAULT_DASHBOARD_LOOK_AHEAD) out.lookAhead = options.lookAhead
  if (id === 'trend' && options.range != null && options.range !== DEFAULT_DASHBOARD_TREND_RANGE) out.range = options.range
  if (id === 'people' && options.showUnassigned === false) out.showUnassigned = false
  if (id === 'tags' && options.showUntagged === false) out.showUntagged = false
  if (id === 'stale' && options.staleDays != null && options.staleDays !== DEFAULT_DASHBOARD_STALE_DAYS) out.staleDays = options.staleDays
  if (id === 'recent' && options.recentDays != null && options.recentDays !== DEFAULT_DASHBOARD_RECENT_DAYS) out.recentDays = options.recentDays
  return Object.keys(out).length > 0 ? out : undefined
}

/** The config's sections: the shown ones, in the dialog's order, with their options. */
export function sectionsFor(state: CustomizeState, shown: ReadonlySet<DashboardSectionId>): DashboardSectionConfig[] {
  return state.sectionOrder.filter((id) => shown.has(id)).map((id) => {
    const options = storedOptions(id, state.options[id])
    return options ? { id, options } : { id }
  })
}

/** `state` with one option of section `id` set. */
export function withSectionOption<K extends keyof DashboardSectionOptions>(
  state: CustomizeState,
  id: DashboardSectionId,
  key: K,
  value: DashboardSectionOptions[K],
): CustomizeState {
  return { ...state, options: { ...state.options, [id]: { ...state.options[id], [key]: value } } }
}

/** Effective option values (stored value, or the default). */
export function sectionOptionValues(options: DashboardSectionOptions | undefined): Required<DashboardSectionOptions> {
  return {
    lookAhead: options?.lookAhead ?? DEFAULT_DASHBOARD_LOOK_AHEAD,
    range: options?.range ?? DEFAULT_DASHBOARD_TREND_RANGE,
    showUnassigned: options?.showUnassigned ?? true,
    showUntagged: options?.showUntagged ?? true,
    staleDays: options?.staleDays ?? DEFAULT_DASHBOARD_STALE_DAYS,
    recentDays: options?.recentDays ?? DEFAULT_DASHBOARD_RECENT_DAYS,
  }
}

/**
 * The list tiles the dialog shows and writes: the config's, minus lists that
 * no longer exist. (The widget skips a deleted list's id without removing
 * it, so undoing the delete brings the tile back; an edit here drops it.)
 */
export function knownListTiles(config: DashboardTabConfig, known: ReadonlySet<number>): number[] {
  return config.listTiles.filter((id) => known.has(id))
}
