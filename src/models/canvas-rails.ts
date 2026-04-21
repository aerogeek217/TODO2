export type RailSide = 'left' | 'right' | 'top' | 'bottom'
export type RailOrientation = 'vertical' | 'horizontal'
export type SlotKind = 'lens' | 'notes' | 'calendar' | 'taskboard'
/** Alias used by per-tab content type (Phase 1 of rail-tabs). */
export type TabType = SlotKind
export type CalendarOrientation = 'vertical' | 'horizontal'

/** Max absolute week offset a calendar widget can persist; clamps runaway state. */
export const WEEK_OFFSET_MAX = 104

export interface Tab {
  id: string
  type: TabType
  listDefinitionId?: number
  taskboardId?: number
}

export interface Slot {
  id: string
  /**
   * Flex-grow weight used to distribute rail space among sibling slots.
   * Undefined means the default weight of 1 (equal share). Once the user
   * drags a divider, the batch update writes pixel-derived weights so the
   * non-adjacent slots keep their measured size.
   */
  flex?: number
  /**
   * Phase 1 (rail-tabs): every slot carries at least one tab. Single-tab
   * slots render identically to pre-P1 slots; multi-tab rendering arrives
   * in Phase 2. The active tab decides which body/header to show.
   */
  tabs: Tab[]
  activeTabId: string
  /** Calendar-slot only: row/column orientation. Undefined = default 'vertical'. Lives on the slot (not the tab) per Phase 1 scope. */
  orientation?: CalendarOrientation
  /** Calendar-slot only: week offset from today's week (0 = this week). Clamped to ±WEEK_OFFSET_MAX on parse. */
  weekOffset?: number
}

export const SLOT_MIN_PX = 80

export interface Rail {
  orientation: RailOrientation
  slots: Slot[]
}

/** Which rail owns a frame corner. `'h'` = top/bottom, `'v'` = left/right. */
export type CornerOwner = 'h' | 'v'
export type Corner = 'nw' | 'ne' | 'sw' | 'se'
export const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se']

/**
 * Where along an empty-side drop strip the pointer landed. `center` is a plain
 * dock (no corner claim); `start` / `end` dock **and** grant the new rail the
 * adjacent corner (see `cornerForSideClaim`).
 */
export type EmptySideClaim = 'start' | 'end'

/**
 * Map a (rail-side, start|end) pair to the corner that rail would claim.
 * Start is always the "leading" corner along the strip: west for horizontal
 * rails, north for vertical rails.
 */
export function cornerForSideClaim(side: RailSide, claim: EmptySideClaim): Corner {
  switch (side) {
    case 'top': return claim === 'start' ? 'nw' : 'ne'
    case 'bottom': return claim === 'start' ? 'sw' : 'se'
    case 'left': return claim === 'start' ? 'nw' : 'sw'
    case 'right': return claim === 'start' ? 'ne' : 'se'
  }
}

export interface RailsState {
  left: Rail | null
  right: Rail | null
  top: Rail | null
  bottom: Rail | null
  /**
   * Persisted widths for vertical rails (left/right). Absent = default.
   * Kept here even when the rail is null so closing/reopening preserves size.
   */
  widths?: { left?: number; right?: number }
  /** Persisted heights for horizontal rails (top/bottom). */
  heights?: { top?: number; bottom?: number }
  /**
   * Per-corner ownership. Absent / undefined value = `'v'` (vertical rail owns),
   * which reproduces the legacy layout where left/right rails span the full
   * viewport height and horizontal rails are pinched between them. Stored
   * values are preserved even when the claiming rail is absent so the claim
   * reappears if the rail is recreated; `resolveCorner` handles the dangling
   * case at render time.
   */
  corners?: Partial<Record<Corner, CornerOwner>>
}

export const RAIL_SIZE_MIN = 200
export const RAIL_SIZE_MAX = 600
export const DEFAULT_VERTICAL_RAIL_WIDTH = 340
export const DEFAULT_HORIZONTAL_RAIL_HEIGHT = 260

export function defaultRailSize(side: RailSide): number {
  return side === 'left' || side === 'right'
    ? DEFAULT_VERTICAL_RAIL_WIDTH
    : DEFAULT_HORIZONTAL_RAIL_HEIGHT
}

