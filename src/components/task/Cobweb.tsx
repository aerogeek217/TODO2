import styles from './Cobweb.module.css'

/**
 * A small cobweb in a stale task's checkbox, its top-left corner (flair P2):
 * drawn over the box inside the row's `checkWrap`, which must be
 * positioned. Decorative — the row's stale fade and tooltip say it.
 *
 * Strung across the whole corner, as a web between two walls: the hub is
 * where the box's two inner edges meet (1.5, 1.5 — under the rounded
 * border, so the spokes start just out from it, from behind the border),
 * three spokes run at 22.5°, 45° and 67.5°, and two circular arcs around
 * the hub end on the inner edges. With the box's sides standing for the
 * outer spokes, wall, spoke, spoke, spoke and wall are 22.5° apart along
 * every arc.
 */
export function Cobweb() {
  return (
    <svg className={styles.cobweb} viewBox="0 0 18 18" aria-hidden="true" focusable="false" data-cobweb>
      <path d="M2.61 1.96L10.28 5.14M2.35 2.35L8.22 8.22M1.96 2.61L5.14 10.28M6 1.5A4.5 4.5 0 0 1 1.5 6M10 1.5A8.5 8.5 0 0 1 1.5 10" />
    </svg>
  )
}
