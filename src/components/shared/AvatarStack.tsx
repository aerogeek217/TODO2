import { memo } from 'react'
import type { Person } from '../../models'
import styles from './AvatarStack.module.css'

interface AvatarStackProps {
  people: Person[]
  max?: number
  size?: 'sm' | 'md'
  onClick?: (e: React.MouseEvent) => void
  onPersonContextMenu?: (e: React.MouseEvent, person: Person) => void
}

/**
 * Overlapping circle avatars with `+N` overflow. Clicks bubble up to `onClick`
 * (typically opens a picker). Right-click on an individual visible avatar
 * calls `onPersonContextMenu` so per-person filter menus still work.
 */
export const AvatarStack = memo(function AvatarStack({
  people, max = 3, size = 'md', onClick, onPersonContextMenu,
}: AvatarStackProps) {
  if (!people.length) return null
  const visible = people.slice(0, max)
  const overflow = people.length - visible.length
  return (
    <button
      type="button"
      className={`${styles.stack} ${size === 'sm' ? styles.stackSm : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick?.(e) }}
      aria-label={`${people.length} ${people.length === 1 ? 'person' : 'people'} assigned`}
    >
      {visible.map((p) => (
        <span
          key={p.id}
          className={styles.avatar}
          style={p.color ? { background: p.color, color: 'var(--color-text-on-accent)' } : undefined}
          title={p.name}
          onContextMenu={onPersonContextMenu ? (e) => onPersonContextMenu(e, p) : undefined}
        >
          {p.initials || p.name.slice(0, 2).toUpperCase()}
        </span>
      ))}
      {overflow > 0 && (
        <span className={`${styles.avatar} ${styles.overflow}`} title={`${overflow} more`}>
          +{overflow}
        </span>
      )}
    </button>
  )
})
