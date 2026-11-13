import { create } from 'zustand'
import type { FilterExpr } from '../models'
import type { ListZoom, WorkspaceLayout } from '../models/workspace-layout'
import { REVIEW_POPUP_TAB_ID } from '../models/review'
import { keepReviewSessions } from './review-session'
import { useWorkspaceStore } from './workspace-store'
import { normalizeExpression, printExpression } from '../utils/filter-expression'
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

/** Names by id: a filter's text that doesn't change when a person, tag or status is renamed. */
const ID_NAMES = { person: (id: number) => `p${id}`, tag: (id: number) => `t${id}`, status: (id: number) => `s${id}` }

/**
 * Which review a filter is (null: none): two filters with the same key are
 * the same review — the place and the marks last as long as it
 * (`review-session`'s `filterKey`). The filter as it prints, its names by
 * id, so the same filter sent again, or re-printed by the field (`today`
 * for a 0-day offset), is still the same review.
 */
export function reviewFilterKey(filter: ReviewFilter | null | undefined): string | null {
  if (!filter) return null
  return printExpression(normalizeExpression(filter.expression), filter.showCompleted, ID_NAMES)
}

/**
 * State of workspace list widgets that is never saved: per-tab prompt picks
 * and collapsed groups (keyed by layout tab id, so they follow a tab that is
 * moved to another cell). A Review widget's filter is kept here too (widget
 * feedback 2A), under its own tab id.
 *
 * Every record by tab id has no prototype (`byTab`), so a tab id such as
 * `constructor` reads as absent wherever it is read (a stored id is any
 * string).
 */
interface ListWidgetData {
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
}

interface ListWidgetActions {
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
  /**
   * A data replace: what is keyed by ids the replaced data may reuse for
   * other tabs, lists, people or tags goes (`CLEARED_ON_REPLACE`).
   */
  resetForReplacedData: () => void
}

type ListWidgetState = ListWidgetData & ListWidgetActions

/**
 * Each field on a data replace: `true` — cleared (prompt picks, a Review
 * widget's filter and collapsed groups name tabs, people, tags and statuses
 * by id, and the replaced data may reuse an id for another); `false` — kept
 * (what the widgets on screen wrote about themselves: they write it again
 * as they draw the new data). A new field has to say which it is.
 */
export const CLEARED_ON_REPLACE: Readonly<Record<keyof ListWidgetData, boolean>> = {
  picks: true,
  reviewFilters: true,
  collapsed: true,
  shown: false,
  zoom: false,
}

/** A record by tab id with no prototype: only its own keys read as there (`constructor`, `__proto__` are plain keys). */
function byTab<T>(from?: Readonly<Record<string, T>>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, from)
}

/** `record[tabId]` when the record itself holds it (a record set from outside the store may have a prototype). */
function own<T>(record: Readonly<Record<string, T>>, tabId: string): T | undefined {
  return Object.hasOwn(record, tabId) ? record[tabId] : undefined
}

function addTabIds(layout: WorkspaceLayout | null, into: Set<string>): void {
  if (layout) for (const tab of layoutTabs(layout)) into.add(tab.id)
}

/**
 * The tabs that are in a layout (the working copy, or a saved one), with
 * the popup review (`REVIEW_POPUP_TAB_ID`, in no layout); null before the
 * workspace is open.
 */
function liveTabIds(): Set<string> | null {
  const { working, layouts } = useWorkspaceStore.getState()
  if (!working) return null
  const live = new Set<string>([REVIEW_POPUP_TAB_ID])
  addTabIds(working, live)
  for (const layout of layouts) addTabIds(layout, live)
  return live
}

/**
 * `record` without the tabs that are in no layout any more — so closed tabs
 * don't pile up over a session. Before the workspace is open nothing is
 * dropped; the popup review never is.
 */
function withoutGoneTabs<T>(record: Readonly<Record<string, T>>, live = liveTabIds()): Record<string, T> {
  const next = byTab<T>()
  for (const [tabId, value] of Object.entries(record)) if (!live || live.has(tabId)) next[tabId] = value
  return next
}

export const useListWidgetStore = create<ListWidgetState>((set, get) => ({
  picks: byTab(),
  reviewFilters: byTab(),
  collapsed: byTab(),
  shown: byTab(),
  zoom: byTab(),

  setPicks(tabId, ids) {
    const next = withoutGoneTabs(get().picks)
    if (ids.length > 0) next[tabId] = [...ids]
    else delete next[tabId]
    set({ picks: next })
  },

  setReviewFilter(tabId, filter) {
    const current = get().reviewFilters
    if (own(current, tabId) === (filter ?? undefined)) return
    const live = liveTabIds()
    const next = withoutGoneTabs(current, live)
    if (filter) next[tabId] = filter
    else delete next[tabId]
    // A closed tab's review goes with its filter.
    if (live) keepReviewSessions(live)
    set({ reviewFilters: next })
  },

  toggleGroup(tabId, sectionKey) {
    const current = own(get().collapsed, tabId) ?? []
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
    if (own(current, tabId) === (shown ?? undefined)) return
    const next = byTab(current)
    if (shown) next[tabId] = shown
    else delete next[tabId]
    set({ shown: next })
  },

  setShownZoom(tabId, zoom) {
    const current = get().zoom
    if (own(current, tabId) === (zoom ?? undefined)) return
    const next = byTab(current)
    if (zoom) next[tabId] = zoom
    else delete next[tabId]
    set({ zoom: next })
  },

  resetForReplacedData() {
    const cleared = Object.entries(CLEARED_ON_REPLACE).filter(([, clear]) => clear).map(([key]) => [key, byTab()])
    set(Object.fromEntries(cleared) as Partial<ListWidgetData>)
  },
}))
