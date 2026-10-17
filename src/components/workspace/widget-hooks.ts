import { widgetKindLabel, type LayoutTab, type WidgetKind } from '../../models/workspace-layout'
import { useListDefinitionStore } from '../../stores/list-definition-store'
import { useUIStore } from '../../stores/ui-store'
import { useWorkspaceStore } from '../../stores/workspace-store'
import type { LayoutDropTarget } from '../../utils/workspace-layout-ops'

/**
 * A tab's title: a list tab shows its list's name (`listName`, looked up by
 * the caller; `(Deleted list)` when its list is gone), other tabs their
 * kind's name.
 */
export function tabTitle(tab: LayoutTab, listName: string | undefined): string {
  if (tab.kind === 'lens') return tab.config.listDefinitionId == null ? widgetKindLabel('lens') : (listName ?? '(Deleted list)')
  return widgetKindLabel(tab.kind)
}

/** A tab's title (`tabTitle`), kept current. */
export function useTabTitle(tab: LayoutTab | undefined): string {
  const listName = useListDefinitionStore((s) =>
    tab?.kind === 'lens' && tab.config.listDefinitionId != null
      ? s.listDefinitions.find((d) => d.id === tab.config.listDefinitionId)?.name
      : undefined,
  )
  return tab ? tabTitle(tab, listName) : ''
}

/** A list name not used by any saved list: "New list", "New list 2", … */
function freshListName(): string {
  const taken = new Set(useListDefinitionStore.getState().listDefinitions.map((d) => d.name.toLowerCase()))
  let name = 'New list'
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New list ${n}`
  return name
}

/**
 * "Create new list…" in a list picker: saves a blank list, hands its id to
 * `show` (which puts it in a tab), then opens that list's own editor.
 */
export function createListThenEdit(show: (listDefinitionId: number) => void): void {
  void useListDefinitionStore.getState().add({ name: freshListName() }).then((id) => {
    show(id)
    useUIStore.getState().openListEditorDialog(id)
  })
}

/** Adds a widget tab of `kind` at `target` (a list tab with its list). Returns the new tab's id. */
export function useAddWidget() {
  const addWidget = useWorkspaceStore((s) => s.addWidget)
  return (kind: WidgetKind, target: LayoutDropTarget, listDefinitionId?: number) =>
    addWidget(kind, target, listDefinitionId != null ? { listDefinitionId } : undefined)
}
