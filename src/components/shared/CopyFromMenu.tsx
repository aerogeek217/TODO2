import type { RefObject } from 'react'
import type { CopySource } from '../../hooks/use-copy-sources'
import type { CopySourceGroup } from '../../utils/list-copy'
import { copyFromEntries } from './copy-from-entries'
import { MenuPopover } from './MenuPopover'

const MENU_WIDTH_PX = 300

/**
 * The one Copy from chooser (`MenuPopover`): every layout's lists grouped by
 * layout, then the Eisenhower's list, under Edit list's Copy from….
 */
export function CopyFromMenu({ anchorRef, label, groups, onPick, onClose }: {
  anchorRef: RefObject<HTMLElement | null>
  /** The menu's accessible name. */
  label: string
  groups: readonly CopySourceGroup<CopySource>[]
  onPick: (source: CopySource) => void
  onClose: () => void
}) {
  return (
    <MenuPopover
      anchorRef={anchorRef}
      placement="bottom-start"
      width={MENU_WIDTH_PX}
      label={label}
      entries={copyFromEntries(groups, onPick)}
      onClose={onClose}
    />
  )
}
