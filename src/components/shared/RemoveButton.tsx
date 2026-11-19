import type { HTMLAttributes, MouseEvent } from 'react'
import { CloseIcon } from './icons'
import styles from './RemoveButton.module.css'

/** The circle's sizes: 14px in tight spots (Quick Add chips, a row's date part), 16px in pills and fields, 20px / 24px beside a field's text or its other buttons. */
type RemoveButtonSize = 14 | 16 | 20 | 24

const ICON_SIZE: Record<RemoveButtonSize, number> = { 14: 8, 16: 8, 20: 10, 24: 10 }

const SIZE_CLASS: Record<RemoveButtonSize, string | undefined> = {
  14: styles.s14,
  16: styles.s16,
  20: styles.s20,
  24: styles.s24,
}

interface RemoveButtonProps extends Omit<HTMLAttributes<HTMLElement>, 'children' | 'aria-label' | 'title'> {
  /** The accessible name — what the press removes or clears (`Remove Aisha`, `Clear due date`). Required: the × alone says nothing. */
  label: string
  /** The app's tooltip (`data-tooltip`): `true` shows the label, a string shows that text. */
  tooltip?: boolean | string
  /** The circle's size in px (default 16). */
  size?: RemoveButtonSize
  /** The icon's size, where a host draws a larger box than the size gives (a phone's 44px target). */
  iconSize?: number
  /** A press keeps the focus where it is (a field's caret, a chip row's input): `mousedown`'s default is prevented. */
  keepFocus?: boolean
  /** The click goes no further than the button (its pill or row is a target of its own). */
  stopPropagation?: boolean
  /**
   * `span` (with `role="button"`, not a Tab stop unless `tabIndex` says so) where the × sits inside
   * another button, which can't hold a button (a task pill's clear).
   */
  as?: 'button' | 'span'
  tabIndex?: number
  disabled?: boolean
  /** Data attributes pass through (`data-row-cell`, `data-clear-filters`…). */
  [data: `data-${string}`]: string | undefined
}

/**
 * The app's one ×: a round button drawing `CloseIcon`, centred, quiet until
 * hovered or focused, with a larger invisible target round it. Every pill's
 * remove, every field's clear and every small dismiss uses it (dialogs'
 * closes are `DialogCloseButton`). Its rules sit in `:where()`, so a host's
 * `className` overrides any of them — a position, a fill, an `opacity: 0`
 * until its pill is hovered (a host that sets an opacity at rest gives its
 * own hover one too).
 */
export function RemoveButton({
  label, tooltip, size = 16, iconSize, keepFocus = false, stopPropagation = false, as = 'button',
  className, onClick, onMouseDown, tabIndex, disabled, ...rest
}: RemoveButtonProps) {
  const cls = [styles.remove, SIZE_CLASS[size], className].filter(Boolean).join(' ')
  const handleMouseDown = (e: MouseEvent<HTMLElement>) => {
    if (keepFocus) e.preventDefault()
    onMouseDown?.(e)
  }
  const handleClick = (e: MouseEvent<HTMLElement>) => {
    if (stopPropagation) e.stopPropagation()
    onClick?.(e)
  }
  const common = {
    ...rest,
    className: cls,
    'aria-label': label,
    'data-tooltip': tooltip === true ? label : tooltip || undefined,
    onMouseDown: handleMouseDown,
    onClick: handleClick,
  }
  const icon = <CloseIcon size={iconSize ?? ICON_SIZE[size]} />
  if (as === 'span') {
    return (
      <span {...common} role="button" tabIndex={tabIndex ?? -1} aria-disabled={disabled || undefined}>
        {icon}
      </span>
    )
  }
  return (
    <button {...common} type="button" tabIndex={tabIndex} disabled={disabled}>
      {icon}
    </button>
  )
}
