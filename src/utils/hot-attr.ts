/**
 * Keeps an attribute on an element while its own `:hover` and / or
 * `:focus-within` matches — for a container whose hover or focus shows
 * something inside it (a cell's controls, a list's column divider), when the
 * container holds many elements.
 *
 * Why an attribute and not `.container:hover .part` in a stylesheet (cr34 H5,
 * measured on the built file): a browser keeps one set of "descendants to
 * style again" per pseudo-class, shared by every rule in the page — for
 * `:hover` it holds every task-row part a `.row:hover .x` rule names and
 * every `button` (a task-editor rule's subject), for `:focus-within` it is
 * "everything inside, and the siblings after it". A container whose hover or
 * focus a rule reads gets that whole set applied to its subtree each time the
 * pointer crosses its edge or the focus moves in or out: 1,700 elements for a
 * cell holding a 110-row list, the whole page for a focus move. An
 * attribute's set holds only the parts named with it.
 *
 * The attribute follows the real pseudo-classes: set and cleared on the
 * events that change them, and read back from them (`matches`) where no
 * event can say — when tracking starts, after the focus leaves, and when the
 * focused element is removed from the page.
 */

/** Which of the element's pseudo-classes the attribute stands for (either one matching sets it). */
export interface HotStates {
  hover?: boolean
  focus?: boolean
}

/**
 * Keeps attribute `attr` on `el` while its `:hover` (`hover`) or its
 * `:focus-within` (`focus`) matches. Returns what stops it (and takes the
 * attribute off); `undefined` for no element.
 */
export function trackHot(el: HTMLElement | null, attr: string, { hover: tracksHover = false, focus: tracksFocus = false }: HotStates): (() => void) | undefined {
  if (!el) return undefined
  let hover = false
  let focus = false
  let stopped = false
  let watching: MutationObserver | null = null

  const matches = (selector: string): boolean => {
    try {
      return el.matches(selector)
    } catch {
      return false
    }
  }
  const apply = () => {
    const hot = hover || focus
    if (hot === el.hasAttribute(attr)) return
    if (hot) el.setAttribute(attr, '')
    else el.removeAttribute(attr)
  }
  const readFocus = () => {
    if (!stopped) setFocus(matches(':focus-within'))
  }
  // The focused element removed from the page fires no event: while the focus
  // is inside, each change to the element's children asks the pseudo-class again.
  const watchRemoval = (on: boolean) => {
    if (on === (watching != null)) return
    if (on) {
      if (typeof MutationObserver === 'undefined') return
      watching = new MutationObserver(readFocus)
      watching.observe(el, { childList: true, subtree: true })
    } else {
      watching?.disconnect()
      watching = null
    }
  }
  function setFocus(next: boolean) {
    focus = next
    watchRemoval(next)
    apply()
  }
  const onEnter = () => {
    hover = true
    apply()
  }
  const onLeave = () => {
    hover = false
    apply()
  }
  const onFocusIn = () => setFocus(true)
  const onFocusOut = (e: FocusEvent) => {
    // To another element inside: still inside.
    if (e.relatedTarget instanceof Node && el.contains(e.relatedTarget)) return
    // Elsewhere, to nothing, or the window lost the focus: as the pseudo-class says once the move is over.
    queueMicrotask(readFocus)
  }

  if (tracksHover) {
    hover = matches(':hover')
    el.addEventListener('mouseenter', onEnter)
    el.addEventListener('mouseleave', onLeave)
  }
  if (tracksFocus) {
    focus = matches(':focus-within')
    watchRemoval(focus)
    el.addEventListener('focusin', onFocusIn)
    el.addEventListener('focusout', onFocusOut)
  }
  apply()
  return () => {
    stopped = true
    el.removeEventListener('mouseenter', onEnter)
    el.removeEventListener('mouseleave', onLeave)
    el.removeEventListener('focusin', onFocusIn)
    el.removeEventListener('focusout', onFocusOut)
    watchRemoval(false)
    el.removeAttribute(attr)
  }
}
