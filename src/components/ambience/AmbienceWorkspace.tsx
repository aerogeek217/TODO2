import type { CSSProperties } from 'react'
import { useAmbience } from '../../hooks/use-ambience'
import styles from './AmbienceWorkspace.module.css'

/**
 * Ambience behind the cells (the workspace's first child, under the cells):
 * the sunbeam around golden hour, only where nothing is written — in the
 * gutters and the empty space. Nothing small moves here (no falling
 * weather): it pulls the eye from the tasks; the weather stays in the top bar.
 */
export function AmbienceBackdrop() {
  const ambience = useAmbience()
  if (!ambience) return null
  const { scene } = ambience
  const o = scene.opacity
  return (
    <div className={styles.backdrop} aria-hidden="true" data-ambience="backdrop">
      {o.sunbeam > 0 && (
        <div
          className={styles.sunbeam}
          style={{ opacity: o.sunbeam, '--beam-angle': `${scene.beamAngle.toFixed(0)}deg` } as CSSProperties}
        />
      )}
    </div>
  )
}

/** After sunset, a faint warm pool of light from the workspace's top-left corner, over the cells. */
export function AmbienceLamp() {
  const ambience = useAmbience()
  if (!ambience || ambience.scene.opacity.lamp <= 0) return null
  return (
    <div
      className={styles.lamp}
      aria-hidden="true"
      data-ambience="lamp"
      style={{ opacity: ambience.scene.opacity.lamp }}
    />
  )
}
