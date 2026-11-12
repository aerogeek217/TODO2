import { useRef, useState } from 'react'
import type { DrawnIcon } from '../../models/icon'
import { AppIcon } from './AppIcon'
import { ChevronDownIcon } from './icons'
import { IconPicker, type IconPickerProps } from './IconPicker'
import styles from './IconPickerButton.module.css'

interface IconPickerButtonProps extends Omit<IconPickerProps, 'anchorRef' | 'onClose'> {
  /** What the button shows (the picked icon, else what the thing shows without one); `none` reads `None`. */
  shown: DrawnIcon
  /** The button's accessible name (`Icon: Flag icon. Change`). */
  ariaLabel: string
  /** The words beside it (the board's `Emoji · Muted`). */
  summary: string
}

/**
 * The icon row's trigger (the icons board: Name and icon…, Edit layout): a
 * button with the icon and a chevron, the summary beside it; a click opens
 * the one icon picker (`IconPicker`) under it, and again closes it.
 */
export function IconPickerButton({ shown, ariaLabel, summary, ...picker }: IconPickerButtonProps) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement | null>(null)
  return (
    <div className={styles.iconRow}>
      <button
        ref={button}
        type="button"
        className={styles.iconButton}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-icon-picker-button=""
        onClick={() => setOpen((o) => !o)}
      >
        {shown.kind === 'none'
          ? <span className={styles.noIcon}>None</span>
          : <AppIcon icon={shown} size={15} />}
        <ChevronDownIcon size={10} />
      </button>
      <span className={styles.summary}>{summary}</span>
      {open && <IconPicker {...picker} anchorRef={button} onClose={() => setOpen(false)} />}
    </div>
  )
}
