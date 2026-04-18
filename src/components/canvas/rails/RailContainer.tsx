import type { ReactNode } from 'react'
import type { Rail, RailSide } from '../../../models/canvas-rails'
import styles from './RailContainer.module.css'

interface RailContainerProps {
  side: RailSide
  rail: Rail
  children: ReactNode
}

export function RailContainer({ side, rail, children }: RailContainerProps) {
  const orientClass = rail.orientation === 'vertical' ? styles.vertical : styles.horizontal
  return (
    <aside
      className={`${styles.rail} ${orientClass} ${styles[side]}`}
      data-rail-side={side}
      aria-label={`Canvas ${side} rail`}
    >
      {children}
    </aside>
  )
}
