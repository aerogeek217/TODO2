import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react'
import Fuse, { type FuseResult, type FuseResultMatch } from 'fuse.js'
import type { Command, CommandCategory } from '../../services/command-registry'
import { DialogFrame } from '../shared/Dialog'
import styles from './CommandPalette.module.css'

interface CommandPaletteProps {
  commands: Command[]
  /** Lazy search for dynamic commands (tasks) — only called when query is non-empty */
  onSearchDynamic?: (query: string) => Command[]
  onClose: () => void
}

const CATEGORY_ORDER: CommandCategory[] = ['navigation', 'layout', 'task', 'bulk', 'filter', 'search-results']
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  layout: 'Layouts',
  task: 'Tasks',
  bulk: 'Bulk Actions',
  filter: 'Filters',
  'search-results': 'Search Results',
}

/** Max dynamic results (tasks) to show to avoid overwhelming the list */
const MAX_DYNAMIC_RESULTS = 20

/** Between a step command's name and one of its own in a path (`Go to Layout › Planning`). */
const PATH_SEPARATOR = ' › '

const FUSE_OPTIONS = { threshold: 0.4, includeMatches: true, includeScore: true } as const

/**
 * Fuzzy-match the commands. One word is matched as typed. With several words,
 * each word must match the command on its own (in any order), so `clear
 * filters` finds `Clear All Filters` — a fuzzy match of the whole phrase can't
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

/** A command inside a step, as the top level's search reaches it: named by its path. */
interface StepLeaf {
  /** The command as listed at the top level: its path as its name (`Go to Layout › Planning`). */
  item: Command
  /** The step command's name, and the leaf's own. */
  parent: string
  own: string
}

/** Every leaf of `commands`' steps (`StepLeaf`), in order. */
function stepLeaves(commands: readonly Command[]): StepLeaf[] {
  return commands.flatMap((parent) => (parent.step ?? []).map((leaf): StepLeaf => ({
    item: { ...leaf, name: `${parent.name}${PATH_SEPARATOR}${leaf.name}` },
    parent: parent.name,
    own: leaf.name,
  })))
}

/** `match`'s indices moved `by` characters right (an own name's, onto its place in the path). */
function shiftMatch(match: FuseResultMatch, by: number): FuseResultMatch {
  return { ...match, key: 'name', indices: match.indices.map(([a, b]) => [a + by, b + by] as [number, number]) }
}

/**
 * The top level's search into the steps: each word must match a leaf's own
 * name or its step's (`aisha` finds `Review With › Aisha Rahman` and any other leaf so named,
 * `review aisha` only that one), each counting where it
 * matches better, and at least one word must match the leaf's own name
 * better — so words that name the step (`layout`, `go to lay`) find the
 * step, not every leaf in it. Scored as `searchCommands` scores, the
 * matches on the path shown.
 */
function searchStepLeaves(leaves: readonly StepLeaf[], ownFuse: Fuse<StepLeaf>, parentFuse: Fuse<StepLeaf>, query: string): FuseResult<Command>[] {
  const words = query.split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const own = words.map((w) => new Map(ownFuse.search(w).map((r) => [r.refIndex, r])))
  const parent = words.map((w) => new Map(parentFuse.search(w).map((r) => [r.refIndex, r])))
  const results: FuseResult<Command>[] = []
  leaves.forEach((leaf, refIndex) => {
    let score = 0
    let ownWords = 0
    const matches: FuseResultMatch[] = []
    for (let i = 0; i < words.length; i++) {
      const o = own[i]?.get(refIndex)
      const p = parent[i]?.get(refIndex)
      if (o && (!p || (o.score ?? 1) <= (p.score ?? 1))) {
        ownWords++
        score += o.score ?? 1
        matches.push(...(o.matches ?? []).map((m) => shiftMatch(m, leaf.parent.length + PATH_SEPARATOR.length)))
      } else if (p) {
        score += p.score ?? 1
        matches.push(...(p.matches ?? []).map((m) => shiftMatch(m, 0)))
      } else {
        return
      }
    }
    if (ownWords > 0) results.push({ item: leaf.item, refIndex, score, matches })
  })
  return results.sort((a, b) => (a.score ?? 1) - (b.score ?? 1) || a.refIndex - b.refIndex)
}

/**
 * `name` with the characters at `indices` marked. Fuse's indices are UTF-16
 * offsets: walked by code point (an emoji is two units), a character is marked
 * when any of its units is.
 */
function highlightMatches(name: string, indices: ReadonlySet<number>): ReactNode[] {
  const parts: ReactNode[] = []
  let offset = 0
  for (const ch of name) {
    const at = offset
    offset += ch.length
    let hit = false
    for (let i = at; i < offset; i++) if (indices.has(i)) hit = true
    parts.push(hit ? <mark key={at} className={styles.highlight}>{ch}</mark> : ch)
  }
  return parts
}

