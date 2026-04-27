import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useClickOutside } from '../../hooks/use-click-outside'
import { IconSelect } from './IconSelect'
import styles from './SortGroupToolbar.module.css'

export interface SortGroupOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

export interface SortGroupToolbarProps<S extends string, G extends string> {
  sortBy: S
  groupBy: G
  sortOptions: readonly SortGroupOption<S>[]
  groupOptions: readonly SortGroupOption<G>[]
  onSortChange: (next: S) => void
  onGroupChange: (next: G) => void
  /** Current asc/desc state. In compact density, drives the trigger glyph. */
  sortAsc?: boolean
  /** When omitted, no asc-only toggle button renders. */
  onToggleAsc?: () => void
  /** ProjectNode = 'compact', ListView = 'comfortable'. Default 'comfortable'. */
  density?: 'compact' | 'comfortable'
  /** Hide the sort field entirely. ProjectNode passes false when todos.length < 2. */
  showSort?: boolean
  /** Hide the group field entirely. */
  showGroup?: boolean
  /** Applied to the root for consumer-controlled CSS (e.g. hover-reveal). */
  className?: string
  groupLabel?: string
  sortLabel?: string
  ariaLabelSort?: string
  ariaLabelGroup?: string
}

export function SortGroupToolbar<S extends string, G extends string>({
  sortBy,
  groupBy,
  sortOptions,
  groupOptions,
  onSortChange,
  onGroupChange,
  sortAsc,
  onToggleAsc,
  density = 'comfortable',
  showSort = true,
  showGroup = true,
  className,
  groupLabel = 'Group',
  sortLabel = 'Sort',
  ariaLabelSort = 'Sort tasks by',
  ariaLabelGroup = 'Group tasks by',
}: SortGroupToolbarProps<S, G>) {
  if (density === 'comfortable') {
    return (
      <div className={`${styles.comfortable}${className ? ` ${className}` : ''}`}>
        {showGroup && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{groupLabel}</span>
            <IconSelect<G>
              value={groupBy}
              options={[...groupOptions].map((o) => ({
                value: o.value,
                label: o.label,
                icon: o.icon ?? null,
              }))}
              onChange={onGroupChange}
              ariaLabel={ariaLabelGroup}
            />
          </div>
        )}
        {showSort && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>{sortLabel}</span>
            <IconSelect<S>
              value={sortBy}
              options={[...sortOptions].map((o) => ({
                value: o.value,
                label: o.label,
                icon: o.icon ?? null,
              }))}
              onChange={onSortChange}
              ariaLabel={ariaLabelSort}
            />
            {onToggleAsc && (
              <button
                type="button"
                className={styles.compactButton}
                onClick={onToggleAsc}
                aria-label={sortAsc ? 'Sort ascending' : 'Sort descending'}
                title={sortAsc ? 'Ascending' : 'Descending'}
              >
                {sortAsc ? '↑' : '↓'}
              </button>
            )}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={`${styles.compact}${className ? ` ${className}` : ''}`}>
      {showSort && (
        <CompactField
          mode="sort"
          value={sortBy}
          options={sortOptions}
          onChange={onSortChange}
          asc={sortAsc}
          ariaLabel={ariaLabelSort}
        />
      )}
      {showGroup && (
        <CompactField
          mode="group"
          value={groupBy}
          options={groupOptions}
          onChange={onGroupChange}
          ariaLabel={ariaLabelGroup}
        />
      )}
    </div>
  )
}

interface CompactFieldProps<T extends string> {
  mode: 'sort' | 'group'
  value: T
  options: readonly SortGroupOption<T>[]
  onChange: (next: T) => void
  asc?: boolean
  ariaLabel: string
}

function CompactField<T extends string>({
  mode,
  value,
  options,
  onChange,
  asc,
  ariaLabel,
}: CompactFieldProps<T>) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useClickOutside(wrapperRef, () => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  const triggerGlyph =
    mode === 'sort'
      ? (asc === true ? '↑' : asc === false ? '↓' : '↕')
      : '⊟'

  const triggerTitle = mode === 'sort' ? 'Sort tasks' : 'Group tasks'

  return (
    <div className={styles.compactWrapper} ref={wrapperRef}>
      <button
        type="button"
        className={`${styles.compactButton} nopan nodrag`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={triggerTitle}
      >
        {triggerGlyph}
      </button>
      {open && (
        <div className={styles.compactMenu} role="listbox">
          {options.map((opt) => {
            const active = opt.value === value
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.compactOption} ${active ? styles.compactOptionActive : ''}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setOpen(false)
                  onChange(opt.value)
                }}
              >
                {opt.label}
                {mode === 'sort' && active && asc != null && (
                  <span className={styles.compactOptionArrow}>{asc ? '↑' : '↓'}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
