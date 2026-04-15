import { useEffect, useRef, useState } from 'react'
import styles from './ProjectPicker.module.css'

interface ProjectItem {
  id?: number
  name: string
  color?: string
}

interface ProjectPickerProps {
  projectId: number | undefined
  projects: ProjectItem[]
  onSelect: (id: number | undefined) => void
  autoFocus?: boolean
}

export function ProjectPicker({ projectId, projects, onSelect, autoFocus }: ProjectPickerProps) {
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) searchRef.current?.focus()
  }, [autoFocus])

  const filtered = projects
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))
    .toSorted((a, b) => a.name.localeCompare(b.name))

  return (
    <div className={styles.picker}>
      <input
        ref={searchRef}
        className={styles.searchInput}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        placeholder="Search projects..."
        maxLength={200}
      />
      <div className={styles.list}>
        {!search && (
          <button
            className={`${styles.option} ${!projectId ? styles.optionActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelect(undefined) }}
          >
            <span className={styles.dot} style={{ background: 'var(--color-text-muted)' }} />
            No project
          </button>
        )}
        {filtered.map(p => (
          <button
            key={p.id}
            className={`${styles.option} ${projectId === p.id ? styles.optionActive : ''}`}
            onClick={(e) => { e.stopPropagation(); onSelect(p.id) }}
          >
            <span className={styles.dot} style={{ background: p.color || 'var(--color-text-muted)' }} />
            {p.name}
          </button>
        ))}
      </div>
    </div>
  )
}
