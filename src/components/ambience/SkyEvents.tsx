import type { CSSProperties } from 'react'
import type { SkyEvents } from '../../hooks/use-sky-events'
import type { SkyScene } from '../../utils/sky'
import type { AirplaneSpec, ShootingStarSpec, UfoSpec } from '../../utils/sky-events'
import styles from './SkyEvents.module.css'

const pct = (v: number) => `${(v * 100).toFixed(2)}%`
const ms = (v: number) => `${Math.round(v)}ms`

/** A short bright streak, its head leading, fading as it goes. */
function ShootingStar({ spec, opacity }: { spec: ShootingStarSpec; opacity: number }) {
  return (
    <div
      className={styles.shootingStar}
      data-sky-event="shootingStar"
      style={{ left: pct(spec.x), top: spec.y, opacity, '--angle': `${spec.angle}deg`, '--travel': `${spec.travel}px`, '--len': `${spec.length}px`, '--dur': ms(spec.durMs) } as CSSProperties}
    >
      <i className={styles.streak} />
    </div>
  )
}

/** A tiny saucer with a faint glow: drifts in, hovers, hops, drifts on and is gone. */
function Ufo({ spec, opacity }: { spec: UfoSpec; opacity: number }) {
  return (
    <div
      className={styles.ufo}
      data-sky-event="ufo"
      style={{ left: pct(spec.x), top: spec.y, opacity, '--travel': `${(spec.travel * 100).toFixed(1)}cqw`, '--dur': ms(spec.durMs) } as CSSProperties}
    >
      <svg className={styles.ufoBody} viewBox="0 0 16 8" aria-hidden="true" focusable="false">
        <path className={styles.ufoDome} d="M5 4.6 A3 2.9 0 0 1 11 4.6 Z" />
        <ellipse className={styles.ufoDisc} cx={8} cy={5.2} rx={7.5} ry={1.7} />
        <circle className={styles.ufoLight} cx={4} cy={5.3} r={0.6} />
        <circle className={styles.ufoLight} cx={8} cy={5.8} r={0.6} />
        <circle className={styles.ufoLight} cx={12} cy={5.3} r={0.6} />
      </svg>
    </div>
  )
}

/** A tiny airliner with its contrail and a blinking light, crossing the whole bar slowly. */
function Airplane({ spec, opacity }: { spec: AirplaneSpec; opacity: number }) {
  return (
    <div
      className={styles.airplane}
      data-sky-event="airplane"
      style={{
        top: spec.y,
        opacity,
        '--from': spec.east ? '-4cqw' : '104cqw',
        '--to': spec.east ? '104cqw' : '-4cqw',
        '--flip': spec.east ? 1 : -1,
        '--dur': ms(spec.durMs),
      } as CSSProperties}
    >
      <div className={styles.plane}>
        <i className={styles.contrail} />
        <svg className={styles.planeBody} viewBox="0 0 14 6" aria-hidden="true" focusable="false">
          <path d="M1 2.7 L11.6 2.5 Q13.6 2.8 11.6 3.4 L1.2 3.4 Z" />
          <path d="M1 2.8 L0.2 0.6 L1.7 0.6 L3.1 2.7 Z" />
          <path d="M5.2 3.1 L7.8 3.1 L5.9 5.6 L4.8 5.6 Z" />
        </svg>
        <i className={styles.planeLight} />
      </div>
    </div>
  )
}

/**
 * The rare sky events showing now (`useSkyEvents`), in the top bar's sky
 * layer: each at the scene's visibility for its kind (Sky strength and Header
 * motion applied) — a debug-called one, out of its hours, at full.
 */
export function SkyEventsLayer({ events, scene }: { events: SkyEvents; scene: SkyScene }) {
  const { shootingStar, ufo, airplane } = events
  if (!shootingStar && !ufo && !airplane) return null
  const seen = (v: number) => (v > 0 ? v : 1)
  return (
    <div className={styles.events}>
      {shootingStar?.kind === 'shootingStar' && <ShootingStar key={shootingStar.id} spec={shootingStar} opacity={seen(scene.events.shootingStar)} />}
      {ufo?.kind === 'ufo' && <Ufo key={ufo.id} spec={ufo} opacity={seen(scene.events.ufo)} />}
      {airplane?.kind === 'airplane' && <Airplane key={airplane.id} spec={airplane} opacity={seen(scene.events.airplane)} />}
    </div>
  )
}
