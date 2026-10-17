import type { Person, Tag } from '../../models'
import { personTaskDialog, tagTaskDialog } from '../../services/task-dialog'
import { useUIStore } from '../../stores/ui-store'
import { AtIcon, HashIcon, PencilIcon, TrashIcon } from '../shared/icons'
import type { MenuEntry } from '../shared/MenuPopover'

/** A person or a tag shown on a task row. */
export type RowEntity = { kind: 'person'; entity: Person } | { kind: 'tag'; entity: Tag }

/** `@Alice` / `#work`. */
export function rowEntityName(e: RowEntity): string {
  return e.kind === 'person' ? `@${e.entity.name}` : `#${e.entity.name}`
}

/**
 * What a right-click on a row's avatar or tag offers: Show tasks (the task
 * dialog of that person's / tag's open tasks) · Edit… (its editor, opened on
 * it) · Delete… (the confirm with its task count; undoable).
 */
export function rowEntityActions(e: RowEntity): MenuEntry[] {
  const ui = useUIStore.getState()
  const id = e.entity.id
  if (id == null) return []
  return [
    {
      kind: 'item',
      label: 'Show tasks',
      icon: e.kind === 'person' ? <AtIcon /> : <HashIcon />,
      onSelect: () => ui.showTaskDialog(e.kind === 'person' ? personTaskDialog(e.entity) : tagTaskDialog(e.entity)),
    },
    { kind: 'item', label: 'Edit…', icon: <PencilIcon />, onSelect: () => ui.openEntityAction({ kind: e.kind, id, action: 'edit' }) },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete…', icon: <TrashIcon />, danger: true, onSelect: () => ui.openEntityAction({ kind: e.kind, id, action: 'delete' }) },
  ]
}

/**
 * The menu for one entity (headed by its name), or — for a whole cell,
 * opened from the keyboard — one submenu per entity.
 */
export function rowEntityMenu(entities: readonly RowEntity[]): MenuEntry[] {
  const only = entities.length === 1 ? entities[0] : undefined
  if (only) return [{ kind: 'label', text: rowEntityName(only) }, ...rowEntityActions(only)]
  return entities.map((e): MenuEntry => ({
    kind: 'item',
    label: rowEntityName(e),
    icon: e.kind === 'person' ? <AtIcon /> : <HashIcon />,
    children: rowEntityActions(e),
    childrenWidth: 180,
  }))
}
