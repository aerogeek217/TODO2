import { memo } from 'react'
import type { Person } from '../../models'
import { useOrgStore } from '../../stores/org-store'
import { resolvePersonColor } from '../../utils/person-color'
import { UNAFFILIATED_PERSON_COLOR } from '../../constants'
import styles from './AvatarStack.module.css'

/**
 * AvatarEntity — a person or org avatar. Person entities no longer carry
 * their own color (dropped in v31); fill-variant color is derived from the
 * person's first assigned org via `resolvePersonColor`. Orgs keep their
 * explicit color for the hollow variant.
 */
type AvatarEntity = Pick<Person, 'name'> & Partial<Pick<Person, 'id' | 'initials'>> & {
  /** Hollow-variant (org) color. Ignored for person fill avatars. */
  color?: string
}

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
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const orgs = useOrgStore((s) => s.orgs)
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
        // Fill variant = person avatar: derive from first assigned org.
        // Hollow variant = org avatar: use the entity's own color.
        const fillColor = variant === 'fill'
          ? (resolvePersonColor(p.id, personOrgMap, orgs) ?? UNAFFILIATED_PERSON_COLOR)
          : undefined
        const style: React.CSSProperties = variant === 'hollow'
          ? (p.color ? { borderColor: p.color, color: p.color } : {})
          : { background: fillColor, color: 'var(--color-text-on-accent)' }
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
