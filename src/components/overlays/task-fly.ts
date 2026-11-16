import { FLIGHT_SEE_THROUGH_ATTR, TODO_ID_ATTR } from '../../utils/dom-contract'
import styles from './task-fly.module.css'

/**
 * A new task flies home (flair P4): right after a task is created, when a
 * list on screen shows it, a small ghost of its title travels from where it
 * was made to its row, the row opens as the ghost arrives and glows a moment
 * — in place of the recent-task pill (`RecentTaskPill`, which still shows
 * when no list on screen shows the task). Imperative, as
 * `task-drop-animation` is: Web Animations on elements the lists already
 * render, and a ghost appended to the page.
 */

/** A row's box and whether it is the topmost thing at its centre. */
interface FlightCandidate {
  rect: Pick<DOMRect, 'top' | 'bottom' | 'left' | 'right' | 'height'>
  visibleAtCenter: boolean
}

/**
 * The row a new task flies to: the first candidate (document order) drawn,
 * with its centre inside the viewport and nothing over it there — so a row
 * scrolled out of its list, or under a dialog, doesn't count.
 */
export function pickFlightTarget<T extends FlightCandidate>(candidates: readonly T[], viewport: { width: number; height: number }): T | null {
  for (const c of candidates) {
    const { rect } = c
    if (rect.height <= 0) continue
    const cx = (rect.left + rect.right) / 2
    const cy = (rect.top + rect.bottom) / 2
    if (cx < 0 || cy < 0 || cx > viewport.width || cy > viewport.height) continue
    if (c.visibleAtCenter) return c
  }
  return null
}

/** The pill's own row (and anything else marked so) is never a destination. */
export const NOT_A_FLIGHT_TARGET_ATTR = 'data-no-flight'

/**
 * Part of the creating surface (`FLIGHT_SEE_THROUGH_ATTR`) or the backdrop
 * just before it, or the pill itself (mounted while it decides, and gone if
 * the task flies).
 */
function seeThrough(el: Element): boolean {
  if (el.closest(`[${FLIGHT_SEE_THROUGH_ATTR}], [${NOT_A_FLIGHT_TARGET_ATTR}]`)) return true
  return el.hasAttribute('data-dialog-backdrop') && el.nextElementSibling?.hasAttribute(FLIGHT_SEE_THROUGH_ATTR) === true
}

/** The topmost element at a point, looking through the creating surface. */
function topmostAt(x: number, y: number): Element | null {
  if (typeof document.elementsFromPoint !== 'function') return null
  for (const el of document.elementsFromPoint(x, y)) if (!seeThrough(el)) return el
  return null
}

/**
 * Whether `hit` is the `content-visibility: auto` box around row `el` (a
 * list's `.row`): a row just added has its contents skipped until a frame
 * finds it on screen, so a hit test made before that paint reaches only
 * that box — topmost there, so nothing covers the row.
 */
function skippedBoxOf(hit: Element, el: Element): boolean {
  return hit !== el && hit.contains(el) && getComputedStyle(hit).contentVisibility === 'auto'
}

/**
 * A row on screen showing the task `todoId` — a list row or line (one with
 * its title in it), not a calendar entry or a dot —, as `pickFlightTarget`
 * picks it; null when none.
 */
export function findFlightRow(todoId: number): HTMLElement | null {
  const rows = [...document.querySelectorAll<HTMLElement>(`[${TODO_ID_ATTR}="${todoId}"]`)]
    .filter((el) => el.querySelector('[data-task-title]') !== null && el.closest(`[${NOT_A_FLIGHT_TARGET_ATTR}]`) === null)
  const candidates = rows.map((el) => {
    const rect = el.getBoundingClientRect()
    // Hit-tested only when drawn (a row skipped or folded has no box).
    const hit = rect.height > 0 ? topmostAt((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2) : null
    return { el, rect, visibleAtCenter: hit !== null && (el.contains(hit) || skippedBoxOf(hit, el)) }
  })
  return pickFlightTarget(candidates, { width: window.innerWidth, height: window.innerHeight })?.el ?? null
}

/** The flight, the row's opening and its glow, ms (the spring curve). */
const FLIGHT_MS = 320
const OPEN_MS = 160
const GLOW_MS = 600

/** Where a task is made when nothing says: Quick Add's place (top centre, 120px down, `QuickAddBar.module.css`). */
function defaultOrigin(): { x: number; y: number } {
  const width = Math.min(720, window.innerWidth - 48)
  return { x: (window.innerWidth - width) / 2 + 16, y: 128 }
}

/**
 * Flies `title` to `row`: the row is held closed (call this before the page
 * paints it, so it never shows early) while a ghost of the title travels to
 * it, then opens and glows. Each flight is independent (a second task made
 * mid-flight starts its own); the ghost is removed when it lands or is
 * cancelled.
 */
export function flyTaskHome(row: HTMLElement, title: string): void {
  const target = (row.querySelector<HTMLElement>('[data-task-title]') ?? row).getBoundingClientRect()
  const easing = getComputedStyle(document.documentElement).getPropertyValue('--spring-easing').trim() || 'ease-out'
  const height = row.getBoundingClientRect().height

  // The row: closed for the flight, then open (its min-height and padding held at 0 too).
  const style = getComputedStyle(row)
  const closed = { height: '0px', minHeight: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0, overflow: 'clip' }
  const open = row.animate([
    { ...closed, offset: 0 },
    // The easing on the opening step only: an easing on the whole would squash the hold.
    { ...closed, offset: FLIGHT_MS / (FLIGHT_MS + OPEN_MS), easing: 'ease-out' },
    { height: `${height}px`, minHeight: '0px', paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, opacity: 1, overflow: 'clip', offset: 1 },
  ], { duration: FLIGHT_MS + OPEN_MS })
  open.finished.then(() => {
    row.animate([
      { boxShadow: 'inset 0 0 0 100px color-mix(in srgb, var(--color-accent) 20%, transparent)' },
      { boxShadow: 'inset 0 0 0 100px transparent' },
    ], { duration: GLOW_MS, easing: 'ease-out' })
  }, () => {})

  // The ghost: the title in a small pill, from where it was made to the row's title.
  const from = defaultOrigin()
  const ghost = document.createElement('div')
  ghost.className = styles.ghost ?? ''
  ghost.textContent = title
  ghost.setAttribute('aria-hidden', 'true')
  ghost.setAttribute('data-task-flight', '')
  ghost.style.left = `${from.x}px`
  ghost.style.top = `${from.y}px`
  document.body.append(ghost)
  const dx = target.left - from.x
  const dy = target.top + (target.height - ghost.offsetHeight) / 2 - from.y
  const flight = ghost.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1, offset: 0 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.97)`, opacity: 1, offset: 0.9 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.97)`, opacity: 0, offset: 1 },
  ], { duration: FLIGHT_MS, easing, fill: 'forwards' })
  const remove = () => ghost.remove()
  flight.finished.then(remove, remove)
}
