import { create } from 'zustand'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { useWorkspaceStore } from './workspace-store'

/** Viewport point a popover hangs from, and which edge of it lines up. */
export interface PopoverPoint {
  x: number
  y: number
  align: 'start' | 'end'
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

  /** Sets a tab's prompt picks; an empty list clears them. */
  setPicks: (tabId: string, ids: readonly number[]) => void
  toggleGroup: (tabId: string, sectionKey: string) => void
}

function addTabIds(layout: WorkspaceLayout | null, into: Set<string>): void {
  for (const col of layout?.columns ?? []) for (const cell of col.cells) for (const tab of cell.tabs) into.add(tab.id)
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
    const next = withoutGoneTabs(get().collapsed)
    if (keys.length > 0) next[tabId] = keys
    else delete next[tabId]
    set({ collapsed: next })
  },
}))
