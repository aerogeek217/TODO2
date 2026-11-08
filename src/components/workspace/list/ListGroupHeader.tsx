import { useRef, useState, type ReactNode } from 'react'
import { useTooltip } from '../../shared/use-tooltip'
import { EnvelopeIcon } from '../../shared/icons'
import { MenuPopover } from '../../shared/MenuPopover'
import { useEntityMenuOffers } from '../../shared/person-menu-entries'
import { PersonCheckinMenu } from '../../shared/PersonCheckinMenu'
import type { Section } from '../../../services/list-sections'
import { listGroupMenu, type GroupPerson } from './person-group'
import styles from './ListWidget.module.css'

/**
 * A list group's header (`children`, the collapse button). Right-click, the
 * context-menu key or Shift+F10 on it opens the group's menu (`onOpenMenu`,
 * at the pointer or under the header). A People group's header also has an
 * envelope button at its end, shown on hover or keyboard focus (and while
 * its menu is open), that opens the person's check-in menu: send a check-in,
 * or paste their reply (`PersonCheckinMenu`).
 */
export function ListGroupHeader({ person, showAction, onOpenMenu, children }: {
  /** The People group's person; null for every other group. */
  person: GroupPerson | null
  /** False while a row is dragged (the header shows the drop preview then). */
  showAction: boolean
  onOpenMenu: (at: { x: number; y: number }) => void
  children: ReactNode
}) {
  return (
    <div
      className={styles.groupHeaderRow}
      data-person-group={person?.id}
      // The check-in menu is portaled out of the header but its events bubble
      // here through React: only the header's own DOM opens the group menu.
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
      {person && showAction && <CheckinButton person={person} />}
    </div>
  )
}

function CheckinButton({ person }: { person: GroupPerson }) {
  const { triggerProps, tooltip } = useTooltip('Email check-in')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={styles.groupAction}
        aria-label={`Email check-in options for ${person.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        {...triggerProps}
      >
        <EnvelopeIcon />
      </button>
      {tooltip}
      {open && <PersonCheckinMenu person={person} anchorRef={ref} placement="bottom-end" onClose={() => setOpen(false)} />}
    </>
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
