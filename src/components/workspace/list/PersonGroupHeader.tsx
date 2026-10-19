import type { ReactNode } from 'react'
import { useTooltip } from '../../shared/use-tooltip'
import { EnvelopeIcon } from '../../shared/icons'
import { emailPersonCheckin, type GroupPerson } from './person-group'
import styles from './ListWidget.module.css'

/**
 * A People group's header (`children`, the collapse button) plus an envelope
 * button at its end, shown on hover or keyboard focus, that opens the email
 * check-in for the person. Right-click, the context-menu key or Shift+F10 on
 * either opens the group's menu (`onOpenMenu`, at the pointer or under the
 * header).
 */
export function PersonGroupHeader({ person, showAction, onOpenMenu, children }: {
  person: GroupPerson
  /** False while a row is dragged (the header shows the drop preview then). */
  showAction: boolean
  onOpenMenu: (at: { x: number; y: number }) => void
  children: ReactNode
}) {
  return (
    <div
      className={styles.groupHeaderRow}
      data-person-group={person.id}
      onContextMenu={(e) => {
        e.preventDefault()
        onOpenMenu({ x: e.clientX, y: e.clientY })
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
        e.preventDefault()
        e.stopPropagation()
        const r = e.currentTarget.getBoundingClientRect()
        onOpenMenu({ x: r.left, y: r.bottom + 4 })
      }}
    >
      {children}
      {showAction && <CheckinButton person={person} />}
    </div>
  )
}

function CheckinButton({ person }: { person: GroupPerson }) {
  const { triggerProps, tooltip } = useTooltip('Email check-in')
  return (
    <>
      <button
        type="button"
        className={styles.groupAction}
        aria-label={`Email check-in to ${person.name}`}
        onClick={() => emailPersonCheckin(person)}
        {...triggerProps}
      >
        <EnvelopeIcon />
      </button>
      {tooltip}
    </>
  )
}
