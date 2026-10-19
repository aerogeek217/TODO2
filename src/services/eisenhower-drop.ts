import { usePersonStore } from '../stores/person-store'
import { currentFilterSettings } from '../stores/settings-store'
import { useStatusStore } from '../stores/status-store'
import { useTagStore } from '../stores/tag-store'
import { useTodoStore } from '../stores/todo-store'
import { useUndoStore } from '../stores/undo-store'
import { useWorkspaceStore } from '../stores/workspace-store'
import { dropDescription, type PaneChange, type PaneContext } from '../utils/eisenhower'
import { resolvePanes, type EisenhowerPane } from '../utils/eisenhower-panes'
import { registerModuleReset } from '../utils/module-reset'
import { getTab } from '../utils/workspace-layout-ops'

/**
 * Eisenhower pane drops against the stores: what the pane filters are
 * evaluated with at the drop, and the drop's writes as one undo step.
 */

/** The pane context as the stores have it now (`today` = midnight of the drop's day). */
export function currentPaneContext(today: Date): PaneContext {
  const { people, assignedPeopleMap } = usePersonStore.getState()
  const { tags, assignedTagsMap } = useTagStore.getState()
  return {
    today,
    settings: currentFilterSettings(),
    assignedPeopleMap,
    assignedTagsMap,
    people,
    tags,
    statuses: useStatusStore.getState().statuses,
  }
}

/**
 * The panes of the open layout's Eisenhower tab `tabId` as they are now —
 * what a drop on one of its panes is resolved with; `null` when there is no
 * such tab (the drop writes nothing).
 */
export function currentPanes(tabId: string): readonly EisenhowerPane[] | null {
  const working = useWorkspaceStore.getState().working
  const tab = working ? getTab(working, tabId) : undefined
  return tab?.kind === 'eisenhower' ? resolvePanes(tab.config.panes) : null
}

/** `ids` of the changes that set `key`, grouped by the value they set. */
function idsByValue(changes: readonly PaneChange[], key: 'statusId' | 'personId' | 'tagId'): Map<number, number[]> {
  const out = new Map<number, number[]>()
  for (const c of changes) {
    const v = c[key]
    if (v === undefined) continue
    const ids = out.get(v)
    if (ids) ids.push(c.todoId)
    else out.set(v, [c.todoId])
  }
  return out
}

/** The drops being written, in order: one at a time (an undo group is the undo store's one open group). */
let queue: Promise<void> = Promise.resolve()
registerModuleReset(() => { queue = Promise.resolve() })

/**
 * Writes a pane drop's changes (`resolvePaneDrop`) as one undo step with
 * the undo snackbar (`dropDescription`): the flags, then the status, then
 * the person / tag added. Drops are written one after another. Never
 * rejects: a write that fails takes back what the drop wrote before it
 * (`abortGroup`) and a notice says so.
 */
export function applyPaneDrop(changes: readonly PaneChange[]): Promise<void> {
  const run = queue.then(() => writePaneDrop(changes))
  // A drop that failed in an unforeseen way doesn't stop the ones after it.
  queue = run.catch((e: unknown) => { console.error('[eisenhower-drop] a drop could not be written', e) })
  return run
}

function failed(description: string, clean: boolean): string {
  return clean
    ? `Couldn’t save: ${description}. Nothing changed.`
    : `Couldn’t fully save: ${description}. Undo takes back what was saved.`
}

async function writePaneDrop(changes: readonly PaneChange[]): Promise<void> {
  if (changes.length === 0) return
  const todos = useTodoStore.getState().todos
  const description = dropDescription(changes, (id) => todos.find((t) => t.id === id)?.title, {
    people: usePersonStore.getState().people,
    tags: useTagStore.getState().tags,
    statuses: useStatusStore.getState().statuses,
  })
  const flags = changes.filter((c) => c.urgent !== undefined || c.important !== undefined || c.focus !== undefined)
  const statuses = idsByValue(changes, 'statusId')
  const people = idsByValue(changes, 'personId')
  const tags = idsByValue(changes, 'tagId')
  // Flags alone (the default panes): the flag write is the undo step itself.
  if (statuses.size === 0 && people.size === 0 && tags.size === 0) {
    try {
      await useTodoStore.getState().setMarkerFlags(flags, description)
    } catch {
      // The store took its write back (and logged it).
      useUndoStore.getState().notify(failed(description, true))
    }
    return
  }
  useUndoStore.getState().beginGroup()
  try {
    if (flags.length > 0) await useTodoStore.getState().setMarkerFlags(flags, description)
    for (const [statusId, ids] of statuses) await useTodoStore.getState().bulkSetStatus(ids, statusId)
    for (const [personId, ids] of people) await usePersonStore.getState().bulkAssignPerson(ids, personId)
    for (const [tagId, ids] of tags) await useTagStore.getState().bulkAssignTag(ids, tagId)
  } catch {
    // The failed write took itself back; the ones before it are taken back here.
    const clean = await useUndoStore.getState().abortGroup(description)
    useUndoStore.getState().notify(failed(description, clean))
    return
  }
  useUndoStore.getState().endGroup(description, true)
}
