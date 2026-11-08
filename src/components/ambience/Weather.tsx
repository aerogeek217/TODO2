import { useMemo, type CSSProperties } from 'react'
import type { WeatherKind } from '../../models/ambience'
import { weatherParticles, type ParticleSpec } from './weather-particles'
import styles from './Weather.module.css'

/** A particle's element: the shape by kind, its path and timing from its custom properties. */
export function Particle({ spec, className }: { spec: ParticleSpec; className?: string }) {
  return <span className={`${styles.p} ${styles[spec.kind] ?? ''} ${className ?? ''}`} style={spec.style} />
}

/**
 * The season's weather over a field (the top bar, or the space behind the
 * cells): `count` particles looping on their own paths. Not drawn under
 * reduced motion (the caller leaves it out).
 */
export function Weather({ kind, count, tall, dark, opacity }: {
  kind: WeatherKind
  count: number
  /** Behind the cells: a tall field, crossed more slowly. */
  tall: boolean
  dark: boolean
  opacity: number
}) {
  const particles = useMemo(() => weatherParticles(kind, count, tall), [kind, count, tall])
  const style = {
    opacity,
    '--flake': dark ? '#eef3fa' : '#8ea3bd',
    '--seed': dark ? 'rgba(255, 255, 255, 0.8)' : 'rgba(120, 110, 95, 0.7)',
  } as CSSProperties
  return (
    <div className={styles.field} style={style} aria-hidden="true" data-ambience-weather={kind}>
      {particles.map((spec, i) => <Particle key={i} spec={spec} />)}
    </div>
  )
}
