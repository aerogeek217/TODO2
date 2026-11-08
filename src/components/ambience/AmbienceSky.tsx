import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useAmbience } from '../../hooks/use-ambience'
import { useTodoStore } from '../../stores/todo-store'
import { attrSelector, TODO_ID_ATTR } from '../../utils/dom-contract'
import { cumulusBackground, CUMULUS_SHAPES, moonPath, skyBackground, withAlpha, type SkyScene } from '../../utils/sky'
import { useLatestRef } from '../../hooks/use-latest-ref'
import { Particle, Weather } from './Weather'
import { BAR_COUNTS, burstParticles, type ParticleKind, type ParticleSpec } from './weather-particles'
import styles from './AmbienceSky.module.css'

/** The clouds: height, where the flat base sits in the bar, where along it each starts, and how long one crossing takes. */
const CLOUDS = [
  { h: 30, base: 34, start: 0.08, dur: 300 },
  { h: 34, base: 37, start: 0.38, dur: 420 },
  { h: 26, base: 30, start: 0.62, dur: 240 },
  { h: 32, base: 35, start: 0.86, dur: 360 },
] as const

/** A seeded scatter of stars across the bar. */
const STARS = (() => {
  let s = 7
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647
  return Array.from({ length: 34 }, () => ({
    left: `${(rnd() * 100).toFixed(2)}%`,
    top: `${(8 + rnd() * 70).toFixed(1)}%`,
    delay: `${(-rnd() * 4).toFixed(2)}s`,
    opacity: Number((0.4 + rnd() * 0.6).toFixed(2)),
    big: rnd() > 0.85,
  }))
})()

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

/** The moon's disc and lit part, soft-edged. */
function Moon({ scene }: { scene: SkyScene }) {
  return (
    <svg
      className={styles.moon}
      viewBox="0 0 12 12"
      style={{ left: pct(scene.moonX), top: scene.moonY, opacity: scene.opacity.moon }}
      aria-hidden="true"
      focusable="false"
    >
      <circle className={styles.moonDisc} cx={6} cy={6} r={5} />
      <path className={styles.moonLit} d={moonPath(scene.moonAge, scene.south, 6, 6, 5)} />
    </svg>
  )
}

/** The bright point on the hairline (under the sun, or the moon at night) and the sun's glow on it. */
function hairlineStyles(scene: SkyScene): { line: CSSProperties; glow: CSSProperties } | null {
  const h = scene.hairline
  if (!h) return null
  const x = h.x * 100
  const spread = h.glowAlpha > 0 ? 26 : 20
  return {
    line: { background: `linear-gradient(to right, transparent ${(x - spread).toFixed(1)}%, ${withAlpha(h.color, h.alpha)} ${x.toFixed(1)}%, transparent ${(x + spread).toFixed(1)}%)` },
    glow: { background: h.glowAlpha > 0 ? `radial-gradient(ellipse 16% 100% at ${x.toFixed(1)}% 100%, ${withAlpha(h.color, h.glowAlpha)}, transparent 75%)` : 'none' },
  }
}

interface Ripple { id: number; x: number }
interface Burst { id: number; particles: ParticleSpec[] }

/**
 * Tasks completed on screen (one to three at once): where each one's checkbox
 * is, by its row's `data-todo-id` (the first one showing). Subscribed to the
 * todo store only while `active`, so ambience off (or still) costs nothing.
 */
function useCompletedCheckboxes(active: boolean, onComplete: (rects: DOMRect[]) => void): void {
  const latest = useLatestRef(onComplete)
  useEffect(() => {
    if (!active) return undefined
    return useTodoStore.subscribe((state, prev) => {
      if (state.todos === prev.todos) return
      const wasOpen = new Set(prev.todos.filter((t) => !t.isCompleted).map((t) => t.id))
      const done = state.todos.filter((t) => t.isCompleted && wasOpen.has(t.id))
      if (done.length === 0 || done.length > 3) return
      const rects: DOMRect[] = []
      for (const t of done) {
        const boxes = document.querySelectorAll(`${attrSelector(TODO_ID_ATTR, String(t.id))} input[type="checkbox"]`)
        for (const box of boxes) {
          const r = box.getBoundingClientRect()
          if (r.width > 0 && r.bottom > 0 && r.top < window.innerHeight) { rects.push(r); break }
        }
      }
      if (rects.length > 0) latest.current(rects)
    })
  }, [active, latest])
}

/**
 * Ambience in the top bar (desktop): rendered as the bar's first children.
 * The sky layer sits over the bar's glass and under its content — the sky at
 * the share the glass would let through, then the sun, stars, moon, clouds,
 * aurora, mist and the season's weather; the hairline layer draws the sun's
 * (or moon's) point on the bar's bottom edge, its glow, and the ripple a
 * completed task sends along it. A completed task's season burst rises from
 * its checkbox in a layer over the page.
 */
