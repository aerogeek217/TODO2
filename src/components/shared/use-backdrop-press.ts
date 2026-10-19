import { useRef, type MouseEvent as ReactMouseEvent } from 'react'

export interface BackdropPressOptions {
  /** `false` — the press closes nothing (a dialog that must be answered). */
  enabled?: boolean
  /** The press doesn't take the focus (Quick Add keeps its input's). */
  keepFocus?: boolean
}

/**
 * A backdrop's press handlers, the one rule for every modal backdrop
 * (`DialogFrame`, Quick Add): a press that starts and ends on the backdrop
 * itself calls `onClose`, so a text drag let go over it closes nothing. The
 * backdrop takes the click, so nothing underneath gets it.
 */
export function useBackdropPress(onClose: () => void, { enabled = true, keepFocus = false }: BackdropPressOptions = {}) {
  const downOnBackdrop = useRef(false)
  return {
    onMouseDown: (e: ReactMouseEvent<HTMLElement>) => {
      downOnBackdrop.current = e.target === e.currentTarget
      if (keepFocus && downOnBackdrop.current) e.preventDefault()
    },
    onClick: (e: ReactMouseEvent<HTMLElement>) => {
      const pressed = downOnBackdrop.current
      downOnBackdrop.current = false
      if (enabled && pressed && e.target === e.currentTarget) onClose()
    },
  }
}
