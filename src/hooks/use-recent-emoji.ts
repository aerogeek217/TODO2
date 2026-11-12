import { useMemo } from 'react'
import { recentEmoji, type IconValue } from '../models/icon'
import type { WorkspaceLayout } from '../models/workspace-layout'
import { useWorkspaceStore } from '../stores/workspace-store'

/**
 * Every icon the layouts hold, the open layout's working copy first (its
 * tabs in strip order), then the other layouts' tabs. Phase 3B adds the
 * layouts' own icons and the statuses' here.
 */
export function layoutIcons(layouts: readonly WorkspaceLayout[], working: WorkspaceLayout | null): IconValue[] {
  const ordered = working ? [working, ...layouts.filter((l) => l.id !== working.id)] : layouts
  return ordered.flatMap((l) => l.cells.flatMap((c) => c.tabs.flatMap((t) => (t.icon ? [t.icon] : []))))
}

/**
 * The emoji already used in the app's data (J6): the icon picker's Recent,
 * each once. It starts empty — nothing is bundled (decision 16).
 */
export function useRecentEmoji(): string[] {
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  return useMemo(() => recentEmoji(layoutIcons(layouts, working)), [layouts, working])
}
