import type { ComponentPropsWithRef } from 'react'
import type { PopoverCaret } from '../../hooks/use-popover-anchor'
import { PopoverLevelContext, popoverLevelAttrs, usePopoverLevel } from './popover-level'
import styles from './PopoverRoot.module.css'

/** Marks the caret element (`data-popover-caret="top" | "bottom" | …`, its side). */
export const POPOVER_CARET_ATTR = 'data-popover-caret'

/**
 * A popover's root element (a `div`, every prop passed through): marks its
 * level (`data-popover-level`, D21) and provides it to what renders inside,
 * so a popover opened from it — portaled or not — sits a level higher.
 *
 * `caret` (from `usePopoverAnchor({ caret: true })`) draws the caret
 * towards the anchor: a 10px square in the popover's surface turned 45°,
 * half outside the facing edge, its two outer sides in the popover's ring
 * (and the dark theme's rim). It is the root's last child, `position: fixed`
 * at the viewport point the hook worked out — so a scrolling or clipping
 * root (`overflow`) doesn't cut it off — and inside the root, so a press on
 * it is inside the popover and its colours follow the popover's level.
 */
export function PopoverRoot({ children, caret, ...props }: ComponentPropsWithRef<'div'> & { caret?: PopoverCaret | null }) {
  const level = usePopoverLevel()
  return (
    <PopoverLevelContext.Provider value={level}>
      <div {...props} {...popoverLevelAttrs(level)}>
        {children}
        {caret && (
          <span
            className={styles.caret}
            {...{ [POPOVER_CARET_ATTR]: caret.side }}
            style={{ left: caret.x, top: caret.y }}
            aria-hidden="true"
          />
        )}
      </div>
    </PopoverLevelContext.Provider>
  )
}
