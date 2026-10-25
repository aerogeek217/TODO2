/** Whether the user asked the system for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * How a scripted scroll moves: `smooth`, unless the user asked the system for
 * reduced motion (the stylesheet's `prefers-reduced-motion` rule covers CSS
 * animations and transitions, not `scrollIntoView` / `scrollTo` calls).
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? 'auto' : 'smooth'
}
