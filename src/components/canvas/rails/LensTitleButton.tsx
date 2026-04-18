import type { MouseEvent } from 'react'
import styles from './LensTitleButton.module.css'

interface LensTitleButtonProps {
  label: string
  onOpen: (x: number, y: number) => void
}

export function LensTitleButton({ label, onOpen }: LensTitleButtonProps) {
  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onOpen(rect.left, rect.bottom + 4)
  }
  return (
    <button
      type="button"
      className={styles.button}
      onClick={handleClick}
      aria-label="Change lens list"
      title="Change lens list"
    >
      <span className={styles.icon} aria-hidden>◴</span>
      <span className={styles.label}>{label}</span>
      <span className={styles.caret} aria-hidden>▾</span>
    </button>
  )
}
