import { createContext, useContext } from 'react'
import { useDialogLayer } from './dialog-layer'

/**
 * The level of the popover a component renders in (through portals too):
 * 0 outside any popover. A popover root (`PopoverRoot`) provides its own.
 */
export const PopoverLevelContext = createContext(0)

/**
 * On a popover's root: `1` over the page, `2` on another popover or in a
 * dialog. `tokens.css` swaps the popover tokens to their `-2` twins under
 * `[data-popover-level='2']` (D21), so a popover — and anything drawn in its
 * surface, e.g. a caret — reads its level from the CSS.
 */
export const POPOVER_LEVEL_ATTR = 'data-popover-level'

/** The highest level with its own look; deeper popovers keep level 2's. */
const TOP_LEVEL = 2

/**
 * The level a popover opened here takes: one above the popover it is opened
 * from, and at least 2 inside a dialog (`useDialogLayer`, which also flows
 * through portals) — so Edit list over the workspace is 1, a picker from it 2.
 */
export function usePopoverLevel(): number {
  const parent = useContext(PopoverLevelContext)
  const inDialog = useDialogLayer() != null
  return Math.max(parent, inDialog ? 1 : 0) + 1
}

/** The root attribute for `level` (clamped to the levels that have a look). */
export function popoverLevelAttrs(level: number): { [POPOVER_LEVEL_ATTR]: string } {
  return { [POPOVER_LEVEL_ATTR]: String(Math.min(Math.max(level, 1), TOP_LEVEL)) }
}
