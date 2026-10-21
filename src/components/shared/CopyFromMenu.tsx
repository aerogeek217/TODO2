import type { RefObject } from 'react'
import type { CopySource } from '../../hooks/use-copy-sources'
import type { PopoverPlacement } from '../../hooks/use-popover-anchor'
import type { CopySourceGroup } from '../../utils/list-copy'
import { copyFromEntries } from './copy-from-entries'
import { MenuPopover } from './MenuPopover'

const MENU_WIDTH_PX = 300

/**
 * The one Copy from chooser (`MenuPopover`): every layout's lists grouped by
 * layout, then the Eisenhower's list. Edit list's Copy from… and a list
 * picker's Copy of › open it.
 */
export function CopyFromMenu({ anchorRef, placement = 'bottom-start', label, groups, onPick, onClose }: {
  anchorRef: RefObject<HTMLElement | null>
  placement?: PopoverPlacement
  /** The menu's accessible name. */
  label: string
  groups: readonly CopySourceGroup<CopySource>[]
  onPick: (source: CopySource) => void
  onClose: () => void
}) {
  return (
    <MenuPopover
      anchorRef={anchorRef}
      placement={placement}
      width={MENU_WIDTH_PX}
      label={label}
      entries={copyFromEntries(groups, onPick)}
      onClose={onClose}
    />
  )
}
