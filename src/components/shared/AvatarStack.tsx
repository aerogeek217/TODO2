import { memo } from 'react'
import type { Person } from '../../models'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import styles from './AvatarStack.module.css'

/** AvatarEntity — a person avatar; filled with `color` when the person has one. */
type AvatarEntity = Pick<Person, 'name'> & Partial<Pick<Person, 'id' | 'initials' | 'color'>>

interface AvatarStackProps {
  people: AvatarEntity[]
  max?: number
  size?: 'sm' | 'md'
  onClick?: (e: React.MouseEvent) => void
  onPersonContextMenu?: (e: React.MouseEvent, person: AvatarEntity) => void
  /** Render as a non-interactive `<span>` so the stack can sit inside an
   * outer `<button>` (e.g. SearchResultRow) without nested-button HTML. */
  readOnly?: boolean
}

/**
 * Overlapping circle avatars with `+N` overflow. Clicks bubble up to `onClick`
 * (typically opens a picker). Right-click on an individual visible avatar
 * calls `onPersonContextMenu` so per-entity filter menus still work.
 * Each avatar is filled with the person's color (neutral grey without one).
 */
export const AvatarStack = memo(function AvatarStack({
  people, max = 3, size = 'md', onClick, onPersonContextMenu,
  readOnly = false,
}: AvatarStackProps) {
  if (!people.length) return null
  const visible = people.slice(0, max)
  const overflow = people.length - visible.length
  const label = `${people.length} ${people.length === 1 ? 'person' : 'people'} assigned`

  const className = `${styles.stack} ${size === 'sm' ? styles.stackSm : ''}`
  const children = (
    <>
      {visible.map((p) => {
        const style: React.CSSProperties = {
          background: p.color || NEUTRAL_PERSON_COLOR,
          color: 'var(--color-text-on-accent)',
        }
        return (
          <span
            key={p.id}
            className={styles.avatar}
            style={style}
            title={p.name}
            onContextMenu={onPersonContextMenu ? (e) => onPersonContextMenu(e, p) : undefined}
          >
            {p.initials || p.name.slice(0, 2).toUpperCase()}
          </span>
        )
      })}
      {overflow > 0 && (
        <span className={`${styles.avatar} ${styles.overflow}`} title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </>
  )

  if (readOnly) {
    return (
      <span className={className} aria-label={label} role="img">
        {children}
      </span>
    )
  }

  return (
    <button
      type="button"
      className={className}
      onClick={(e) => { e.stopPropagation(); onClick?.(e) }}
      aria-label={label}
    >
      {children}
    </button>
  )
})

export type { AvatarEntity }
