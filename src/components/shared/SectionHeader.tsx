import styles from './SectionHeader.module.css'

interface SectionHeaderProps {
  label: string
  count: number
  accentColor?: string
  collapsed: boolean
  onToggle: () => void
}

export function SectionHeader({ label, count, accentColor, collapsed, onToggle }: SectionHeaderProps) {
  return (
    <div className={styles.header} onClick={onToggle}>
      <span className={`${styles.chevron} ${collapsed ? styles.collapsed : ''}`}>▾</span>
      {accentColor && <span className={styles.accent} style={{ background: accentColor }} />}
      <span className={styles.label}>{label}</span>
      <span className={styles.count}>{count}</span>
    </div>
  )
}
