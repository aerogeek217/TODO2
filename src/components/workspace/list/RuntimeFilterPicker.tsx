import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { RuntimeFilterSpec } from '../../../models/list-definition'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { usePopoverAnchor } from '../../../hooks/use-popover-anchor'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import styles from './RuntimeFilterPicker.module.css'
import { byName } from '../../../utils/sort-order'
import { PopoverRoot } from '../../shared/PopoverRoot'

// All option lookups for this picker go through cached Zustand stores
// (`usePersonStore`, `useStatusStore`, `useTagStore`) — there are no Dexie reads on render or keystroke. Keep it
// that way: the picker is mounted on list widgets during drag-heavy
// interactions, and re-issuing repository queries per keystroke would tank
// the hover/typing path. The vitest companion (`runtime-filter-picker.test.tsx`)
// asserts this contract by failing on any `db.<table>.*` call.

interface Option {
  id: number
  name: string
  /** People: their avatar (initials, colour). */
  avatar?: { initials: string; color?: string }
}

interface RuntimeFilterPickerProps {
  spec: RuntimeFilterSpec
  /** Currently picked ids (OR-combined). Empty / undefined ≡ no narrowing. */
  value: number[] | undefined
  /**
   * Called with the next id list. Always emitted as an array; consumers
   * decide whether to normalize empty → undefined.
   */
  onChange: (value: number[]) => void
  /** The field's input, for an outside "Pick …" action to focus. */
  inputRef?: RefObject<HTMLInputElement | null>
}

function defaultLabel(spec: RuntimeFilterSpec): string {
  switch (spec.field) {
    case 'person': return 'Person'
    case 'status': return 'Status'
    case 'tag': return 'Tag'
  }
}

/**
 * Multi-value picker for a list-def's `runtimeFilter`. Visual shape mirrors
 * `FilterDropdown` (chip-row + searchable option list) but the trigger is the
 * text input itself — it stays visible above the list body so typing the
 * first letter lands without an extra click.
 *
 * Selection semantics: each picked id appears as a chip with a `×`; the
 * underlying value is the chips' id list, OR-combined when the helper
 * applies it (`applyRuntimeFilter`). Empty selection is a no-op (helper
 * passes the predicate through unchanged). A pick while the field has search
 * text clears the text (the focus stays in the field). While anything is picked, a × at
 * the field's end clears every pick at once (the focus stays in the field).
 *
 * Keyboard (as `ChipSelector`): one option is highlighted — the first match
 * while a query is typed, else the last one moved to or picked (none until
 * then); ↑ / ↓ move it (wrapping), Enter toggles it, Tab with a query typed
 * adds it (never removes) and keeps the focus in the field. Tab / Shift+Tab
 * with no query move on as usual.
 */
const NO_IDS: readonly number[] = []

