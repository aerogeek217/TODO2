import type { RadarTab } from '../../../models/workspace-layout'
import { useStatusStore } from '../../../stores/status-store'
import { useWorkspaceStore } from '../../../stores/workspace-store'
import { StatusMark } from '../../shared/StatusMark'
import type { MenuEntry } from '../../shared/MenuPopover'
import { TAG_PICKS_MAX_HEIGHT_PX, TAG_PICKS_WIDTH_PX } from '../glance/menu-entries'

/** `ids` with `id` added at the end, or taken out. */
function toggled(ids: readonly number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
}

/**
 * A Pressure radar tab's menu items: **Waiting statuses ›** — a checkbox per
 * status (Settings' order); a ticked status's tasks sit in the Waiting
 * quarter. Layout config: a tick is saved at once as one undo step, as any
 * tab setting; the submenu stays open while ticking.
 */
export function useRadarMenuEntries(tab: RadarTab | undefined): MenuEntry[] {
  const statuses = useStatusStore((s) => s.statuses)
  if (!tab) return []
  const picked = tab.config.waitingStatusIds
  const known = statuses.filter((s) => s.id != null && picked.includes(s.id)).length
  const pick = (waitingStatusIds: number[]) => useWorkspaceStore.getState().patchTabConfig(tab.id, 'radar', { waitingStatusIds })
  const entries: MenuEntry[] = statuses.length === 0
    ? [{ kind: 'note', text: 'No statuses yet.' }]
    : statuses.flatMap((status): MenuEntry[] => {
      const id = status.id
      if (id == null) return []
      return [{
        kind: 'item',
        label: status.name,
        icon: <span style={{ color: status.color }} aria-hidden="true"><StatusMark status={status} /></span>,
        checkbox: true,
        checked: picked.includes(id),
        keepOpen: true,
        onSelect: () => pick(toggled(picked, id)),
      }]
    })
  return [{
    kind: 'item',
    label: 'Waiting statuses',
    note: known === 0 ? 'None' : String(known),
    children: [
      { kind: 'label', text: 'Tasks with these statuses go in Waiting' },
      ...entries,
      { kind: 'separator' },
      { kind: 'note', text: 'A Waiting task needs chasing at its next follow-up, or a week after its last one.' },
    ],
    childrenWidth: TAG_PICKS_WIDTH_PX,
    childrenMaxHeight: TAG_PICKS_MAX_HEIGHT_PX,
  }]
}
