import type { LayoutBody } from '../models/workspace-layout'
import { isWholeLine, wholeLine, type EdgeStretch } from './workspace-grid'

/**
 * What a divider's drag, arrow key or double-click moves (layout edit mode
 * E4, decision B), in and out of the mode: a plain one moves the **whole
 * grid line** the divider lies on, across "+" crossings too (a whole-line
 * resize: its two tracks share their size anew); with Alt (`breakOff`) only
 * the divider's own piece (`stretch`), which leaves its line — a new line
 * and track, a structural edit — as a part-line move did before. Beside a
 * Numbers-only row (`fit`) it is always the whole line: the row takes a
 * height of its own.
 */
interface DividerMoveOptions {
  /** Alt is held: break the piece off its line. */
  breakOff: boolean
  /** A Numbers-only (fit) row is beside it. */
  fit: boolean
}

/** The stretch a divider of `stretch` moves in `body` (`DividerMoveOptions`): its whole line, or with Alt its own piece. */
export function dividerMoveStretch(body: LayoutBody, stretch: EdgeStretch, { breakOff, fit }: DividerMoveOptions): EdgeStretch {
  return breakOff && !fit ? stretch : wholeLine(body, stretch.axis, stretch.line)
}

/** Whether a divider's move breaks its piece off the line (Alt on part of a line): what it lights is then its piece alone, else its whole line. */
export function dividerBreaksOff(body: LayoutBody, stretch: EdgeStretch, opts: DividerMoveOptions): boolean {
  return opts.breakOff && !opts.fit && !isWholeLine(body, stretch)
}

/** A divider's tooltip: Alt-drag named only where there is a piece to break off (part of a line, no fit row beside it). */
export function dividerTooltip(partOfLine: boolean, fit: boolean): string {
  if (fit) return 'Drag to resize · Double-click to fit'
  return partOfLine ? 'Drag to resize · Alt-drag to split the line' : 'Drag to resize'
}