/** A group of rows under its heading (`label`; none shown when `heading` is false). */
interface ResultGroup {
  key: string
  label: string
  heading: boolean
  items: Command[]
}

/** `results` grouped by category, in `CATEGORY_ORDER`, each keeping the results' order. */
function groupByCategory(results: readonly Command[]): ResultGroup[] {
  const groups: ResultGroup[] = []
  const seen = new Set<CommandCategory>()
  const order = [...CATEGORY_ORDER, ...results.map((r) => r.category)]
  for (const cat of order) {
    if (seen.has(cat)) continue
    seen.add(cat)
    const items = results.filter((r) => r.category === cat)
    if (items.length > 0) groups.push({ key: cat, label: CATEGORY_LABELS[cat] ?? cat, heading: true, items })
  }
  return groups
}

/** A step's rows grouped by their `group` (Add Widget ›'s Tasks / Insights) in first-seen order; ungrouped rows under the step's name, no heading. */
function groupByStepGroup(results: readonly Command[], stepName: string): ResultGroup[] {
  const groups: ResultGroup[] = []
  for (const cmd of results) {
    const key = cmd.group ?? ''
    const group = groups.find((g) => g.key === key)
    if (group) group.items.push(cmd)
    else groups.push({ key, label: cmd.group ?? stepName, heading: cmd.group != null, items: [cmd] })
  }
  return groups
}

/** An open step: the command whose step it is, and the query typed when it opened (given back on the way out). */
interface OpenStep {
  command: Command
  query: string
}

/**
 * The command palette (`Ctrl+K`): find tasks and commands. A command with a
 * `step` (`Go to Layout ›`) opens a second list in the same palette under a
 * breadcrumb: typing filters it, Enter runs a leaf, Backspace in the empty
 * field (or Esc) goes back a step. The focus stays in the field while
 * stepping; it goes back to what had it when a leaf runs or the palette
 * closes. At the top level the search also reaches into the steps
 * (`planning` → `Go to Layout › Planning`); at rest it lists the step
 * commands, not what is in them.
 */
