import { useAmbience } from '../../hooks/use-ambience'
import { useResolvedTheme } from '../../hooks/use-resolved-theme'
import { rgba } from '../../utils/sky'
import { Weather } from './Weather'
import { BEHIND_COUNTS } from './weather-particles'
import styles from './AmbienceWorkspace.module.css'

/**
 * Ambience behind the cells (the workspace's first child, under the cells):
 * the sunbeam around golden hour and the season's weather — both only where
 * nothing is written, in the gutters and the empty space.
 */
export function AmbienceBackdrop() {
  const ambience = useAmbience()
  const dark = useResolvedTheme() === 'dark'
  if (!ambience) return null
  const { scene, still } = ambience
  const o = scene.opacity
  const beam = dark ? [255, 190, 110] as const : [255, 170, 80] as const
  const a = dark ? [0.14, 0.24, 0.12, 0.11] : [0.16, 0.26, 0.14, 0.13]
  return (
    <div className={styles.backdrop} aria-hidden="true" data-ambience="backdrop">
      {o.sunbeam > 0 && (
        <div
          className={styles.sunbeam}
          style={{
            opacity: o.sunbeam,
            background: `linear-gradient(${scene.beamAngle.toFixed(0)}deg, transparent 30%, ${rgba(beam, a[0])} 42%, ${rgba(beam, a[1])} 47%, ${rgba(beam, a[2])} 52%, transparent 58%, ${rgba(beam, a[3])} 64%, transparent 69%)`,
          }}
        />
      )}
      {!still && scene.weather && o.behind > 0 && (
        <Weather kind={scene.weather} count={BEHIND_COUNTS[scene.weather]} tall dark={dark} opacity={o.behind} />
      )}
    </div>
  )
}

/** After sunset, a faint warm pool of light from the workspace's top-left corner, over the cells. */
export function AmbienceLamp() {
  const ambience = useAmbience()
  const dark = useResolvedTheme() === 'dark'
  if (!ambience || ambience.scene.opacity.lamp <= 0) return null
  return (
    <div
      className={styles.lamp}
      aria-hidden="true"
      data-ambience="lamp"
      style={{
        opacity: ambience.scene.opacity.lamp,
        background: `radial-gradient(ellipse 70% 90% at 0% 0%, ${dark ? 'rgba(255, 170, 95, 0.075)' : 'rgba(255, 150, 60, 0.08)'}, transparent 70%)`,
      }}
    />
  )
}
