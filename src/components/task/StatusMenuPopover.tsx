import { useMemo, type RefObject } from 'react'
import type { Status } from '../../models'
import { MenuPopover, type MenuEntry } from '../shared/MenuPopover'
import { StatusIcon } from '../shared/StatusIcon'
import { StatusMark } from '../shared/StatusMark'

/** The status menu's accessible name. */
const STATUS_MENU_LABEL = 'Status'

/**
 * The status menu (the task layout's Status fact: the editor and the review
 * card, and a task row's status cell): No Status, then every status, as the app's menu (`MenuPopover`) —
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

  return (
    <MenuPopover
      anchorRef={anchorRef}
      label={STATUS_MENU_LABEL}
      entries={entries}
      focusChecked
      onClose={onClose}
    />
  )
}
