import type { KeyboardEvent } from 'react'

/**
 * A phone filter sheet section's header as a disclosure: a button (Tab
 * reaches it, Enter / Space toggles) that says whether its section is open.
 * The header stays a `div` for its row layout.
 */
export function sheetHeaderProps(open: boolean, onToggle: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    'aria-expanded': open,
    onClick: onToggle,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault()
      onToggle()
    },
  } as const
}
