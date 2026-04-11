import { useState, useRef, useEffect, useMemo } from 'react'
import Fuse from 'fuse.js'
import type { Command, CommandCategory } from '../../services/command-registry'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  commands: Command[]
  onClose: () => void
}

const CATEGORY_ORDER: CommandCategory[] = ['navigation', 'task', 'bulk', 'filter', 'projects', 'tasks']
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  task: 'Tasks',
  bulk: 'Bulk Actions',
  filter: 'Filters',
  projects: 'Projects',
  tasks: 'Search Results',
}

/** Max dynamic results (tasks/projects) to show to avoid overwhelming the list */
const MAX_DYNAMIC_RESULTS = 20

export function CommandPalette({ commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLDivElement>(null)

  // > prefix = commands only (no task/project search)
  const isCommandMode = query.startsWith('>')
  const searchQuery = isCommandMode ? query.slice(1).trim() : query.trim()

  const searchableCommands = useMemo(() => {
    if (isCommandMode) {
      return commands.filter((c) => c.category !== 'tasks' && c.category !== 'projects')
    }
    return commands
  }, [commands, isCommandMode])

  const fuse = useMemo(
    () => new Fuse(searchableCommands, { keys: ['name', 'category'], threshold: 0.4, includeMatches: true }),
    [searchableCommands]
  )

  /** Map from command id to matched character indices in the name field */
  const matchIndicesMap = useMemo(() => {
    const map = new Map<string, Set<number>>()
    if (!searchQuery) return map
    const fuseResults = fuse.search(searchQuery)
    for (const r of fuseResults) {
      const nameMatch = r.matches?.find(m => m.key === 'name')
      if (nameMatch?.indices) {
        const indices = new Set<number>()
        for (const [start, end] of nameMatch.indices) {
          for (let i = start; i <= end; i++) indices.add(i)
        }
        map.set(r.item.id, indices)
      }
    }
    return map
  }, [searchQuery, fuse])

  const results = useMemo(() => {
    let items: Command[]
    if (!searchQuery) {
      // No query: show commands (not tasks/projects — too many)
      items = commands.filter((c) => c.category !== 'tasks' && c.category !== 'projects')
    } else {
      items = fuse.search(searchQuery).map((r) => r.item)
    }

    // Cap dynamic results
    const commandResults: Command[] = []
    let taskCount = 0
    let projectCount = 0
    for (const item of items) {
      if (item.category === 'tasks') {
        if (taskCount >= MAX_DYNAMIC_RESULTS) continue
        taskCount++
      } else if (item.category === 'projects') {
        if (projectCount >= MAX_DYNAMIC_RESULTS) continue
        projectCount++
      }
      commandResults.push(item)
    }
    return commandResults
  }, [searchQuery, fuse, commands])

  // Group results by category, preserving order
  const grouped = useMemo(() => {
    const groups: { category: CommandCategory; label: string; items: Command[] }[] = []
    const seen = new Set<CommandCategory>()

    for (const cat of CATEGORY_ORDER) {
      const items = results.filter((r) => r.category === cat)
      if (items.length > 0) {
        groups.push({ category: cat, label: CATEGORY_LABELS[cat], items })
        seen.add(cat)
      }
    }
    // Any categories not in the predefined order
    for (const item of results) {
      if (!seen.has(item.category)) {
        groups.push({ category: item.category, label: item.category, items: results.filter((r) => r.category === item.category) })
        seen.add(item.category)
      }
    }
    return groups
  }, [results])

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setActiveIndex(0)
  }, [query])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const executeCommand = (cmd: Command) => {
    onClose()
    cmd.action()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, flatResults.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && flatResults[activeIndex]) {
      e.preventDefault()
      executeCommand(flatResults[activeIndex])
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose()
  }

  let flatIndex = 0

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.card}>
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, projects, commands... (> for commands only)"
          />
        </div>

        <div className={styles.results}>
          {flatResults.length === 0 && (
            <div className={styles.empty}>No matching results</div>
          )}
          {grouped.map((group) => (
            <div key={group.category}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.items.map((cmd) => {
                const idx = flatIndex++
                const isActive = idx === activeIndex
                return (
                  <div
                    key={cmd.id}
                    ref={isActive ? activeItemRef : undefined}
                    className={`${styles.resultItem} ${isActive ? styles.active : ''}`}
                    onClick={() => executeCommand(cmd)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <span className={styles.resultName}>
                      {(() => {
                        const indices = matchIndicesMap.get(cmd.id)
                        if (!indices || indices.size === 0) return cmd.name
                        return Array.from(cmd.name).map((ch, i) =>
                          indices.has(i)
                            ? <mark key={i} className={styles.highlight}>{ch}</mark>
                            : ch
                        )
                      })()}
                    </span>
                    {cmd.shortcut && <span className={styles.resultShortcut}>{cmd.shortcut}</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <span><span className={styles.footerKey}>↑↓</span> Navigate</span>
          <span><span className={styles.footerKey}>Enter</span> Select</span>
          <span><span className={styles.footerKey}>Esc</span> Close</span>
          <span><span className={styles.footerKey}>&gt;</span> Commands only</span>
        </div>
      </div>
    </div>
  )
}
