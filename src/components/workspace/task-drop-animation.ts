import type { DropAnimationFunction } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { prefersReducedMotion } from '../../utils/motion'
import type { TaskDropLanding } from '../task/dnd/task-drop-landing'

/** Marks the lifted row inside the page's `DragOverlay` (`DragOverlayTask`; its own transform — dnd-kit owns the wrapper's). */
export const LIFTED_TASK_ATTR = 'data-drag-overlay'
const LIFTED_SELECTOR = `[${LIFTED_TASK_ATTR}="task"]`

/** A time token (`200ms`, `0.2s`) in ms. */
function msToken(style: CSSStyleDeclaration, name: string, fallback: number): number {
  const text = style.getPropertyValue(name).trim()
  const n = parseFloat(text)
  if (!Number.isFinite(n)) return fallback
  return text.endsWith('ms') ? n : text.endsWith('s') ? n * 1000 : n
}

/** How the settle runs: `--drag-settle-duration` on the spring curve, read from the lifted row. */
function settleTiming(style: CSSStyleDeclaration): KeyframeAnimationOptions {
  return {
    duration: msToken(style, '--drag-settle-duration', 200),
    easing: style.getPropertyValue('--spring-easing').trim() || 'ease-out',
    fill: 'forwards',
  }
}

/** The lifted row's pose now (mid-lift too) and the row's resting look. */
function poses(style: CSSStyleDeclaration): { pose: Keyframe; rest: Keyframe } {
  return {
    pose: { transform: style.transform, boxShadow: style.boxShadow, backgroundColor: style.backgroundColor },
    rest: { transform: 'none', boxShadow: 'none' },
  }
}

/**
 * Untilts and fades the lifted row where it is, on a copy of the overlay
 * beside it: the drop lets the overlay go at once (dnd-kit has nothing to
 * animate once the dragged row has left — a row moved to another group
 * renders under a new drag id), and the copy outlives it.
 */
function fadeInPlace(): void {
  const lifted = document.querySelector<HTMLElement>(LIFTED_SELECTOR)
  const overlay = lifted?.parentElement
  if (!lifted || !overlay || prefersReducedMotion()) return
  const style = getComputedStyle(lifted)
  const { pose, rest } = poses(style)
  const timing = settleTiming(style)
  const copy = overlay.cloneNode(true) as HTMLElement
  copy.style.pointerEvents = 'none'
  copy.setAttribute('aria-hidden', 'true')
  const copyLifted = copy.querySelector<HTMLElement>(LIFTED_SELECTOR)
  // A new element: no second lift; its pose is the copied one.
  copyLifted?.style.setProperty('animation', 'none')
  overlay.after(copy)
  const animations = [copy.animate([{ opacity: 1 }, { opacity: 0 }], timing)]
  if (copyLifted) animations.push(copyLifted.animate([pose, rest], timing))
  const remove = () => copy.remove()
  void Promise.all(animations.map((a) => a.finished)).then(remove, remove)
}

/** The page's task drop animation and what its drop handlers tell it. */
export interface TaskDropAnimation {
  /** For `DragOverlay`'s `dropAnimation`. */
  animation: DropAnimationFunction
  /**
   * Where the drop being handled lands; a drag's start puts it back to
   * `settle`. `in-place` starts its fade there and then, once a drop.
   */
  land: (landing: TaskDropLanding) => void
}

/**
 * The task row's drop (D25 E4): the lifted row untilts back to the row's
 * resting look over `--drag-settle-duration` on the spring curve, from
 * whatever pose it has (a drop mid-lift too), and goes where the drop's
 * handlers said (`land`; `settle` unless told) — onto the dragged row (its
 * new spot after a reorder, else its origin; the row hidden until the
 * overlay is on it: `animation`, for `DragOverlay`'s `dropAnimation`), or
 * fading where it was let go (`fadeInPlace`). Under reduced motion it goes
 * at once.
 *
 * dnd-kit keeps the overlay's DOM through its drop animation (its clone of
 * the overlay reuses the same keyed element), so the lifted row's computed
 * pose is the one on screen.
 */
export function createTaskDropAnimation(): TaskDropAnimation {
  let landing: TaskDropLanding = 'settle'
  const land = (next: TaskDropLanding) => {
    if (next === 'in-place' && landing !== 'in-place') fadeInPlace()
    landing = next
  }
  const animation: DropAnimationFunction = ({ active, dragOverlay, transform }) => {
    const lifted = dragOverlay.node.querySelector<HTMLElement>(LIFTED_SELECTOR)
    // In place: its copy fades (`fadeInPlace`); this one goes.
    if (!lifted || landing === 'in-place' || prefersReducedMotion()) return
    // Let go: clicks reach what's under it while it settles.
    dragOverlay.node.style.pointerEvents = 'none'
    const style = getComputedStyle(lifted)
    const { pose, rest } = poses(style)
    const timing = settleTiming(style)
    // Onto the row: the overlay moves by how far it is from it now — its own
    // box (dnd-kit measures the tilted row's, a wider and taller one).
    const at = dragOverlay.node.getBoundingClientRect()
    const to = { ...transform, x: transform.x - (at.left - active.rect.left), y: transform.y - (at.top - active.rect.top) }
    const animations = [
      dragOverlay.node.animate(
        [{ transform: CSS.Transform.toString(transform) }, { transform: CSS.Transform.toString(to) }],
        timing,
      ),
      // The surface fades in the second half, so what lands is the row.
      lifted.animate(
        [pose, { offset: 0.5, backgroundColor: pose.backgroundColor }, { ...rest, backgroundColor: 'transparent' }],
        timing,
      ),
    ]
    const opacity = active.node.style.getPropertyValue('opacity')
    active.node.style.setProperty('opacity', '0')
    const restore = () => active.node.style.setProperty('opacity', opacity)
    return Promise.all(animations.map((a) => a.finished)).then(restore, restore)
  }
  return { animation, land }
}
