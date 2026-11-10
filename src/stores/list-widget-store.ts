import { create } from 'zustand'
import type { WorkspaceLayout } from '../models/workspace-layout'
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
 * State of workspace list widgets that is never saved: per-tab prompt picks
 * and collapsed groups (keyed by layout tab id, so they follow a tab that is
 * moved to another cell).
 */
interface ListWidgetState {
  /**
   * Picks of a list's runtime prompt by tab id. Temporary by design: never
   * saved, so a reload starts with nothing picked. Absent = nothing picked.
   */
  picks: Readonly<Record<string, number[]>>
  /** Collapsed section keys by tab id. */
  collapsed: Readonly<Record<string, readonly string[]>>
  /**
   * Each list tab's tasks as shown, by tab id, while its widget is on
   * screen (written by the widget, removed when it goes). Never saved.
   */
  shown: Readonly<Record<string, ShownList>>

  /** Sets a tab's prompt picks; an empty list clears them. */
  setPicks: (tabId: string, ids: readonly number[]) => void
  toggleGroup: (tabId: string, sectionKey: string) => void
  /** Collapses exactly `sectionKeys` of a tab (Collapse all groups); an empty list expands them all. */
  setCollapsed: (tabId: string, sectionKeys: readonly string[]) => void
  /** Sets (or with `null`, removes) a tab's shown tasks. */
  setShown: (tabId: string, shown: ShownList | null) => void
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
  collapsed: {},
  shown: {},

  setPicks(tabId, ids) {
    const next = withoutGoneTabs(get().picks)
    if (ids.length > 0) next[tabId] = [...ids]
    else delete next[tabId]
    set({ picks: next })
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
}))
