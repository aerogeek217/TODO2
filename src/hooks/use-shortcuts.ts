import { useMemo } from 'react'
import type { PersistedTodoItem } from '../models'
import type { IconValue } from '../models/icon'
import { shortcutListTabId, tabStripIcon, type ListTab } from '../models/workspace-layout'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useActiveScreenFilter } from '../stores/screen-filter'
import { useSettingsStore } from '../stores/settings-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { rowTone } from '../utils/list-zoom'
import { buildWallList, wallTone, type WallList } from '../utils/list-wall'
import { markerSummary } from '../utils/markers'
import {
  layoutListTabs,
  SHORTCUT_PEEK_MAX_LINES,
  shortcutChoices,
  shortcutLayoutName,
  shortcutListIcon,
  tabIsShowing,
  type ShortcutChoiceGroup,
} from '../utils/shortcuts'
import { useBuiltList } from './use-built-list'
import { useHeldLists } from './use-held-lists'
import { useEffectiveListDefinition } from './use-list-draft'
import { useTabBadges, type TabBadge } from './use-tab-badges'
import { useToday } from './use-today'

/**
 * One list a List board shows: a list picked (`listId`, drawn under its
 * popup's tab id) or a list tab of the open layout (`tab`, drawn under its
 * own id, with its own prompt pick).
 */
export interface BoardEntry {
  /** Unique on the board: the list id picked, else the tab's id. */
  key: string
  listId: number
  /** The open layout's list tab it shows (This layout's lists). */
  tab?: ListTab
}

/** The tab id a board entry's list is built under: its own tab's, else its popup's. */
const boardEntryTabId = (entry: BoardEntry): string => entry.tab?.id ?? shortcutListTabId(entry.listId)

/** What a List board tile shows of one list. */
export interface ShortcutTileData {
  /** The list's name as shown (Edit list's draft while open). */
  name: string
  /** Its layout's name (the open one's as edited). */
  layoutName: string
  /** Its list tab's icon; none when no tab shows it or it was given No icon. */
  icon: IconValue | undefined
  /** The tasks it shows (each once); null while its prompt waits for a pick. */
  count: number | null
  /** The first task titles as built (up to `SHORTCUT_PEEK_MAX_LINES`). */
  titles: string[]
  /** Its tab badge (the list's own ranges); none with nothing to count or while its prompt waits. */
  badge: TabBadge | undefined
  /** A square per open task it shows, the trouble first, with a count per state (`utils/list-wall`). */
  wall: WallList<PersistedTodoItem>
}

/**
 * The lists a List board of picked lists shows, in its order: the ids in
 * `ids` whose list still exists (a deleted one is skipped, its id kept in
 * the config).
 */
export function useShortcutListIds(ids: readonly number[]): number[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  return useMemo(() => {
    const known = new Set(defs.map((d) => d.id))
    return ids.filter((id) => known.has(id))
  }, [ids, defs])
}

/** The list tabs a List board of the layout's lists shows: the open layout's (as edited), in reading order (`layoutListTabs`). */
export function useLayoutListTabs(): ListTab[] {
  const working = useWorkspaceStore((s) => s.working)
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  return useMemo(() => {
    if (!working) return []
    const known = new Set(defs.map((d) => d.id))
    return layoutListTabs(working, (id) => known.has(id))
  }, [working, defs])
}

/**
 * One tile's list as it shows on opening (`useBuiltList`): the list as
 * edited, its prompt pick (its own tab's, else the one made in its popup,
 * `shortcutListTabId`) and the screen filter — its count, its first task
 * titles, its tab badge, and a square per open task with its state (a Lines
 * box's, `rowTone`) and priority; and its layout's name and its tab's icon
 * (the tab's own for a tab of the layout). Undefined for a deleted list.
 */
export function useShortcutTile(entry: BoardEntry): ShortcutTileData | undefined {
  const { listId, tab } = entry
  const tabId = boardEntryTabId(entry)
  const definition = useEffectiveListDefinition(listId)
  const picks = useListWidgetStore((s) => s.picks[tabId])
  const screen = useActiveScreenFilter()
  const built = useBuiltList(definition, picks, screen)
  const listTab = useMemo<ListTab[]>(() => [tab ?? { id: tabId, kind: 'lens', config: { listDefinitionId: listId } }], [tab, tabId, listId])
  const badge = useTabBadges(listTab).get(tabId)
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const urgentRange = useSettingsStore((s) => s.urgentDueWithinDays)
  const staleAfterDays = useSettingsStore((s) => s.staleAfterDays)
  const today = useToday()
  const list = built.list
  const pending = built.runtimeFilterPending
  // Its tasks as built: in its sections' order, each once.
  const shown = useMemo(() => {
    const out: PersistedTodoItem[] = []
    const seen = new Set<number>()
    for (const section of list?.sections ?? []) {
      for (const t of section.todos) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push(t)
      }
    }
    return out
  }, [list])
  const titles = useMemo(() => shown.slice(0, SHORTCUT_PEEK_MAX_LINES).map((t) => t.title), [shown])
  const name = definition?.name ?? ''
  const wall = useMemo(() => buildWallList(
    { tabId, name, showing: working ? tabIsShowing(working, tabId) : false, waiting: pending },
    pending ? [] : shown.filter((t) => !t.isCompleted),
    (t) => wallTone(rowTone(t, today, { urgentRange, staleAfterDays })),
    (t) => markerSummary(t, today, urgentRange),
  ), [tabId, name, working, pending, shown, today, urgentRange, staleAfterDays])
  const owner = definition?.owner
  const id = definition?.id
  const layoutName = useMemo(() => (owner !== undefined ? shortcutLayoutName({ owner }, layouts, working) : ''), [owner, layouts, working])
  const icon = useMemo(() => {
    if (tab) {
      const own = tabStripIcon(tab)
      return own.kind === 'none' ? undefined : own
    }
    return id != null && owner !== undefined ? shortcutListIcon({ id, owner }, layouts, working) : undefined
  }, [tab, id, owner, layouts, working])
  if (!definition) return undefined
  return {
    name,
    layoutName,
    icon,
    count: pending ? null : (list?.todos.length ?? 0),
    titles: pending ? [] : titles,
    badge: pending ? undefined : badge,
    wall,
  }
}

/** What **Add a list ›** offers a List board showing `added` (`utils/shortcuts.shortcutChoices`). */
export function useShortcutChoices(added: readonly number[]): ShortcutChoiceGroup[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const held = useHeldLists()
  return useMemo(() => shortcutChoices(defs, layouts, working, added, held), [defs, layouts, working, added, held])
}
