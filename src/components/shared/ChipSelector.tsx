import { useState, useRef, useEffect, useId, useLayoutEffect } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import styles from './ChipSelector.module.css'
import { byName } from '../../utils/sort-order'
import { useUndoStore } from '../../stores/undo-store'
import { PickerEntityMenu } from './EntityMenu'
import { ClearableField } from './ClearableField'
import { splitOnTop, usePickerOrder } from '../../hooks/use-picker-order'

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
  /**
   * The items are people / tags: right-click on an option, or Shift+F10 / the
   * context-menu key on the highlighted one, opens its Show tasks · Edit… ·
   * Delete… menu over the picker (Show tasks closes the picker via `onClose`).
   */
  entityMenu?: 'person' | 'tag'
}

type Row = { kind: 'item'; item: ChipItem } | { kind: 'create'; name: string }

/** What a row stands for across re-sorts: the item's id, or the Create row. */
type RowKey = number | 'create'
const rowKey = (row: Row): RowKey => (row.kind === 'item' ? row.item.id : 'create')

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
 * Lookup-or-create picker: a search input over a list with a check per
 * assigned item — the assigned items first (alphabetical), a separator, then
 * the rest (alphabetical) — and a `Create "<query>"` row when nothing matches
 * the query exactly. Matching is a case-insensitive substring of the name.
 * The order is fixed on open and whenever the query changes
 * (`usePickerOrder`): a tick with the query unchanged never moves a row.
 * A pick (click, ⏎) with a query typed clears the query — the whole list
 * shows again, re-sorted, the picked row still highlighted (⏎ again undoes
 * it) and the focus kept in the search.
 * Keyboard: ↑/↓ move the active row (wrapping), ⏎ toggles it (or creates),
 * Tab — while a query is typed — accepts it: assigns it (never unassigns a
 * ticked one) or creates the Create row's, then clears the query (no query:
 * Tab moves on as usual); Esc calls `onClose`; the search's × empties it. After a create the query
 * clears and the picker stays open. Used for people (`avatars`) and tags. With `entityMenu`, an option's
 * context menu is the person's / tag's menu — it never picks the option; Esc
 * closes just the menu. A right-click anywhere else in the picker never
 * reaches what the picker opened from.
 */