export function clampRailSize(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_VERTICAL_RAIL_WIDTH
  return Math.max(RAIL_SIZE_MIN, Math.min(RAIL_SIZE_MAX, Math.round(px)))
}

export function railSize(rails: RailsState, side: RailSide): number {
  if (side === 'left' || side === 'right') {
    const persisted = rails.widths?.[side]
    return typeof persisted === 'number' ? clampRailSize(persisted) : defaultRailSize(side)
  }
  const persisted = rails.heights?.[side]
  return typeof persisted === 'number' ? clampRailSize(persisted) : defaultRailSize(side)
}

export const EMPTY_RAILS: RailsState = {
  left: null,
  right: null,
  top: null,
  bottom: null,
}

export function railOrientationForSide(side: RailSide): RailOrientation {
  return side === 'left' || side === 'right' ? 'vertical' : 'horizontal'
}

export const SLOT_KINDS: readonly SlotKind[] = ['lens', 'notes', 'calendar', 'taskboard']

/**
 * Resolve the active tab of a slot. Falls back to `tabs[0]` when `activeTabId`
 * is stale; callers can assume a non-null return because parsing guarantees
 * `tabs.length >= 1` and `activeTabId` points at a tab (or has been repaired).
 */
export function getActiveTab(slot: Slot): Tab {
  return slot.tabs.find((t) => t.id === slot.activeTabId) ?? slot.tabs[0]
}

function parseTab(raw: unknown): Tab | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null
  if (typeof r.type !== 'string' || !SLOT_KINDS.includes(r.type as SlotKind)) return null
  const tab: Tab = { id: r.id, type: r.type as TabType }
  if (typeof r.listDefinitionId === 'number' && Number.isFinite(r.listDefinitionId)) {
    tab.listDefinitionId = r.listDefinitionId
  }
  if (typeof r.taskboardId === 'number' && Number.isFinite(r.taskboardId)) {
    tab.taskboardId = r.taskboardId
  }
  return tab
}

function parseSlot(raw: unknown): Slot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id.length === 0 || r.id.length > 100) return null

  // New shape: { id, tabs, activeTabId, flex?, orientation?, weekOffset? }
  let tabs: Tab[] | null = null
  let activeTabId: string | null = null
  if (Array.isArray(r.tabs)) {
    const parsedTabs: Tab[] = []
    for (const raw of r.tabs) {
      const t = parseTab(raw)
      if (t) parsedTabs.push(t)
    }
    if (parsedTabs.length === 0) return null
    tabs = parsedTabs
    const want = typeof r.activeTabId === 'string' ? r.activeTabId : null
    activeTabId = want && parsedTabs.some((t) => t.id === want) ? want : parsedTabs[0].id
  } else if (typeof r.kind === 'string' && SLOT_KINDS.includes(r.kind as SlotKind)) {
    // Legacy shape: { id, kind, listDefinitionId?, taskboardId?, flex?, orientation?, weekOffset? }
    const tab: Tab = { id: `${r.id}-t0`, type: r.kind as TabType }
    if (typeof r.listDefinitionId === 'number' && Number.isFinite(r.listDefinitionId)) {
      tab.listDefinitionId = r.listDefinitionId
    }
    if (typeof r.taskboardId === 'number' && Number.isFinite(r.taskboardId)) {
      tab.taskboardId = r.taskboardId
    }
    tabs = [tab]
    activeTabId = tab.id
  } else {
    return null
  }

  const slot: Slot = { id: r.id, tabs, activeTabId }
  if (typeof r.flex === 'number' && Number.isFinite(r.flex) && r.flex > 0) {
    slot.flex = r.flex
  }
  if (r.orientation === 'vertical' || r.orientation === 'horizontal') {
    slot.orientation = r.orientation
  }
  if (typeof r.weekOffset === 'number' && Number.isFinite(r.weekOffset)) {
    const n = Math.trunc(r.weekOffset)
    slot.weekOffset = Math.max(-WEEK_OFFSET_MAX, Math.min(WEEK_OFFSET_MAX, n))
  }
  return slot
}

