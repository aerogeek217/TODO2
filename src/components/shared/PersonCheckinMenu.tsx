import type { RefObject } from 'react'
import { sendPersonCheckin } from '../../services/checkin-email/person-checkin'
import { useUIStore } from '../../stores/ui-store'
import { EnvelopeIcon, ReplyIcon } from './icons'
import { MenuPopover, type MenuEntry } from './MenuPopover'
import type { PopoverPlacement } from '../../hooks/use-popover-anchor'

/**
 * What a person's envelope offers (the People group header's, the person
 * task dialog's): `Send check-in to <name>` — the one-click send
 * (`sendPersonCheckin`), run inside the item's click / Enter so the
 * clipboard write keeps the gesture — or `Paste reply from <name>…`, the
 * check-in reply import (`ui-store.openCheckinImport`; it reads the person
 * from the reply). Anchored to the envelope, with the caret.
 *
 * Each item hands the focus back to the envelope before it acts, so a
 * dialog it opens (the import, or the check-in dialog when the send can't
 * go) returns the focus there when it closes.
 */
export function PersonCheckinMenu({ person, anchorRef, placement, onClose }: {
  person: { id: number; name: string }
  anchorRef: RefObject<HTMLElement | null>
  placement?: PopoverPlacement
  onClose: () => void
}) {
  const backToEnvelope = () => anchorRef.current?.focus({ preventScroll: true })
  const entries: MenuEntry[] = [
    {
      kind: 'item',
      label: `Send check-in to ${person.name}`,
      icon: <EnvelopeIcon />,
      onSelect: () => {
        backToEnvelope()
        void sendPersonCheckin(person.id)
      },
    },
    {
      kind: 'item',
      label: `Paste reply from ${person.name}…`,
      icon: <ReplyIcon />,
      onSelect: () => {
        backToEnvelope()
        useUIStore.getState().openCheckinImport()
      },
    },
  ]
  return (
    <MenuPopover
      anchorRef={anchorRef}
      placement={placement}
      label={`Check-in for ${person.name}`}
      entries={entries}
      onClose={onClose}
    />
  )
}
