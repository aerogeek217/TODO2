import { useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './IconSelect.module.css'

export interface IconSelectOption<T extends string> {
  value: T
  label: string
  icon: React.ReactNode
}

interface IconSelectProps<T extends string> {
  value: T
  options: IconSelectOption<T>[]
  onChange: (value: T) => void
  ariaLabel?: string
  minWidth?: number
}

export function IconSelect<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  minWidth,
}: IconSelectProps<T>) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleClose = useCallback(() => setOpen(false), [])

  // Portal + flip + clamp: ListEditorBody dropdowns near the viewport bottom
  // were spilling off-screen (triage-2026-04-27 batch2 P3 / item 3).
  // usePopoverAnchor flips bottom→top when there's no room below, and the
  // panel portals out so the parent modal's `overflow: auto` doesn't clip it.
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: triggerRef },
    open,
    onClose: handleClose,
  })

  const selected = options.find((o) => o.value === value) ?? options[0]

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    // Escape is handled by usePopoverAnchor's document-level listener.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const idx = options.findIndex((o) => o.value === value)
      const next = options[(idx + dir + options.length) % options.length]
      if (next) onChange(next.value)
    }
  }, [open, options, value, onChange])

  if (!selected) return null

  return (
    <div className={styles.root} style={minWidth ? { minWidth } : undefined}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.icon} aria-hidden>{selected.icon}</span>
        <span className={styles.label}>{selected.label}</span>
        <span className={styles.caret} aria-hidden>▾</span>
      </button>
      {open && createPortal(
        // Spread only position/left/top from usePopoverAnchor — applying the
        // hook's `maxHeight` would collapse the panel to 0 on the first render
        // pass (INITIAL_STYLE), which feeds a wrong panelHeight into the
        // single compute call and disables flip/clamp.
        <div
          ref={panelRef}
          className={styles.menu}
          role="listbox"
          style={{ position: style.position, left: style.left, top: style.top }}
        >
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="option"
              aria-selected={opt.value === value}
              className={`${styles.option} ${opt.value === value ? styles.optionSelected : ''}`}
              onClick={() => { onChange(opt.value); setOpen(false) }}
            >
              <span className={styles.icon} aria-hidden>{opt.icon}</span>
              <span className={styles.label}>{opt.label}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  )
}