function parseRail(raw: unknown, side: RailSide): Rail | null {
  if (raw == null) return null
  if (typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const expected = railOrientationForSide(side)
  const orientation = r.orientation === 'vertical' || r.orientation === 'horizontal' ? r.orientation : expected
  if (orientation !== expected) return null
  const rawSlots = Array.isArray(r.slots) ? r.slots : []
  const slots: Slot[] = []
  for (const s of rawSlots) {
    const parsed = parseSlot(s)
    if (parsed) slots.push(parsed)
  }
  if (slots.length === 0) return null
  return { orientation, slots }
}

function parseCorners(raw: unknown): Partial<Record<Corner, CornerOwner>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: Partial<Record<Corner, CornerOwner>> = {}
  let touched = false
  for (const c of CORNERS) {
    const v = r[c]
    if (v === 'h' || v === 'v') {
      out[c] = v
      touched = true
    }
  }
  return touched ? out : undefined
}

/**
 * Resolve which rail actually owns a corner, given the current rails state.
 * Falls back to the orthogonal side when the stored owner's rail is absent,
 * so the layout is always well-defined.
 */
export function resolveCorner(rails: RailsState, corner: Corner): CornerOwner {
  const stored = rails.corners?.[corner]
  const horizontalSide: RailSide = corner === 'nw' || corner === 'ne' ? 'top' : 'bottom'
  const verticalSide: RailSide = corner === 'nw' || corner === 'sw' ? 'left' : 'right'
  const hasHorizontal = rails[horizontalSide] != null
  const hasVertical = rails[verticalSide] != null
  const want: CornerOwner = stored ?? 'v'
  if (want === 'h' && !hasHorizontal) return 'v'
  if (want === 'v' && !hasVertical) return hasHorizontal ? 'h' : 'v'
  return want
}

export interface GridArea {
  /** 1-based CSS grid line numbers in a fixed 3×3 grid. */
  colStart: number
  colEnd: number
  rowStart: number
  rowEnd: number
}

/**
 * Compute the CSS grid-area for a rail in the 3×3 `RailsFrame` grid (lines
 * 1..4). The rail extends into corner cells when it owns them per the
 * resolved corner bag. `canvas-host` always occupies 2/2→3/3.
 */
export function computeRailGridArea(rails: RailsState, side: RailSide): GridArea {
  const nw = resolveCorner(rails, 'nw')
  const ne = resolveCorner(rails, 'ne')
  const sw = resolveCorner(rails, 'sw')
  const se = resolveCorner(rails, 'se')
  switch (side) {
    case 'top': return {
      rowStart: 1, rowEnd: 2,
      colStart: nw === 'h' ? 1 : 2,
      colEnd: ne === 'h' ? 4 : 3,
    }
    case 'bottom': return {
      rowStart: 3, rowEnd: 4,
      colStart: sw === 'h' ? 1 : 2,
      colEnd: se === 'h' ? 4 : 3,
    }
    case 'left': return {
      colStart: 1, colEnd: 2,
      rowStart: nw === 'v' ? 1 : 2,
      rowEnd: sw === 'v' ? 4 : 3,
    }
    case 'right': return {
      colStart: 3, colEnd: 4,
      rowStart: ne === 'v' ? 1 : 2,
      rowEnd: se === 'v' ? 4 : 3,
    }
  }
}

function parseSizeBag<K extends string>(raw: unknown, keys: readonly K[]): Partial<Record<K, number>> | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const out: Partial<Record<K, number>> = {}
  let touched = false
  for (const k of keys) {
    const v = r[k]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = clampRailSize(v)
      touched = true
    }
  }
  return touched ? out : undefined
}

export function serializeRailsState(rails: RailsState): string {
  return JSON.stringify(rails)
}

/** Parse a persisted rails blob. Returns null on any shape failure. */
export function parseRailsState(value: string | undefined | null): RailsState | null {
  if (!value) return null
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { return null }
  if (!parsed || typeof parsed !== 'object') return null
  const r = parsed as Record<string, unknown>
  const state: RailsState = {
    left: parseRail(r.left, 'left'),
    right: parseRail(r.right, 'right'),
    top: parseRail(r.top, 'top'),
    bottom: parseRail(r.bottom, 'bottom'),
  }
  const widths = parseSizeBag(r.widths, ['left', 'right'] as const)
  if (widths) state.widths = widths
  const heights = parseSizeBag(r.heights, ['top', 'bottom'] as const)
  if (heights) state.heights = heights
  const corners = parseCorners(r.corners)
  if (corners) state.corners = corners
  return state
}
