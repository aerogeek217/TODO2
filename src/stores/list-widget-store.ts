import { create } from 'zustand'
import type { FilterExpr } from '../models'
import type { ListZoom, WorkspaceLayout } from '../models/workspace-layout'
import { useWorkspaceStore } from './workspace-store'
import { layoutTabs } from '../utils/workspace-layout-queries'

/** Viewport point a popover hangs from, and which edge of it lines up. */
export interface PopoverPoint {
  x: number
  y: number
  align: 'start' | 'end'
  /**
   * The rect of the element the point was measured from (`pointBelow`), when
   * there is one: the popover is then anchored to it (`anchorAtPoint`), so
   * its caret points at it (D21).
   */
  rect?: { left: number; top: number; right: number; bottom: number }
}

/** One group of a list tab's tasks as shown (`label`: its header; an ungrouped list has one). */
export interface ShownListSection {
  key: string
  label: string
  todos: readonly { id: number }[]
}

/**
 * A list tab's tasks as it shows them now — its filter, prompt pick and the
 * screen filter, in display order (collapsed groups too): what a review of
 * the tab takes (`services/review.listReview`).
 */
export interface ShownList {
  /** The list it shows. */
  listId: number
  /** The list's name. */
  label: string
  /** The list in words (its filter, grouping and sort). */
  description: string
  /** The list shows group headers. */
  grouped: boolean
  sections: readonly ShownListSection[]
}

/** A filter field a list's filter picker edits. */
export type ListFilterField = 'people' | 'tags' | 'status' | 'markers' | 'dates' | 'text'

/**
 * What a Review widget reviews (widget feedback 2A): the filter its field
 * last read — an expression (`TodoPredicate.expression`) and its `done`.
 */
export interface ReviewFilter {
  expression: FilterExpr
  showCompleted: boolean
}

/**
 * State of workspace list widgets that is never saved: per-tab prompt picks
 * and collapsed groups (keyed by layout tab id, so they follow a tab that is
 * moved to another cell). A Review widget's filter is kept here too (widget
 * feedback 2A), under its own tab id.
 */
interface ListWidgetState {
  /**
   * Picks of a list tab's runtime prompt, by tab id. Temporary by design:
   * never saved, so a reload starts with nothing picked. Absent = nothing
   * picked.
   */
  picks: Readonly<Record<string, number[]>>
  /**
   * Each Review widget's filter, by tab id: the last its field read (a text
   * that doesn't read is never put here). Temporary as the picks: never
   * saved, gone with a reload. Absent = nothing to review.
   */
  reviewFilters: Readonly<Record<string, ReviewFilter>>
  /** Collapsed section keys by tab id. */
  collapsed: Readonly<Record<string, readonly string[]>>
  /**
   * Each list tab's tasks as shown, by tab id, while its widget is on
   * screen (written by the widget, removed when it goes). Never saved.
   */
  shown: Readonly<Record<string, ShownList>>
  /**
   * The zoom level each list tab on screen shows, by tab id (written by the
   * widget, removed when it goes) — its own pick, else the Default list
   * zoom, Auto resolved by the list's width. The zoom controls step from it
   * (`services/list-zoom.listTabZoom`). Never saved.
   */
  zoom: Readonly<Record<string, ListZoom>>

  /** Sets a tab's prompt picks; an empty list clears them. */
  setPicks: (tabId: string, ids: readonly number[]) => void
  /** Sets a Review widget's filter; `null` clears it. */
  setReviewFilter: (tabId: string, filter: ReviewFilter | null) => void
  toggleGroup: (tabId: string, sectionKey: string) => void
  /** Collapses exactly `sectionKeys` of a tab (Collapse all groups); an empty list expands them all. */
  setCollapsed: (tabId: string, sectionKeys: readonly string[]) => void
  /** Sets (or with `null`, removes) a tab's shown tasks. */
  setShown: (tabId: string, shown: ShownList | null) => void
  /** Sets (or with `null`, removes) the level a tab shows. */
  setShownZoom: (tabId: string, zoom: ListZoom | null) => void
}

function addTabIds(layout: WorkspaceLayout | null, into: Set<string>): void {
  if (layout) for (const tab of layoutTabs(layout)) into.add(tab.id)
}

/**
 * `byTab` without the tabs that are in no layout any more (not in the
 * working copy, not in a saved layout) — so closed tabs don't pile up over a
 * session. Before the workspace is open nothing is dropped.
 */
function withoutGoneTabs<T>(byTab: Readonly<Record<string, T>>): Record<string, T> {
  const { working, layouts } = useWorkspaceStore.getState()
  if (!working) return { ...byTab }
  const live = new Set<string>()
  addTabIds(working, live)
  for (const layout of layouts) addTabIds(layout, live)
  return Object.fromEntries(Object.entries(byTab).filter(([tabId]) => live.has(tabId)))
}

export const useListWidgetStore = create<ListWidgetState>((set, get) => ({
  picks: {},
  reviewFilters: {},
  collapsed: {},
  shown: {},
  zoom: {},

  setPicks(tabId, ids) {
    const next = withoutGoneTabs(get().picks)
    if (ids.length > 0) next[tabId] = [...ids]
    else delete next[tabId]
    set({ picks: next })
  },

  setReviewFilter(tabId, filter) {
    const current = get().reviewFilters
    if (current[tabId] === (filter ?? undefined)) return
    const next = withoutGoneTabs(current)
    if (filter) next[tabId] = filter
    else delete next[tabId]
    set({ reviewFilters: next })
  },

  toggleGroup(tabId, sectionKey) {
    const current = get().collapsed[tabId] ?? []
    const keys = current.includes(sectionKey)
      ? current.filter((k) => k !== sectionKey)
      : [...current, sectionKey]
    get().setCollapsed(tabId, keys)
  },

  setCollapsed(tabId, sectionKeys) {
    const next = withoutGoneTabs(get().collapsed)
    if (sectionKeys.length > 0) next[tabId] = [...sectionKeys]
    else delete next[tabId]
    set({ collapsed: next })
  },

  setShown(tabId, shown) {
    const current = get().shown
    if (current[tabId] === shown || (shown === null && !(tabId in current))) return
    const next = { ...current }
    if (shown) next[tabId] = shown
    else delete next[tabId]
    set({ shown: next })
  },

  setShownZoom(tabId, zoom) {
    const current = get().zoom
    if (current[tabId] === (zoom ?? undefined)) return
    const next = { ...current }
    if (zoom) next[tabId] = zoom
    else delete next[tabId]
    set({ zoom: next })
  },
}))
