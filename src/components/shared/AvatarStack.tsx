import { memo } from 'react'
import type { Person } from '../../models'
import styles from './AvatarStack.module.css'

type AvatarEntity = Pick<Person, 'name'> & Partial<Pick<Person, 'id' | 'color' | 'initials'>>

interface AvatarStackProps {
  people: AvatarEntity[]
  max?: number
  size?: 'sm' | 'md'
  variant?: 'fill' | 'hollow'
  onClick?: (e: React.MouseEvent) => void
  onPersonContextMenu?: (e: React.MouseEvent, person: AvatarEntity) => void
}

/**
 * Overlapping circle avatars with `+N` overflow. Clicks bubble up to `onClick`
 * (typically opens a picker). Right-click on an individual visible avatar
 * calls `onPersonContextMenu` so per-entity filter menus still work.
 *
 * Variants:
 *  - "fill"   (default): solid bg using entity color, white text
 *  - "hollow": transparent bg with entity-colored outline + text (for orgs)
 */
export const AvatarStack = memo(function AvatarStack({
  people, max = 3, size = 'md', variant = 'fill', onClick, onPersonContextMenu,
}: AvatarStackProps) {
  if (!people.length) return null
  const visible = people.slice(0, max)
  const overflow = people.length - visible.length
  const label = variant === 'hollow'
    ? `${people.length} ${people.length === 1 ? 'org' : 'orgs'} assigned`
    : `${people.length} ${people.length === 1 ? 'person' : 'people'} assigned`
  return (
    <button
      type="button"
      className={`${styles.stack} ${size === 'sm' ? styles.stackSm : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick?.(e) }}
      aria-label={label}
    >
      {visible.map((p) => {
        const style: React.CSSProperties = variant === 'hollow'
          ? (p.color ? { borderColor: p.color, color: p.color } : {})
          : (p.color ? { background: p.color, color: 'var(--color-text-on-accent)' } : {})
        return (
          <span
            key={p.id}
            className={`${styles.avatar} ${variant === 'hollow' ? styles.avatarHollow : ''}`}
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
    </button>
  )
})

export type { AvatarEntity }
