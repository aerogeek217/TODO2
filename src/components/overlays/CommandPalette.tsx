import { useState, useRef, useEffect, useMemo } from 'react'
import Fuse, { type FuseResult } from 'fuse.js'
import type { Command, CommandCategory } from '../../services/command-registry'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  commands: Command[]
  /** Lazy search for dynamic commands (tasks) — only called when query is non-empty */
  onSearchDynamic?: (query: string) => Command[]
  onClose: () => void
}

const CATEGORY_ORDER: CommandCategory[] = ['navigation', 'task', 'bulk', 'filter', 'email', 'search-results']
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  task: 'Tasks',
  bulk: 'Bulk Actions',
  filter: 'Filters',
  email: 'Email',
  'search-results': 'Search Results',
}

/** Max dynamic results (tasks) to show to avoid overwhelming the list */
const MAX_DYNAMIC_RESULTS = 20

/**
 * Fuzzy-match the commands. One word is matched as typed. With several words,
 * each word must match the command on its own (in any order), so `email mar`
 * finds `Email check-in: Marcus Chen` — a fuzzy match of the whole phrase can't
 * skip the text between the words. A command's score is the sum of its
 * one-word scores (lower is better), so the word that matches it worst decides
 * its rank; ties keep the command order. Fuse's own multi-term search isn't
 * used: its scores multiply, and an exact word in a short name then outranks
 * a better match of the other words.
 */
function searchCommands(fuse: Fuse<Command>, query: string): FuseResult<Command>[] {
  if (!query) return []
  const words = query.split(/\s+/).filter(Boolean)
  if (words.length <= 1) return fuse.search(query)
  const perWord = words.map((w) => new Map(fuse.search(w).map((r) => [r.refIndex, r])))
  const [first = new Map<number, FuseResult<Command>>(), ...rest] = perWord
  const combined: FuseResult<Command>[] = []
  for (const [refIndex, hit] of first) {
    const hits = [hit, ...rest.flatMap((m) => m.get(refIndex) ?? [])]
    if (hits.length < perWord.length) continue
    combined.push({
      item: hit.item,
      refIndex,
      score: hits.reduce((sum, h) => sum + (h.score ?? 1), 0),
      matches: hits.flatMap((h) => h.matches ?? []),
    })
  }
  return combined.sort((a, b) => (a.score ?? 1) - (b.score ?? 1) || a.refIndex - b.refIndex)
}

export function CommandPalette({ commands, onSearchDynamic, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLDivElement>(null)
  const listboxId = 'command-palette-listbox'
  const optionId = (idx: number) => `command-palette-option-${idx}`

  // > prefix = commands only (no task search)
  const isCommandMode = query.startsWith('>')
  const searchQuery = isCommandMode ? query.slice(1).trim() : query.trim()

  const fuse = useMemo(
    () => new Fuse(commands, { keys: ['name', 'category'], threshold: 0.4, includeMatches: true, includeScore: true }),
    [commands]
  )

  const fuseResults = useMemo(() => searchCommands(fuse, searchQuery), [fuse, searchQuery])

  /** Map from command id to matched character indices in the name field */
  const matchIndicesMap = useMemo(() => {
    const map = new Map<string, Set<number>>()
    for (const r of fuseResults) {
      const indices = new Set<number>()
      // A multi-word query matches each word separately, so the name can have several matches.
      for (const m of r.matches ?? []) {
        if (m.key !== 'name') continue
        for (const [start, end] of m.indices) {
          for (let i = start; i <= end; i++) indices.add(i)
        }
      }
      if (indices.size > 0) map.set(r.item.id, indices)
    }
    return map
  }, [fuseResults])

  const results = useMemo(() => {
    if (!searchQuery) {
      // No query: show static commands only
      return commands.filter((c) => c.category !== 'search-results')
    }

    // Static commands via fuzzy search
    const items = fuseResults.map((r) => r.item)

    // Merge lazily-searched dynamic commands (tasks) unless in command-only mode
    if (!isCommandMode && onSearchDynamic) {
      const dynamic = onSearchDynamic(searchQuery)
      items.push(...dynamic)
    }

    // Cap dynamic results
    const commandResults: Command[] = []
    let taskCount = 0
    for (const item of items) {
      if (item.category === 'search-results') {
        if (taskCount >= MAX_DYNAMIC_RESULTS) continue
        taskCount++
      }
      commandResults.push(item)
    }
    return commandResults
  }, [searchQuery, fuseResults, commands, isCommandMode, onSearchDynamic])

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
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const executeCommand = (cmd: Command) => {
    cmd.action()
    onClose()
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

  const activeOptionId = flatResults.length > 0 ? optionId(activeIndex) : undefined

  return (
    <div className={styles.backdrop} onClick={handleBackdropClick}>
      <div className={styles.card} role="dialog" aria-modal="true" aria-label="Command palette">
        <div className={styles.inputRow}>
          <input
            ref={inputRef}
            className={styles.input}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              // A new query starts at its first result.
              setActiveIndex(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search tasks, commands... (> for commands only)"
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            autoFocus
          />
        </div>

        <div className={styles.results} role="listbox" id={listboxId}>
          {flatResults.length === 0 && (
            <div className={styles.empty}>No matching results</div>
          )}
          {grouped.map((group) => (
            <div key={group.category} role="group" aria-label={group.label}>
              <div className={styles.sectionHeader}>{group.label}</div>
              {group.items.map((cmd) => {
                const idx = flatIndex++
                const isActive = idx === activeIndex
                return (
                  <div
                    key={cmd.id}
                    id={optionId(idx)}
                    ref={isActive ? activeItemRef : undefined}
                    role="option"
                    aria-selected={isActive}
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
                    {cmd.hint && <span className={styles.resultHint}>{cmd.hint}</span>}
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
