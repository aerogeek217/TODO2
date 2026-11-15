import styles from './Cobweb.module.css'

/**
 * A small cobweb in a stale task's checkbox, its top-left corner (flair P2):
 * drawn over the box inside the row's `checkWrap`, which must be
 * positioned. Decorative — the row's stale fade and tooltip say it.
 */
export function Cobweb() {
  return (
    <svg className={styles.cobweb} viewBox="0 0 18 18" aria-hidden="true" focusable="false" data-cobweb>
      <path d="M2 2L11.5 3.5M2 2L9 9M2 2L3.5 11.5M6.5 2.8Q6.4 6.2 2.8 6.5M10 3.3Q9.6 9.6 3.3 10" />
    </svg>
  )
}