export function ChipSelector({
  items, selectedIds, onToggle, onCreate, placeholder = 'Search...', onClose, avatars, entityMenu,
}: ChipSelectorProps) {
  const [query, setQuery] = useState('')
  /** Explicitly chosen active row, by what it stands for; `null` = the default for the query. */
  const [activeChoice, setActiveChoice] = useState<RowKey | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const listId = useId()
  /** The option whose entity menu is open, and where. */
  const [menu, setMenu] = useState<{ id: number; x: number; y: number } | null>(null)

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
  // during the open state can still take focus.
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
  const order = usePickerOrder(query, items.map((item) => item.id), (id) => selectedIds.has(id))
  const sorted = [...items].sort(byName)
  const matching = lowerQuery
    ? sorted.filter(item => item.name.toLowerCase().includes(lowerQuery))
    : sorted
  const { top, rest } = splitOnTop(matching, (item) => order.onTop(item.id))
  const filtered = [...top, ...rest]

  const exactIndex = filtered.findIndex(item => item.name.trim().toLowerCase() === lowerQuery)
  const showCreate = !!onCreate && lowerQuery.length > 0 && exactIndex < 0

  const rows: Row[] = filtered.map((item): Row => ({ kind: 'item', item }))
  if (showCreate) rows.push({ kind: 'create', name: query.trim() })

  const defaultActive = exactIndex >= 0 ? exactIndex : 0
  const chosen = activeChoice === null ? -1 : rows.findIndex((row) => rowKey(row) === activeChoice)
  const active = rows.length === 0 ? -1 : Math.min(chosen >= 0 ? chosen : defaultActive, rows.length - 1)
  const optionId = (index: number) => `${listId}-opt-${index}`
  /** The selected block sits above a separator: before the first of the rest. */
  const separatorBefore = top.length > 0 && rest.length > 0 ? top.length : -1

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

  /**
   * Sets item `id` to `selected` (a toggle when that changes it). With a query
   * typed the query clears — the order is fixed again with `id` as picked —
   * and the row stays highlighted wherever it lands.
   */
  const pick = (id: number, selected: boolean) => {
    if (selected !== selectedIds.has(id)) onToggle(id)
    if (query === '') return
    order.notePick(id, selected)
    setQuery('')
    setActiveChoice(id)
  }

  const activate = (row: Row | undefined) => {
    if (!row) return
    if (row.kind === 'item') pick(row.item.id, !selectedIds.has(row.item.id))
    else create(row.name)
  }

  const openMenu = (index: number, x: number, y: number) => {
    const row = rows[index]
    if (!entityMenu || row?.kind !== 'item') return
    setActiveChoice(row.item.id)
    setMenu({ id: row.item.id, x, y })
  }

  // Shift+F10 / the context-menu key in the search field: the highlighted
  // option's menu, under it. A right-click on the field keeps the browser's.
  const handleInputContextMenu = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!entityMenu || e.button === 2 || rows[active]?.kind !== 'item') return
    e.preventDefault()
    const rect = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.getBoundingClientRect()
    openMenu(active, (rect?.left ?? 0) + 16, rect?.bottom ?? 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation()
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (rows.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      const next = rows[(Math.max(active, 0) + step + rows.length) % rows.length]
      if (next) setActiveChoice(rowKey(next))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      activate(rows[active])
    } else if (e.key === 'Tab' && !e.shiftKey && lowerQuery.length > 0 && rows[active]) {
      // Tab accepts the highlighted row, as the `@` / `#` popup does: assigns
      // an item (never unassigns one already ticked) or creates the Create
      // row's; the query clears and the focus stays. With no query typed,
      // Tab moves on as usual (never a Tab trap).
      e.preventDefault()
      const row = rows[active]
      if (row.kind === 'create') {
        create(row.name)
        return
      }
      pick(row.item.id, true)
    } else if (e.key === 'Escape' && onClose) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div ref={containerRef} className={`${styles.container} ${avatars ? styles.people : ''}`}>
      <ClearableField
        className={styles.searchField}
        value={query}
        onClear={() => { setQuery(''); setActiveChoice(null) }}
        inputRef={inputRef}
        label="Clear search"
      >
        <input
          ref={inputRef}
          className={styles.searchInput}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setActiveChoice(null) }}
          onKeyDown={handleKeyDown}
          onClick={(e) => e.stopPropagation()}
          onContextMenu={handleInputContextMenu}
          placeholder={placeholder}
          maxLength={200}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? optionId(active) : undefined}
        />
      </ClearableField>
      <div
        ref={listRef}
        id={listId}
        className={styles.list}
        role="listbox"
        aria-multiselectable="true"
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}
      >
        {rows.map((row, index) => {
          const isActive = index === active
          // Mouse-down keeps focus in the search input.
          const common = {
            id: optionId(index),
            'data-index': index,
            'data-active': isActive ? '' : undefined,
            role: 'option',
            onMouseDown: (e: React.MouseEvent) => e.preventDefault(),
            onMouseMove: () => { if (!isActive) setActiveChoice(rowKey(row)) },
            onClick: (e: React.MouseEvent) => { e.stopPropagation(); activate(row) },
            onContextMenu: (e: React.MouseEvent) => {
              e.preventDefault()
              e.stopPropagation()
              openMenu(index, e.clientX, e.clientY)
            },
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
              className={`${styles.item} ${index === separatorBefore ? styles.restSeparated : ''} ${isActive ? styles.active : ''}`}
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
      {menu && entityMenu && (
        <PickerEntityMenu
          kind={entityMenu}
          id={menu.id}
          point={{ x: menu.x, y: menu.y }}
          onShowTasks={onClose}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
