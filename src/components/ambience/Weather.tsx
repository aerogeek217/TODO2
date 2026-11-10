import { useMemo } from 'react'
import type { WeatherKind } from '../../models/ambience'
import { weatherParticles, type ParticleSpec } from './weather-particles'
import styles from './Weather.module.css'

/** A particle's element: the shape by kind, its path and timing from its custom properties. */
export function Particle({ spec, className }: { spec: ParticleSpec; className?: string }) {
  return <span className={`${styles.p} ${styles[spec.kind] ?? ''} ${className ?? ''}`} style={spec.style} />
}

/**
 * The season's weather over the top bar: `count` particles looping on their own paths, in the theme's
 * colours (`--ambience-*`, `tokens.css`). Not drawn under reduced motion
 * (the caller leaves it out).
 */
export function Weather({ kind, count, opacity }: {
  kind: WeatherKind
  count: number
  opacity: number
}) {
  const particles = useMemo(() => weatherParticles(kind, count), [kind, count])
  return (
    <div className={styles.field} style={{ opacity }} aria-hidden="true" data-ambience-weather={kind}>
      {particles.map((spec, i) => <Particle key={i} spec={spec} />)}
    </div>
  )
}
