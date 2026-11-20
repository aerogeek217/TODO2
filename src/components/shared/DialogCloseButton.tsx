import type { ButtonHTMLAttributes } from 'react'
import { CloseIcon } from './icons'
import styles from './DialogCloseButton.module.css'

/** The square's sizes: 24px in a popover's or a panel's header, 28px in a dialog's, 30px in the task editor's. */
type DialogCloseSize = 24 | 28 | 30

const SIZE_CLASS: Record<DialogCloseSize, string | undefined> = {
  24: styles.s24,
  28: styles.s28,
  30: styles.s30,
}

interface DialogCloseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'type' | 'aria-label' | 'title'> {
  /** The accessible name (default `Close`). */
  label?: string
  /** The app's tooltip (`data-tooltip`): `true` shows the label, a string shows that text. */
  tooltip?: boolean | string
  /** The square's size in px (default 28). */
  size?: DialogCloseSize
  /** The icon's size (default 12). */
  iconSize?: number
  [data: `data-${string}`]: string | undefined
}

/**
 * A dialog's, popover's or panel's close: a quiet square drawing
 * `CloseIcon` (the task editor header's ×). Its rules sit in `:where()`, so
 * a host's `className` overrides any of them — a margin, or the class its
 * header's ⋯ shares so the two match.
 */
export function DialogCloseButton({ label = 'Close', tooltip, size = 28, iconSize = 12, className, ...rest }: DialogCloseButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      className={[styles.close, SIZE_CLASS[size], className].filter(Boolean).join(' ')}
      aria-label={label}
      data-tooltip={tooltip === true ? label : tooltip || undefined}
    >
      <CloseIcon size={iconSize} />
    </button>
  )
}
