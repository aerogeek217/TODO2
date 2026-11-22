import { toDateInputValue } from '../../utils/date'
import { registerModuleReset } from '../../utils/module-reset'

/** The hidden date input's mark (tests find it by it). */
export const PICK_DATE_ATTR = 'data-pick-date'

let input: HTMLInputElement | null = null
let onPicked: ((day: Date) => void) | null = null

registerModuleReset(() => {
  input?.remove()
  input = null
  onPicked = null
})

function dateInput(): HTMLInputElement {
  if (input?.isConnected) return input
  const el = document.createElement('input')
  el.type = 'date'
  el.tabIndex = -1
  el.setAttribute(PICK_DATE_ATTR, '')
  el.setAttribute('aria-hidden', 'true')
  Object.assign(el.style, { position: 'fixed', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none', border: '0', padding: '0' })
  el.addEventListener('change', () => {
    const pick = onPicked
    if (!el.value || !pick) return
    onPicked = null
    pick(new Date(`${el.value}T00:00:00`))
  })
  document.body.appendChild(el)
  input = el
  return el
}

/**
 * **Pick a date…** from a menu, which is gone by the time a date is picked:
 * the browser's date picker on one hidden `type="date"` input of the page's
 * own, placed under `anchor` (where the browser opens its picker; the
 * focused element — a menu hands the focus back to its trigger before an
 * item runs — else the viewport's middle). `onPick` gets the day picked, at
 * local midnight, once; a picker closed without a pick calls nothing. No
 * day before `min` is offered. Focus is the fallback where `showPicker`
 * isn't there.
 */
export function pickDate({ value, min, anchor, onPick }: {
  value?: Date
  min?: Date
  anchor?: DOMRect
  onPick: (day: Date) => void
}): void {
  const el = dateInput()
  const rect = anchor ?? (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    ? document.activeElement.getBoundingClientRect()
    : null)
  el.style.left = `${rect ? rect.left : window.innerWidth / 2}px`
  el.style.top = `${rect ? rect.bottom : window.innerHeight / 2}px`
  el.value = toDateInputValue(value)
  el.min = min ? toDateInputValue(min) : ''
  onPicked = onPick
  try {
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.focus()
  } catch {
    el.focus()
  }
}
