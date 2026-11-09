import type { RefObject } from 'react'
import { MenuPopover } from './MenuPopover'
import { personMenuEntries, useEntityMenuOffers } from './person-menu-entries'
import type { PopoverPlacement } from '../../hooks/use-popover-anchor'

/**
 * What a person's envelope offers (the People group header's, the person
 * task dialog's) — the person menu's top group (`personMenuEntries`):
 * `Review with <name>…` (the review deck of their open tasks; not on a
 * phone nor inside the deck), `Email check-in to <name>` — the one-click
 * send (`sendPersonCheckin`), run inside the item's click / Enter so the
 * clipboard write keeps the gesture — and `Paste reply from <name>…`, the
 * check-in reply import (`ui-store.openCheckinImport`; it reads the person
 * from the reply's footer, else takes this person). Anchored to the
 * envelope, with the caret.
 *
 * Each item hands the focus back to the envelope before it acts, so a
 * dialog it opens (the deck, the import, or the check-in dialog when the
 * send can't go) returns the focus there when it closes.
 */
export function PersonCheckinMenu({ person, anchorRef, placement, review: withReview = true, onClose }: {
  person: { id: number; name: string }
  anchorRef: RefObject<HTMLElement | null>
  placement?: PopoverPlacement
  /** Offer Review (where it is offered); false where Review is a button of its own beside the envelope (a Breakdown row). */
  review?: boolean
  onClose: () => void
}) {
  const offers = useEntityMenuOffers()
  const entries = personMenuEntries(person, { review: withReview && offers.review }).map((item) => ({
    ...item,
    onSelect: () => {
      anchorRef.current?.focus({ preventScroll: true })
      item.onSelect?.()
    },
  }))
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
