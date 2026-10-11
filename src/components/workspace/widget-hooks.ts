import type { LayoutTab, WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import { KIND_LABEL } from '../../utils/slot-kind'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'

/** Widget kinds offered for a new widget, in menu order. */
export const ADDABLE_KINDS: readonly WidgetKind[] = ['lens', 'calendar', 'notes', 'taskboard', 'status']

export function kindLabel(kind: WidgetKind): string {
  return KIND_LABEL[kind]
}

/** A tab's title: a list tab shows its list's name. */
export function useTabTitle(tab: LayoutTab | undefined): string {
  const listName = useListDefinitionStore((s) =>
    tab?.kind === 'lens' && tab.config.listDefinitionId != null
      ? s.listDefinitions.find((d) => d.id === tab.config.listDefinitionId)?.name
      : undefined,
  )
  if (!tab) return ''
  if (tab.kind === 'lens') return tab.config.listDefinitionId == null ? 'List' : (listName ?? '(Deleted list)')
  return kindLabel(tab.kind)
}

/** Adds a widget tab of `kind` at `target` (a list tab with its list). Returns the new tab's id. */
export function useAddWidget() {
  const addWidget = useWorkspaceStore((s) => s.addWidget)
  return (kind: WidgetKind, target: LayoutDropTarget, listDefinitionId?: number) =>
    addWidget(kind, target, listDefinitionId != null ? { listDefinitionId } : undefined)
}