export function AmbienceSky() {
  const ambience = useAmbience()
  const hairlineRef = useRef<HTMLDivElement>(null)
  const [ripples, setRipples] = useState<Ripple[]>([])
  const [bursts, setBursts] = useState<Burst[]>([])
  const nextId = useRef(1)

  const scene = ambience?.scene
  const moving = !!ambience && !ambience.still
  useCompletedCheckboxes(moving, (rects) => {
    if (!scene || !moving) return
    const bar = hairlineRef.current?.getBoundingClientRect()
    if (bar) setRipples((rs) => [...rs, ...rects.map((r) => ({ id: nextId.current++, x: r.left + r.width / 2 - bar.left }))])
    // The season in the checkmark — with Seasons on; a star at night.
    if (scene.weather) {
      const kind: ParticleKind = scene.altitude < -4 ? 'star' : scene.weather
      setBursts((bs) => [...bs, ...rects.map((r) => {
        const id = nextId.current++
        return { id, particles: burstParticles(kind, r.left + r.width / 2, r.top + r.height / 2, id) }
      })])
    }
  })

  const clouds = useMemo(() => scene && CLOUDS.map((c, i) => {
    const w = Math.round(c.h * 2.5)
    return {
      w,
      style: {
        width: w,
        height: c.h,
        top: c.base - 0.85 * c.h,
        marginLeft: -w / 2,
        background: cumulusBackground(CUMULUS_SHAPES[i] ?? [], w, c.h),
        '--dur': `${c.dur}s`,
        // Started part way along, so the clouds open spread across the bar.
        '--delay': `${(-(c.start + 0.15) / 1.3 * c.dur).toFixed(1)}s`,
      } as CSSProperties,
    }
  }), [scene])

  if (!scene || !ambience) return null
  const o = scene.opacity
  const hair = hairlineStyles(scene)
  const still = ambience.still
  const sunX = pct(scene.sunX)

  return (
    <>
      <div className={`${styles.layer} ${still ? styles.still : ''}`} aria-hidden="true" data-ambience="sky">
        <div className={styles.sky} style={{ background: skyBackground(scene), opacity: o.sky }} />
        {o.clouds > 0 && clouds && (
          <div className={styles.clouds} style={{ opacity: o.clouds, '--sky-horizon': scene.horizon, '--sky-night': scene.night } as CSSProperties}>
            {clouds.map((c, i) => <div key={i} className={styles.cloud} style={c.style} />)}
          </div>
        )}
        {o.aurora > 0 && <div className={styles.aurora} style={{ opacity: o.aurora }} />}
        {o.sunGlow > 0 && (
          <div
            className={styles.sunGlow}
            style={{ left: sunX, top: scene.sunY, opacity: o.sunGlow, background: `radial-gradient(circle, ${withAlpha(scene.sun, 0.95)} 0%, ${withAlpha(scene.sun, 0.35)} 35%, transparent 70%)` }}
          />
        )}
        {o.sunDisc > 0 && (
          <div
            className={styles.sunDisc}
            style={{ left: sunX, top: scene.sunY, opacity: o.sunDisc, background: `radial-gradient(circle, ${withAlpha(scene.sun, 0.9)} 0%, ${withAlpha(scene.sun, 0.55)} 40%, transparent 72%)` }}
          />
        )}
        {o.stars > 0 && (
          <div className={styles.stars} style={{ opacity: o.stars }}>
            {STARS.map((s, i) => (
              <i key={i} className={s.big ? `${styles.star} ${styles.starBig}` : styles.star} style={{ left: s.left, top: s.top, opacity: s.opacity, animationDelay: s.delay }} />
            ))}
          </div>
        )}
        {o.moon > 0 && <Moon scene={scene} />}
        {o.mist > 0 && (
          <div className={styles.mist} style={{ opacity: o.mist }} />
        )}
        {!still && scene.weather && o.weather > 0 && (
          <Weather kind={scene.weather} count={BAR_COUNTS[scene.weather]} tall={false} opacity={o.weather} />
        )}
      </div>
      <div ref={hairlineRef} className={styles.hairline} aria-hidden="true" data-ambience="hairline">
        {hair && <div className={styles.hairlineGlow} style={hair.glow} />}
        {hair && <div className={styles.hairlineLine} style={hair.line} />}
        {ripples.map((r) => (
          <div
            key={r.id}
            className={styles.ripple}
            style={{ left: r.x }}
            onAnimationEnd={() => setRipples((rs) => rs.filter((x) => x.id !== r.id))}
          />
        ))}
      </div>
      {bursts.length > 0 && createPortal(
        <div className={styles.bursts} aria-hidden="true">
          {bursts.map((b) => (
            <div key={b.id} onAnimationEnd={(e) => { if (e.target === e.currentTarget.lastChild) setBursts((bs) => bs.filter((x) => x.id !== b.id)) }}>
              {b.particles.map((p, i) => <Particle key={i} spec={p} className={styles.burst} />)}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
