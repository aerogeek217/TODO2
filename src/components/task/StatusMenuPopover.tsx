import { useEffect, useMemo, type RefObject } from 'react'
import type { Status } from '../../models'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { StatusIcon } from '../shared/StatusIcon'
import { StatusMark } from '../shared/StatusMark'

/** The status menu's accessible name. */
const STATUS_MENU_LABEL = 'Status'

/**
 * The status menu (the task layout's Status fact: the editor and the review
 * card): No Status, then every status, as the app's menu (`MenuPopover`) —
 * radio items, the current one checked. Opening it moves the focus to the
 * current status; ↑ / ↓ / Home / End move, a letter jumps, Enter or a click
 * picks, Esc closes it alone, Tab closes it and moves on from its button —
 * each close handing the focus back to the button (`anchorRef`). A pick is
 * the caller's (`onPick`; `undefined`: No Status); the menu then closes.
 */
export function StatusMenuPopover({ anchorRef, statuses, statusId, onPick, onClose }: {
  anchorRef: RefObject<HTMLElement | null>
  statuses: readonly Status[]
  statusId: number | undefined
  onPick: (statusId: number | undefined) => void
  onClose: () => void
}) {
  const entries = useMemo<MenuEntry[]>(() => [
    {
      kind: 'item',
      label: 'No Status',
      icon: <StatusIcon icon="circle" />,
      radio: true,
      checked: !statusId,
      onSelect: () => onPick(undefined),
    },
    ...statuses.map((s): MenuEntry => ({
      kind: 'item',
      label: s.name,
      icon: <span style={{ display: 'inline-flex', color: s.color }}><StatusMark status={s} filled /></span>,
      radio: true,
      checked: statusId === s.id,
      onSelect: () => onPick(s.id),
    })),
  ], [statuses, statusId, onPick])

  // The menu opens with the focus on its first item (its own effect, which
  // runs before this one: a child's); the status menu starts on the current
  // status instead.
  useEffect(() => {
    document.querySelector<HTMLElement>(`[role="menu"][aria-label="${STATUS_MENU_LABEL}"] [role="menuitemradio"][aria-checked="true"]`)?.focus()
  }, [])

  return (
    <MenuPopover
      anchorRef={anchorRef}
      label={STATUS_MENU_LABEL}
      entries={entries}
      onClose={onClose}
    />
  )
}
