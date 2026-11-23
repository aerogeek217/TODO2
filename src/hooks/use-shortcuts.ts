import { useMemo } from 'react'
import type { IconValue } from '../models/icon'
import { shortcutListTabId, type ListTab } from '../models/workspace-layout'
import { useListDefinitionStore } from '../stores/list-definition-store'
import { useListWidgetStore } from '../stores/list-widget-store'
import { useActiveScreenFilter } from '../stores/screen-filter'
import { useWorkspaceStore } from '../stores/workspace-store'
import { SHORTCUT_PEEK_MAX_LINES, shortcutChoices, shortcutLayoutName, shortcutListIcon, type ShortcutChoiceGroup } from '../utils/shortcuts'
import { useBuiltList } from './use-built-list'
import { useHeldLists } from './use-held-lists'
import { useEffectiveListDefinition } from './use-list-draft'
import { useTabBadges, type TabBadge } from './use-tab-badges'

/** What a Shortcuts tile shows of one list. */
export interface ShortcutTileData {
  /** The list's name as shown (Edit list's draft while open). */
  name: string
  /** Its layout's name (the open one's as edited). */
  layoutName: string
  /** Its list tab's picked icon; none when no tab shows it or none was picked. */
  icon: IconValue | undefined
  /** The tasks it shows (each once); null while its prompt waits for a pick. */
  count: number | null
  /** The first task titles as built (up to `SHORTCUT_PEEK_MAX_LINES`). */
  titles: string[]
  /** Its tab badge (the list's own ranges); none with nothing to count or while its prompt waits. */
  badge: TabBadge | undefined
}

/**
 * The lists Shortcuts shows, in its order: the ids in `ids` whose list
 * still exists (a deleted one is skipped, its id kept in the config).
 */
export function useShortcutListIds(ids: readonly number[]): number[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  return useMemo(() => {
    const known = new Set(defs.map((d) => d.id))
    return ids.filter((id) => known.has(id))
  }, [ids, defs])
}

/**
 * One tile's list as it shows on opening (`useBuiltList`): the list as
 * edited, the prompt pick made in its popup (`shortcutListTabId`) and the
 * screen filter — its count, its first task titles and its tab badge; and
 * its layout's name and its tab's icon. Undefined for a deleted list.
 */
export function useShortcutTile(listId: number): ShortcutTileData | undefined {
  const tabId = shortcutListTabId(listId)
  const definition = useEffectiveListDefinition(listId)
  const picks = useListWidgetStore((s) => s.picks[tabId])
  const screen = useActiveScreenFilter()
  const built = useBuiltList(definition, picks, screen)
  const listTab = useMemo<ListTab[]>(() => [{ id: tabId, kind: 'lens', config: { listDefinitionId: listId } }], [tabId, listId])
  const badge = useTabBadges(listTab).get(tabId)
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const list = built.list
  const titles = useMemo(() => {
    const out: string[] = []
    const seen = new Set<number>()
    for (const section of list?.sections ?? []) {
      for (const t of section.todos) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push(t.title)
        if (out.length >= SHORTCUT_PEEK_MAX_LINES) return out
      }
    }
    return out
  }, [list])
  const owner = definition?.owner
  const id = definition?.id
  const layoutName = useMemo(() => (owner !== undefined ? shortcutLayoutName({ owner }, layouts, working) : ''), [owner, layouts, working])
  const icon = useMemo(() => (id != null && owner !== undefined ? shortcutListIcon({ id, owner }, layouts, working) : undefined), [id, owner, layouts, working])
  if (!definition) return undefined
  const pending = built.runtimeFilterPending
  return {
    name: definition.name,
    layoutName,
    icon,
    count: pending ? null : (list?.todos.length ?? 0),
    titles: pending ? [] : titles,
    badge: pending ? undefined : badge,
  }
}

/** What **Add a list ›** offers a Shortcuts widget showing `added` (`utils/shortcuts.shortcutChoices`). */
export function useShortcutChoices(added: readonly number[]): ShortcutChoiceGroup[] {
  const defs = useListDefinitionStore((s) => s.listDefinitions)
  const layouts = useWorkspaceStore((s) => s.layouts)
  const working = useWorkspaceStore((s) => s.working)
  const held = useHeldLists()
  return useMemo(() => shortcutChoices(defs, layouts, working, added, held), [defs, layouts, working, added, held])
}
