import { useEffect, type RefObject } from 'react'
import { usePersonStore } from '../../stores/person-store'
import { useTagStore } from '../../stores/tag-store'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { AtIcon, HashIcon } from './icons'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import { entityMenuEntries, entityName, useEntityMenuOffers, type EntityMenuOptions, type MenuEntity } from './person-menu-entries'

export type { MenuEntity } from './person-menu-entries'

interface EntityMenuProps {
  /** One entity (the menu is headed by its name), or a whole cell's (one submenu each). */
  entities: readonly MenuEntity[]
  anchorRef?: RefObject<HTMLElement | null>
  point?: { x: number; y: number }
  closeOnScroll?: boolean
  /** See `MenuPopover.restoreFocus` (a picker's search field keeps the focus). */
  restoreFocus?: boolean
  /** Runs before Show tasks, Review or a check-in item acts. */
  onShowTasks?: () => void
  onClose: () => void
}

/**
 * The person / tag menu — a task row's avatar or tag, a people / tag picker's
 * option (`entityMenuEntries`) for one entity, or (a row's cell from the
 * keyboard) one submenu per entity. Inside a dialog the task dialog and the
 * deck can't show above (any tier but the workspace's overlays), Show
 * tasks, Review and the check-ins aren't offered; Review isn't either on a
 * phone or inside the review deck (`useEntityMenuOffers`).
 */
export function EntityMenu({ entities, anchorRef, point, closeOnScroll, restoreFocus, onShowTasks, onClose }: EntityMenuProps) {
  const options: EntityMenuOptions = { ...useEntityMenuOffers(), onShowTasks }
  const only = entities.length === 1 ? entities[0] : undefined
  // A person's check-in items name them in full: room for that.
  const wide = options.checkins && entities.some((e) => e.kind === 'person')
  const width = wide ? 240 : 180
  const entries: MenuEntry[] = only
    ? [{ kind: 'label', text: entityName(only) }, ...entityMenuEntries(only, options)]
    : entities.map((e): MenuEntry => ({
        kind: 'item',
        label: entityName(e),
        icon: e.kind === 'person' ? <AtIcon /> : <HashIcon />,
        children: entityMenuEntries(e, options),
        childrenWidth: width,
      }))
  return (
    <MenuPopover
      anchorRef={anchorRef}
      point={point}
      width={only ? width : 200}
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
