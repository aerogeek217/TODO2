import { useState, useRef, useEffect, useId, useLayoutEffect } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import styles from './ChipSelector.module.css'
import { byName } from '../../utils/sort-order'
import { useUndoStore } from '../../stores/undo-store'

export interface ChipItem {
  id: number
  name: string
  color?: string
  /** People only: the avatar initials (the first letter shows). */
  initials?: string
}

interface ChipSelectorProps {
  items: ChipItem[]
  selectedIds: Set<number>
  onToggle: (id: number) => void
  /**
   * Offers `Create "<query>"` when the query matches no name exactly (any
   * case). A returned promise that rejects is reported in the snackbar.
   */
  onCreate?: (name: string) => void | Promise<unknown>
  placeholder?: string
  /** Esc closes the picker (the host owns the open state). */
  onClose?: () => void
  /** Person picker: an avatar per row (filled with the person's color) and an
   * avatar preview on the create row. */
  avatars?: boolean
}

type Row = { kind: 'item'; item: ChipItem } | { kind: 'create'; name: string }

function avatarLetter(item: Pick<ChipItem, 'name' | 'initials'>): string {
  return (item.initials || item.name).trim().charAt(0).toUpperCase()
}

/** `name` with the first case-insensitive occurrence of `query` wrapped in a mark. */
function Highlighted({ name, query }: { name: string; query: string }) {
  const lower = name.toLowerCase()
  const at = query ? lower.indexOf(query) : -1
  // Case folding that changes length would misalign the slice — skip the mark.
  if (at < 0 || lower.length !== name.length) return <>{name}</>
  return (
    <>
      {name.slice(0, at)}
      <mark className={styles.match}>{name.slice(at, at + query.length)}</mark>
      {name.slice(at + query.length)}
    </>
  )
}

/**
 * Lookup-or-create picker: a search input over an alphabetical list with a
 * check per assigned item, and a `Create "<query>"` row when nothing matches
 * the query exactly. Matching is a case-insensitive substring of the name.
 * Keyboard: ↑/↓ move the active row (wrapping), ⏎ toggles it (or creates),
 * Esc calls `onClose`. After a create the query clears and the picker stays
 * open. Used for people (`avatars`) and tags.
 */
export function ChipSelector({
  items, selectedIds, onToggle, onCreate, placeholder = 'Search...', onClose, avatars,
}: ChipSelectorProps) {
  const [query, setQuery] = useState('')
  /** Explicitly chosen active row; `null` = the default for the query. */
  const [activeChoice, setActiveChoice] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const listId = useId()

  // Focus the search on open, remembering what had focus. A passive effect, so
  // a menu that opened the picker (e.g. the task menu's Assign people…) has
  // already handed focus back to its trigger.
  useEffect(() => {
    const previous = document.activeElement
    if (previous instanceof HTMLElement && previous !== document.body && !containerRef.current?.contains(previous)) {
      returnFocusRef.current = previous
    }
    inputRef.current?.focus()
  }, [])
  // On close hand focus back, unless something else took it. A layout-effect
  // cleanup runs before the host re-renders, while a trigger revealed only
  // during the open state (the row's ⋯) can still take focus.
  useLayoutEffect(() => {
    const container = containerRef.current
    return () => {
      const target = returnFocusRef.current
      const active = document.activeElement
      const focusIsOurs = !active || active === document.body || !active.isConnected || !!container?.contains(active)
      if (target && target.isConnected && focusIsOurs) target.focus({ preventScroll: true })
    }
  }, [])

  const lowerQuery = query.toLowerCase().trim()
  const sorted = [...items].sort(byName)
  const filtered = lowerQuery
    ? sorted.filter(item => item.name.toLowerCase().includes(lowerQuery))
    : sorted

  const exactIndex = filtered.findIndex(item => item.name.trim().toLowerCase() === lowerQuery)
  const showCreate = !!onCreate && lowerQuery.length > 0 && exactIndex < 0

  const rows: Row[] = filtered.map((item): Row => ({ kind: 'item', item }))
  if (showCreate) rows.push({ kind: 'create', name: query.trim() })

  const defaultActive = exactIndex >= 0 ? exactIndex : 0
  const active = rows.length === 0 ? -1 : Math.min(activeChoice ?? defaultActive, rows.length - 1)
  const optionId = (index: number) => `${listId}-opt-${index}`

  useEffect(() => {
    if (active < 0) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const create = (name: string) => {
    if (!onCreate) return
    setQuery('')
    setActiveChoice(null)
    // Any returned promise (or thenable) that rejects is reported.
    Promise.resolve(onCreate(name)).catch((err: unknown) => {
      console.warn('[chip-selector] create failed', err)
      useUndoStore.getState().notify(`Couldn't create "${name}".`)
    })
  }

  const activate = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === 'item') onToggle(row.item.id)
    else create(row.name)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActiveChoice((Math.max(active, 0) + step + rows.length) % rows.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(rows[active])
    } else if (e.key === 'Escape' && onClose) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div ref={containerRef} className={`${styles.container} ${avatars ? styles.people : ''}`}>
      <input
        ref={inputRef}
        className={styles.searchInput}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setActiveChoice(null) }}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        placeholder={placeholder}
        maxLength={200}
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? optionId(active) : undefined}
      />
      <div ref={listRef} id={listId} className={styles.list} role="listbox" aria-multiselectable="true">
        {rows.map((row, index) => {
          const isActive = index === active
          // Mouse-down keeps focus in the search input.
          const common = {
            id: optionId(index),
            'data-index': index,
            'data-active': isActive ? '' : undefined,
            role: 'option',
            onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
            onMouseMove: () => { if (!isActive) setActiveChoice(index) },
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); activate(row) },
          }
          if (row.kind === 'create') {
            return (
              <div
                key="create"
                {...common}
                aria-selected={false}
                className={`${styles.item} ${styles.createItem} ${filtered.length > 0 ? styles.createSeparated : ''} ${isActive ? styles.active : ''}`}
              >
                <span className={styles.plus} aria-hidden="true">+</span>
                {avatars && (
                  <span className={`${styles.avatar} ${styles.avatarNew}`} aria-hidden="true">
                    {avatarLetter({ name: row.name })}
                  </span>
                )}
                <span className={styles.name}>Create &quot;{row.name}&quot;</span>
                {isActive && <span className={styles.enterHint} aria-hidden="true">⏎</span>}
              </div>
            )
          }
          const { item } = row
          const selected = selectedIds.has(item.id)
          return (
            <div
              key={item.id}
              {...common}
              aria-selected={selected}
              className={`${styles.item} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.check} aria-hidden="true">{selected ? '✓' : ''}</span>
              {avatars && (
                <span
                  className={styles.avatar}
                  style={{ background: item.color || NEUTRAL_PERSON_COLOR }}
                  aria-hidden="true"
                >
                  {avatarLetter(item)}
                </span>
              )}
              <span
                className={styles.name}
                style={!avatars && item.color ? { color: item.color } : undefined}
              >
                <Highlighted name={item.name} query={lowerQuery} />
              </span>
              {isActive && lowerQuery && <span className={styles.enterHint} aria-hidden="true">⏎</span>}
            </div>
          )
        })}
        {rows.length === 0 && (
          <div className={styles.empty}>No matches</div>
        )}
      </div>
    </div>
  )
}