export function CommandPalette({ commands, onSearchDynamic, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [steps, setSteps] = useState<OpenStep[]>([])
  // After a step back: the row to make active once the parent's rows are in.
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeItemRef = useRef<HTMLDivElement>(null)
  const listboxId = 'command-palette-listbox'
  const crumbId = 'command-palette-crumb'
  const optionId = (idx: number) => `command-palette-option-${idx}`

  const step = steps.at(-1)?.command
  // A step's own commands, else the top level's; kept current as the list is rebuilt.
  const stepCommands = useMemo<readonly Command[] | null>(
    () => (step ? commands.find((c) => c.id === step.id)?.step ?? step.step ?? [] : null),
    [commands, step],
  )

  // > prefix = commands only (no task search); inside a step there is none.
  const isCommandMode = query.startsWith('>')
  const searchQuery = isCommandMode ? query.slice(1).trim() : query.trim()

  const scope = stepCommands ?? commands
  const fuse = useMemo(
    () => new Fuse<Command>([...scope], { ...FUSE_OPTIONS, keys: stepCommands ? ['name'] : ['name', 'category'] }),
    [scope, stepCommands],
  )
  const leaves = useMemo(() => (stepCommands ? [] : stepLeaves(commands)), [commands, stepCommands])
  const leafFuses = useMemo(() => ({
    own: new Fuse(leaves, { ...FUSE_OPTIONS, keys: ['own'] }),
    parent: new Fuse(leaves, { ...FUSE_OPTIONS, keys: ['parent'] }),
  }), [leaves])

  const fuseResults = useMemo(() => {
    const own = searchCommands(fuse, searchQuery)
    if (stepCommands || !searchQuery) return own
    // The leaves after the commands they score with: a step command and its leaf tie on the step's name.
    const inSteps = searchStepLeaves(leaves, leafFuses.own, leafFuses.parent, searchQuery)
    return [...own, ...inSteps].map((r, i) => ({ r, i }))
      .sort((a, b) => (a.r.score ?? 1) - (b.r.score ?? 1) || a.i - b.i)
      .map(({ r }) => r)
  }, [fuse, searchQuery, stepCommands, leaves, leafFuses])

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
      // No query: a step's commands, or the top level's (its steps closed, no tasks).
      return stepCommands ? [...stepCommands] : commands.filter((c) => c.category !== 'search-results')
    }

    // Static commands via fuzzy search
    const items = fuseResults.map((r) => r.item)

    // Merge lazily-searched dynamic commands (tasks) unless in command-only mode or in a step
    if (!isCommandMode && !stepCommands && onSearchDynamic) {
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
  }, [searchQuery, fuseResults, commands, stepCommands, isCommandMode, onSearchDynamic])

  const grouped = useMemo(
    () => (step ? groupByStepGroup(results, step.name) : groupByCategory(results)),
    [results, step],
  )

  // Flat list for keyboard navigation
  const flatResults = useMemo(() => grouped.flatMap((g) => g.items), [grouped])

  // A step back: the step command it came from is the active row again.
  if (restoreId != null) {
    setRestoreId(null)
    setActiveIndex(Math.max(0, flatResults.findIndex((c) => c.id === restoreId)))
  }

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, steps])

  // What had the focus when the palette opened (read before its field takes it).
  const [opener] = useState(() => (typeof document !== 'undefined' ? document.activeElement as HTMLElement | null : null))
  const executeCommand = (cmd: Command) => {
    if (cmd.step) {
      // A step opens in place: the field keeps the focus, empty for the new list.
      setSteps((s) => [...s, { command: cmd, query }])
      setQuery('')
      setActiveIndex(0)
      inputRef.current?.focus()
      return
    }
    // The focus goes back first, so a dialog the command opens takes that as
    // its opener and returns the focus there on close — not to this field,
    // gone by then (cr31 N5).
    if (opener && opener !== document.body && opener.isConnected) opener.focus({ preventScroll: true })
    cmd.action()
    onClose()
  }

  /** Back to the list the open step came from, its query as it was and the step command active. */
  const stepBack = () => {
    const last = steps.at(-1)
    if (!last) return
    setSteps((s) => s.slice(0, -1))
    setQuery(last.query)
    setRestoreId(last.command.id)
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
    } else if (step && (e.key === 'Escape' || (e.key === 'Backspace' && query === ''))) {
      // Claimed before the frame's Esc: one step back, the palette stays open.
      e.preventDefault()
      stepBack()
    }
  }

  let flatIndex = 0

  const activeOptionId = flatResults.length > 0 ? optionId(activeIndex) : undefined

  return (
    // The shared frame: Esc (from anywhere in it), a backdrop press, Tab
    // kept inside, focus back to where it was (unless a command moved it).
    <DialogFrame
      onClose={onClose}
      layer="overlay"
      className={styles.card}
      backdropClassName={styles.backdrop}
      // Top-anchored, not centred.
      style={{ marginTop: '10vh' }}
      initialFocus={inputRef}
      aria-label="Command palette"
    >
        <div className={styles.inputRow}>
          {step && (
            <span className={styles.crumb} id={crumbId} data-testid="command-palette-crumb">
              {steps.map((s) => s.command.name).join(PATH_SEPARATOR)}
              <span className={styles.crumbSeparator} aria-hidden="true">›</span>
            </span>
          )}
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
            placeholder={step ? 'Type to filter…' : 'Find tasks, commands… (> for commands only)'}
            role="combobox"
            aria-expanded
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={activeOptionId}
            aria-describedby={step ? crumbId : undefined}
            autoFocus
          />
        </div>

        <div className={styles.results} role="listbox" id={listboxId} aria-label={step?.name}>
          {flatResults.length === 0 && (
            <div className={styles.empty}>No matching results</div>
          )}
          {grouped.map((group) => (
            <div key={group.key} role="group" aria-label={group.label}>
              {group.heading && <div className={styles.sectionHeader}>{group.label}</div>}
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
                    aria-haspopup={cmd.step ? 'listbox' : undefined}
                    className={`${styles.resultItem} ${isActive ? styles.active : ''}`}
                    // The field keeps the focus (a step opens under it; a leaf gives it back first).
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => executeCommand(cmd)}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <span className={styles.resultName}>
                      {(() => {
                        const indices = matchIndicesMap.get(cmd.id)
                        if (!indices || indices.size === 0) return cmd.name
                        return highlightMatches(cmd.name, indices)
                      })()}
                    </span>
                    {cmd.hint && <span className={styles.resultHint}>{cmd.hint}</span>}
                    {cmd.current && <span className={styles.resultCurrent}>Current</span>}
                    {cmd.shortcut && <span className={styles.resultShortcut}>{cmd.shortcut}</span>}
                    {cmd.step && <span className={styles.resultStep} aria-hidden="true">›</span>}
                  </div>
                )
              })}
            </div>
          ))}
        </div>

        <div className={styles.footer}>
          <span><span className={styles.footerKey}>↑↓</span> Navigate</span>
          <span><span className={styles.footerKey}>Enter</span> Select</span>
          {step ? (
            <span><span className={styles.footerKey}>Backspace</span> or <span className={styles.footerKey}>Esc</span> Back</span>
          ) : (
            <>
              <span><span className={styles.footerKey}>Esc</span> Close</span>
              <span><span className={styles.footerKey}>&gt;</span> Commands only</span>
            </>
          )}
        </div>
    </DialogFrame>
  )
}
