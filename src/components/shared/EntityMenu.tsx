import { useEffect, type RefObject } from 'react'
import type { Person, Tag } from '../../models'
import { personTaskDialog, tagTaskDialog } from '../../services/task-dialog'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useUIStore } from '../../stores/ui-store'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { AtIcon, HashIcon, PencilIcon, TrashIcon } from './icons'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import { useDialogLayer } from './dialog-layer'

/** A person or a tag the menu is for. */
export type MenuEntity = { kind: 'person'; entity: Person } | { kind: 'tag'; entity: Tag }

/** `@Alice` / `#work`. */
function entityName(e: MenuEntity): string {
  return e.kind === 'person' ? `@${e.entity.name}` : `#${e.entity.name}`
}

interface ActionOptions {
  /** Offer Show tasks (the task dialog can show above where the menu opened). */
  showTasks: boolean
  /** Runs before Show tasks opens the task dialog (a picker closes itself). */
  onShowTasks?: () => void
}

/**
 * Show tasks (the task dialog of that person's / tag's open tasks) · Edit…
 * (its editor, opened on it) · Delete… (the confirm with its task count;
 * undoable). The editor and the confirm open above everything (`EntityActionHost`).
 */
function entityActions(e: MenuEntity, { showTasks, onShowTasks }: ActionOptions): MenuEntry[] {
  const ui = useUIStore.getState()
  const id = e.entity.id
  if (id == null) return []
  const show: MenuEntry[] = showTasks
    ? [{
        kind: 'item',
        label: 'Show tasks',
        icon: e.kind === 'person' ? <AtIcon /> : <HashIcon />,
        onSelect: () => {
          onShowTasks?.()
          ui.showTaskDialog(e.kind === 'person' ? personTaskDialog(e.entity) : tagTaskDialog(e.entity))
        },
      }]
    : []
  return [
    ...show,
    { kind: 'item', label: 'Edit…', icon: <PencilIcon />, onSelect: () => ui.openEntityAction({ kind: e.kind, id, action: 'edit' }) },
    { kind: 'separator' },
    { kind: 'item', label: 'Delete…', icon: <TrashIcon />, danger: true, onSelect: () => ui.openEntityAction({ kind: e.kind, id, action: 'delete' }) },
  ]
}

interface EntityMenuProps {
  /** One entity (the menu is headed by its name), or a whole cell's (one submenu each). */
  entities: readonly MenuEntity[]
  anchorRef?: RefObject<HTMLElement | null>
  point?: { x: number; y: number }
  closeOnScroll?: boolean
  /** See `MenuPopover.restoreFocus` (a picker's search field keeps the focus). */
  restoreFocus?: boolean
  /** Runs before Show tasks opens the task dialog. */
  onShowTasks?: () => void
  onClose: () => void
}

/**
 * The person / tag menu — a task row's avatar or tag, a people / tag picker's
 * option: Show tasks · Edit… · Delete… for one entity, or (a row's cell from
 * the keyboard) one submenu per entity. Inside a dialog the task dialog can't
 * show above (any tier but the workspace's overlays), Show tasks isn't offered.
 */
export function EntityMenu({ entities, anchorRef, point, closeOnScroll, restoreFocus, onShowTasks, onClose }: EntityMenuProps) {
  const layer = useDialogLayer()
  const options: ActionOptions = { showTasks: layer == null || layer === 'overlay', onShowTasks }
  const only = entities.length === 1 ? entities[0] : undefined
  const entries: MenuEntry[] = only
    ? [{ kind: 'label', text: entityName(only) }, ...entityActions(only, options)]
    : entities.map((e): MenuEntry => ({
        kind: 'item',
        label: entityName(e),
        icon: e.kind === 'person' ? <AtIcon /> : <HashIcon />,
        children: entityActions(e, options),
        childrenWidth: 180,
      }))
  return (
    <MenuPopover
      anchorRef={anchorRef}
      point={point}
      width={only ? 180 : 200}
      label={only ? entityName(only) : entities[0]?.kind === 'tag' ? 'Tags' : 'People'}
      entries={entries}
      closeOnScroll={closeOnScroll}
      restoreFocus={restoreFocus}
      onClose={onClose}
    />
  )
}

/** The person or tag with this id, kept current (`undefined` once it's gone). */
function useEntity(kind: 'person' | 'tag', id: number): MenuEntity | undefined {
  const person = usePersonStore((s) => (kind === 'person' ? s.people.find((p) => p.id === id) : undefined))
  const tag = useTagStore((s) => (kind === 'tag' ? s.tags.find((t) => t.id === id) : undefined))
  if (person) return { kind: 'person', entity: person }
  if (tag) return { kind: 'tag', entity: tag }
  return undefined
}

/**
 * A picker option's menu (`ChipSelector`, the filter pickers): the entity
 * menu at `point` for the person / tag with `id`, handing the focus back to
 * the picker's search field. Closes itself if the entity goes.
 */
export function PickerEntityMenu({ kind, id, point, onShowTasks, onClose }: {
  kind: 'person' | 'tag'
  id: number
  point: { x: number; y: number }
  onShowTasks?: () => void
  onClose: () => void
}) {
  const entity = useEntity(kind, id)
  const onCloseRef = useLatestRef(onClose)
  const gone = entity === undefined
  useEffect(() => {
    if (gone) onCloseRef.current()
  }, [gone, onCloseRef])
  if (!entity) return null
  return <EntityMenu entities={[entity]} point={point} closeOnScroll restoreFocus onShowTasks={onShowTasks} onClose={onClose} />
}
