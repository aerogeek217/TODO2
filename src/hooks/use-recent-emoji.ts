import { useMemo } from 'react'
import { recentEmoji, statusIconValue, type DrawnIcon } from '../models/icon'
import type { StatusLook } from '../models/status'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { useStatusStore } from '../stores/status-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { bySortOrder } from '../utils/sort-order'

/**
 * Every icon the layouts hold, the open layout's working copy first, then
 * the other layouts in their order: each layout's own icon, then its tabs'
 * (in strip order).
 */
export function layoutIcons(layouts: readonly WorkspaceLayout[], working: WorkspaceLayout | null): DrawnIcon[] {
  const ordered = working ? [working, ...layouts.filter((l) => l.id !== working.id)] : layouts
  return ordered.flatMap((l) => [
    ...(l.icon ? [l.icon] : []),
    ...l.cells.flatMap((c) => c.tabs.flatMap((t) => (t.icon ? [t.icon] : []))),
  ])
}

/** The statuses' emoji, as icons, in the order given (J17; Settings' order from the hook). */
export function statusIcons(statuses: readonly StatusLook[]): DrawnIcon[] {
  return statuses.flatMap((s) => (s.emoji ? [statusIconValue(s)] : []))
}

/**
 * The emoji already used in the app's data (J6): the icon picker's Recent,
 * each once — the layouts' and their tabs' (the open layout first), then
 * the statuses'. It starts empty — nothing is bundled (decision 16).
 */
export function useRecentEmoji(): string[] {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const statuses = useStatusStore((s) => s.statuses)
  return useMemo(() => recentEmoji([...layoutIcons(layouts, working), ...statusIcons([...statuses].sort(bySortOrder))]), [layouts, working, statuses])
}
