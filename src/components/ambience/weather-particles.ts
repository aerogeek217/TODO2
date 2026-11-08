/**
 * The ambience's falling things as CSS-animated elements (`Weather`): each
 * particle loops on its own path, length and delay, so the field keeps a
 * steady count with no script per frame. The values are seeded, so a field
 * is the same on every render.
 */
import type { CSSProperties } from 'react'
import type { WeatherKind } from '../../models/ambience'

/** A completed task's burst adds a star (completed at night). */
export type ParticleKind = WeatherKind | 'star'

export interface ParticleSpec {
  kind: ParticleKind
  /** Custom properties the particle's animation reads (`Weather.module.css`). */
  style: CSSProperties
}

/** A leaf's and a petal's colour, each particle one of its season's (`tokens.css`). */
const LEAVES = ['var(--ambience-leaf-1)', 'var(--ambience-leaf-2)', 'var(--ambience-leaf-3)', 'var(--ambience-leaf-4)']
const PETALS = ['var(--ambience-petal-1)', 'var(--ambience-petal-2)', 'var(--ambience-petal-3)']

/** A small seeded generator (Park–Miller), so a field draws the same each render. */
function seeded(seed: number): () => number {
  let s = Math.max(1, Math.floor(seed) % 2147483647)
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

const px = (v: number) => `${v.toFixed(1)}px`
const sec = (v: number) => `${v.toFixed(2)}s`

/** How many fall in the bar and behind the cells (a wide desktop window). */
export const BAR_COUNTS: Readonly<Record<WeatherKind, number>> = { flake: 22, leaf: 3, petal: 6, firefly: 9, seed: 4 }
export const BEHIND_COUNTS: Readonly<Record<WeatherKind, number>> = { flake: 70, leaf: 8, petal: 16, firefly: 18, seed: 10 }

/**
 * `count` particles of `kind`. `tall` fields (behind the cells) take longer to
 * cross than the 40px bar.
 */
export function weatherParticles(kind: WeatherKind, count: number, tall: boolean, seed = 7): ParticleSpec[] {
  const rnd = seeded(seed + kind.length * 101)
  const slow = tall ? 6 : 1
  return Array.from({ length: count }, (): ParticleSpec => {
    const left = `${(rnd() * 100).toFixed(2)}%`
    const top = `${(rnd() * 100).toFixed(2)}%`
    switch (kind) {
      case 'flake': {
        const size = 1.2 + rnd() * 2.2
        const dur = (4.5 + rnd() * 4) * slow
        return { kind, style: { left, '--size': px(size), '--sway': px((rnd() - 0.5) * 16), '--dur': sec(dur), '--delay': sec(-rnd() * dur) } as CSSProperties }
      }
      case 'leaf': {
        const dur = (26 + rnd() * 22) * (tall ? 1.4 : 1)
        return { kind, style: { top, '--size': px(6 + rnd() * 2), '--drop': px((tall ? 120 : 10) * (0.4 + rnd())), '--spin': `${Math.round((rnd() - 0.5) * 1080)}deg`, '--dur': sec(dur), '--delay': sec(-rnd() * dur), '--color': LEAVES[Math.floor(rnd() * LEAVES.length)] ?? 'var(--ambience-leaf-1)' } as CSSProperties }
      }
      case 'petal': {
        const dur = (20 + rnd() * 18) * (tall ? 1.4 : 1)
        return { kind, style: { top, '--size': px(4 + rnd() * 1.5), '--drop': px((tall ? 160 : 14) * (0.4 + rnd())), '--spin': `${Math.round((rnd() - 0.5) * 900)}deg`, '--dur': sec(dur), '--delay': sec(-rnd() * dur), '--color': PETALS[Math.floor(rnd() * PETALS.length)] ?? 'var(--ambience-petal-1)' } as CSSProperties }
      }
      case 'seed': {
        const dur = (10 + rnd() * 8) * slow
        return { kind, style: { left, '--size': px(1.6 + rnd()), '--sway': px(10 + rnd() * 30), '--dur': sec(dur), '--delay': sec(-rnd() * dur) } as CSSProperties }
      }
      case 'firefly': {
        const dur = 9 + rnd() * 9
        return {
          kind,
          style: {
            left, top, '--size': px(2 + rnd()),
            '--dx1': px((rnd() - 0.5) * 40), '--dy1': px((rnd() - 0.5) * (tall ? 60 : 14)),
            '--dx2': px((rnd() - 0.5) * 40), '--dy2': px((rnd() - 0.5) * (tall ? 60 : 14)),
            '--dur': sec(dur), '--delay': sec(-rnd() * dur), '--blink': sec(1.8 + rnd() * 2.4),
          } as CSSProperties,
        }
      }
    }
  })
}

/**
 * A completed task's burst at (`x`, `y`) in the viewport: three of the
 * season's particles drifting down from the checkbox, or rising stars at
 * night. Seeded by `seed` so a burst renders the same.
 */
export function burstParticles(kind: ParticleKind, x: number, y: number, seed: number): ParticleSpec[] {
  const rnd = seeded(seed)
  const rises = kind === 'star' || kind === 'seed' || kind === 'firefly'
  return [0, 1, 2].map((i): ParticleSpec => ({
    kind,
    style: {
      left: px(x + (rnd() - 0.5) * 6),
      top: px(y),
      '--size': px(i === 0 ? (kind === 'star' ? 9 : 5) : (kind === 'star' ? 6 : 3.5)),
      '--dx': px((rnd() - 0.5) * (rises ? 32 : 44)),
      '--dy': px(rises ? -(30 + rnd() * 20) : 22 + rnd() * 16),
      '--spin': `${Math.round((rnd() - 0.5) * 540)}deg`,
      '--color': kind === 'leaf' ? (LEAVES[i] ?? 'var(--ambience-leaf-1)') : kind === 'petal' ? (PETALS[i] ?? 'var(--ambience-petal-1)') : undefined,
    } as CSSProperties,
  }))
}
