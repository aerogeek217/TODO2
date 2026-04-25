import { useRef, useState, useCallback, useEffect } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
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
  const rootRef = useRef<HTMLDivElement>(null)

  useClickOutside(rootRef, () => setOpen(false), open)

  const selected = options.find((o) => o.value === value) ?? options[0]

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      const idx = options.findIndex((o) => o.value === value)
      const next = options[(idx + dir + options.length) % options.length]
      if (next) onChange(next.value)
    }
  }, [open, options, value, onChange])

  useEffect(() => {
    if (!open) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [open])

  if (!selected) return null

  return (
    <div className={styles.root} ref={rootRef} style={minWidth ? { minWidth } : undefined}>
      <button
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
      {open && (
        <div className={styles.menu} role="listbox">
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
        </div>
      )}
    </div>
  )
}
