import type { ComponentPropsWithRef } from 'react'
import { PopoverLevelContext, popoverLevelAttrs, usePopoverLevel } from './popover-level'

/**
 * A popover's root element (a `div`, every prop passed through): marks its
 * level (`data-popover-level`, D21) and provides it to what renders inside,
 * so a popover opened from it — portaled or not — sits a level higher.
 */
export function PopoverRoot({ children, ...props }: ComponentPropsWithRef<'div'>) {
  const level = usePopoverLevel()
  return (
    <PopoverLevelContext.Provider value={level}>
      <div {...props} {...popoverLevelAttrs(level)}>{children}</div>
    </PopoverLevelContext.Provider>
  )
}
