import { useRef } from 'react'

/**
 * Handlers for a text input whose value is a proposal the user usually
 * replaces (the follow-up popover's Next field, the new-task editor's default
 * Next): while `enabled`, gaining focus selects the whole text — by Tab, or by
 * a click, once per focus. A click that focuses the input would otherwise put
 * the caret where it lands on mouseup and drop the selection, so that one
 * mouseup's default is prevented; a second click inside places the caret as
 * usual. Programmatic focus (`.focus()`) selects too.
 */
export function useSelectAllOnFocus(enabled = true) {
  const clickFocusRef = useRef(false)
  return {
    onMouseDown(e: React.MouseEvent<HTMLInputElement>) {
      clickFocusRef.current = enabled && document.activeElement !== e.currentTarget
    },
    onFocus(e: React.FocusEvent<HTMLInputElement>) {
      if (enabled) e.currentTarget.select()
    },
    onMouseUp(e: React.MouseEvent<HTMLInputElement>) {
      if (!clickFocusRef.current) return
      clickFocusRef.current = false
      e.preventDefault()
    },
  }
}
