import styles from './sections.module.css'

/** An on / off switch row's control (`role="switch"`, named by its row). */
export function SettingSwitch({ label, on, onFlip }: { label: string; on: boolean; onFlip: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`${styles.switch} ${on ? styles.switchOn : ''}`}
      onClick={onFlip}
    />
  )
}