export function RuntimeFilterPicker({ spec, value, onChange, inputRef: outerInputRef }: RuntimeFilterPickerProps) {
  const people = usePersonStore((s) => s.people)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const options = useMemo<Option[]>(() => {
    const base: Option[] = []
    switch (spec.field) {
      case 'person':
        for (const p of people) {
          if (p.id != null) base.push({ id: p.id, name: p.name, avatar: { initials: p.initials || p.name.slice(0, 2).toUpperCase(), color: p.color } })
        }
        break
      case 'status':
        for (const s of statuses) if (s.id != null) base.push({ id: s.id, name: s.name })
        break
      case 'tag':
        for (const t of tags) if (t.id != null) base.push({ id: t.id, name: t.name })
        break
    }
    return base.sort(byName)
  }, [spec.field, people, statuses, tags])

  const ids = value ?? NO_IDS
  const idSet = useMemo(() => new Set(ids), [ids])
  const optionsById = useMemo(() => {
    const map = new Map<number, Option>()
    for (const o of options) map.set(o.id, o)
    return map
  }, [options])

  // Selected entities, in pick order. Unknown ids (entity deleted while a
  // pick referenced it) are skipped — render nothing for them rather than
  // dangling chips.
  const selected = useMemo<Option[]>(() => {
    const out: Option[] = []
    for (const id of ids) {
      const opt = optionsById.get(id)
      if (opt) out.push(opt)
    }
    return out
  }, [ids, optionsById])

  const [searchText, setSearchText] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const ownInputRef = useRef<HTMLInputElement>(null)
  const inputRef = outerInputRef ?? ownInputRef

  const label = defaultLabel(spec)
  const lowerLabel = label.toLowerCase()

  const query = searchText.trim().toLowerCase()
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options),
    [options, query],
  )

  // The highlighted option, by id (it survives the query narrowing): the one
  // moved to or picked, else the first match while a query is typed.
  const [activeId, setActiveId] = useState<number | null>(null)
  const chosen = activeId === null ? -1 : filtered.findIndex((o) => o.id === activeId)
  const active = chosen >= 0 ? chosen : query && filtered.length > 0 ? 0 : -1
  const listId = useId()
  const optionId = (index: number) => `${listId}-opt-${index}`
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (active < 0) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active])

  const handleClose = () => {
    setOpen(false)
    setSearchText('')
    setActiveId(null)
  }

  // Element-anchored: the panel tracks the field rect on scroll/resize
  // (closeOnScroll/closeOnResize=false → reposition mode). The wrapper row
  // (label + chips + input) counts as "inside" so clicking a chip's × or
  // the label doesn't dismiss the panel mid-edit. Escape is owned by the
  // input's onKeyDown (also blurs the input), so closeOnEscape=false.
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: fieldRef },
    open,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    onClose: handleClose,
    extraInsideRefs: [wrapperRef],
    caret: true,
  })

  // A pick with search text clears it: the whole list shows again (the
  // picks stay chips above, in pick order; the list keeps its order).
  // The picked option stays highlighted, wherever it shows once the text clears.
  // `add`: a pick that only ever adds (Tab), leaving a picked option picked.
  const toggleOption = (id: number, add = false) => {
    if (idSet.has(id)) { if (!add) onChange(ids.filter((x) => x !== id)) }
    else onChange([...ids, id])
    setActiveId(id)
    if (searchText) setSearchText('')
  }

  const removeChip = (id: number) => {
    onChange(ids.filter((x) => x !== id))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
      inputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
      if (filtered.length === 0) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      // From no highlight, ↓ goes to the first option and ↑ to the last.
      const from = active < 0 ? (step > 0 ? -1 : filtered.length) : active
      const next = filtered[(from + step + filtered.length) % filtered.length]
      if (next) setActiveId(next.id)
      return
    }
    const highlighted = open ? filtered[active] : undefined
    // An IME's Enter / Tab ends the composition; it picks nothing.
    if ((e.key === 'Enter' || e.key === 'Tab') && e.nativeEvent.isComposing) return
    if (e.key === 'Enter') {
      e.preventDefault()
      if (highlighted) toggleOption(highlighted.id)
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && query && highlighted) {
      // Tab accepts the highlighted option, as the people / tag pickers do:
      // adds it (never removes one already picked); the query clears and the
      // focus stays. With no query typed, Tab moves on (never a Tab trap).
      e.preventDefault()
      toggleOption(highlighted.id, true)
      return
    }
    if (e.key === 'Backspace' && searchText === '' && ids.length > 0) {
      // Quick-delete the most recent chip when the input is empty.
      e.preventDefault()
      onChange(ids.slice(0, -1))
    }
  }

  const placeholder = selected.length === 0 ? `Pick a ${lowerLabel}…` : ''

  return (
    <div ref={wrapperRef} className={styles.row}>
      <span className={styles.label}>{label}</span>
      <div
        ref={fieldRef}
        className={styles.field}
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((opt) => (
          <span key={opt.id} className={styles.chip}>
            <span className={styles.chipName}>{opt.name}</span>
            <button
              type="button"
              className={styles.chipRemove}
              onClick={(e) => { e.stopPropagation(); removeChip(opt.id) }}
              aria-label={`Remove ${opt.name}`}
              title={`Remove ${opt.name}`}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setActiveId(null); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={`Filter tasks by ${lowerLabel}`}
          role="combobox"
          aria-expanded={open}
          // Only while the listbox is there (the panel may show No matches instead).
          aria-controls={open && filtered.length > 0 ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        />
        {selected.length > 0 && (
          <button
            type="button"
            className={styles.clearAll}
            tabIndex={-1}
            aria-label={`Clear ${label}`}
            title={`Clear ${label}`}
            // The press keeps the focus (and the caret) in the field.
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation()
              onChange([])
              inputRef.current?.focus()
            }}
          >
            &times;
          </button>
        )}
      </div>
      {open && createPortal(
        <PopoverRoot
          ref={panelRef}
          caret={caret}
          className={styles.panel}
          style={style}
        >
          {filtered.length === 0 ? (
            <div className={styles.empty}>{searchText ? 'No matches' : `No ${lowerLabel}s yet`}</div>
          ) : (
            <div ref={listRef} id={listId} className={styles.optionList} role="listbox" aria-multiselectable="true" aria-label={label}>
              {filtered.map((opt, index) => {
                const checked = idSet.has(opt.id)
                const isActive = index === active
                return (
                  <button
                    type="button"
                    key={opt.id}
                    id={optionId(index)}
                    data-index={index}
                    role="option"
                    aria-selected={checked}
                    className={`${styles.option} ${isActive ? styles.active : ''}`}
                    // Prevent input blur so the click commits the toggle
                    // instead of dismissing the panel mid-gesture.
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => { if (!isActive) setActiveId(opt.id) }}
                    onClick={() => toggleOption(opt.id)}
                  >
                    <span className={`${styles.check} ${checked ? styles.checked : ''}`} />
                    {opt.avatar && (
                      <span className={styles.avatar} style={{ background: opt.avatar.color || NEUTRAL_PERSON_COLOR }} aria-hidden="true">
                        {opt.avatar.initials}
                      </span>
                    )}
                    <span className={styles.optionName}>{opt.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </PopoverRoot>,
        document.body,
      )}
    </div>
  )
}
