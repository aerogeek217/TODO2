import type { ReactNode } from 'react'
import { MenuPopover } from '../../shared/MenuPopover'
import { useEntityMenuOffers } from '../../shared/person-menu-entries'
import type { Section } from '../../../services/list-sections'
import { listGroupMenu, type GroupPerson } from './person-group'
import styles from './ListWidget.module.css'

/**
 * A list group's header (`children`, the collapse button). Right-click, the
 * context-menu key or Shift+F10 on it opens the group's menu (`onOpenMenu`,
 * at the pointer or under the header).
 */
export function ListGroupHeader({ person, onOpenMenu, children }: {
  /** The People group's person; null for every other group. */
  person: GroupPerson | null
  onOpenMenu: (at: { x: number; y: number }) => void
  children: ReactNode
}) {
  return (
    <div
      className={styles.groupHeaderRow}
      data-person-group={person?.id}
      // A menu portaled out of the header still bubbles its events here through React: only the header's own DOM opens the group menu.
      onContextMenu={(e) => {
        if (!(e.target instanceof Node && e.currentTarget.contains(e.target))) return
        e.preventDefault()
        onOpenMenu({ x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => {
        if (!(e.target instanceof Node && e.currentTarget.contains(e.target))) return
        if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onOpenMenu({ x: r.left, y: r.bottom + 4 })
      }}
    >
      {children}
    </div>
  )
}

/**
 * A list group header's menu at `at` (`listGroupMenu`): a People group's
 * person menu, then Copy N tasks — what it offers read where it renders.
 */
export function ListGroupMenu({ section, person, at, onClose }: {
  section: Section
  person: GroupPerson | null
  at: { x: number; y: number }
  onClose: () => void
}) {
  const offers = useEntityMenuOffers()
  return (
    <MenuPopover
      point={at}
      label={`${section.label} group`}
      width={person ? 240 : undefined}
      closeOnScroll
      restoreFocus
      entries={listGroupMenu(section, person, offers)}
      onClose={onClose}
    />
  )
}
