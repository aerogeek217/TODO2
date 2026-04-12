import { useState, useRef, useEffect } from 'react'
import styles from './ChipSelector.module.css'

export interface ChipItem {
  id: number
  name: string
  color?: string
}

interface ChipSelectorProps {
  items: ChipItem[]
  selectedIds: Set<number>
  onToggle: (id: number) => void
  onCreate?: (name: string) => void
  placeholder?: string
}

export function ChipSelector({ items, selectedIds, onToggle, onCreate, placeholder = 'Search...' }: ChipSelectorProps) {
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const lowerQuery = query.toLowerCase().trim()
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name))
  const filtered = lowerQuery
    ? sorted.filter(item => item.name.toLowerCase().includes(lowerQuery))
    : sorted

  const exactMatch = items.some(item => item.name.toLowerCase() === lowerQuery)
  const showCreate = onCreate && lowerQuery && !exactMatch

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'Enter' && showCreate) {
      onCreate(query.trim())
      setQuery('')
    }
  }

  return (
    <div className={styles.container}>
      <input
        ref={inputRef}
        className={styles.searchInput}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
        maxLength={200}
      />
      <div className={styles.list}>
        {filtered.map((item) => (
          <button
            key={item.id}
            className={styles.item}
            onClick={(e) => { e.stopPropagation(); onToggle(item.id) }}
          >
            <span className={styles.check}>{selectedIds.has(item.id) ? '\u2713' : ''}</span>
            <span style={item.color ? { color: item.color } : undefined}>{item.name}</span>
          </button>
        ))}
        {filtered.length === 0 && !showCreate && (
          <div className={styles.empty}>No matches</div>
        )}
        {showCreate && (
          <button
            className={`${styles.item} ${styles.createItem}`}
            onClick={(e) => { e.stopPropagation(); onCreate(query.trim()); setQuery('') }}
          >
            + Create "{query.trim()}"
          </button>
        )}
      </div>
    </div>
  )
}
