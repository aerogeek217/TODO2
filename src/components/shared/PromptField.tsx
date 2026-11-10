import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ESCAPE_OWN_ATTR, usePopoverAnchor } from '../../hooks/use-popover-anchor'
import { NEUTRAL_PERSON_COLOR } from '../../constants'
import styles from './PromptField.module.css'
import { PopoverRoot } from './PopoverRoot'

/** One choice of a `PromptField`. */
export interface PromptOption {
  id: number
  name: string
  /** Before its name in the option list (an avatar, a glyph) — and on its chip, with `chipMarks`. */
  mark?: ReactNode
  /** At the option's end, muted (e.g. its open tasks). */
  count?: number
}

interface PromptFieldProps {
  /** The field's name (`Person`): the row's label, the option list's name, the clear button's `Clear Person`. */
  label: string
  /**
   * Drawn in place of the label's text: a control of the caller's (the
   * Review widget's `Person ▾` menu button). A press on it — or on
   * `trailing` — is outside the field, so the option list closes.
   */
  labelControl?: ReactNode
  /** The choices, in the order the list shows them. Read from cached stores by the caller — never the database. */
  options: readonly PromptOption[]
  /** Currently picked ids (OR-combined). Empty / undefined ≡ nothing picked. */
  value: readonly number[] | undefined
  /**
   * Called with the next id list. Always emitted as an array; consumers
   * decide whether to normalize empty → undefined.
   */
  onChange: (value: number[]) => void
  /** The field's input, for an outside "Pick …" action to focus. */
  inputRef?: RefObject<HTMLInputElement | null>
  /** The input's accessible name. */
  inputLabel: string
  /** The input's placeholder while nothing is picked. */
  placeholder: string
  /** What the option list says while there are no options at all (`No tags yet`). */
  emptyText: string
  /** Each chip shows its option's mark before its name. */
  chipMarks?: boolean
  /** After the field, at the row's end (a count, a switch). */
  trailing?: ReactNode
  /**
   * What the field is of (the Review widget's kind): when it changes, the
   * options are another set, so the typed text and the highlight go and the
   * option list closes — the row itself (a `labelControl` holding the focus)
   * stays mounted.
   */
  resetKey?: string
}

const NO_IDS: readonly number[] = []
const NO_REFS: RefObject<HTMLElement | null>[] = []

/**
 * A prompt row (a list's Prompt for, the Review widget's field): a label,
 * then a multi-value field the user types in. Visual shape mirrors
 * `FilterDropdown` (chip-row + searchable option list) but the trigger is the
 * text input itself — it stays visible above the body so typing the first
 * letter lands without an extra click.
 *
 * Selection semantics: each picked id appears as a chip with a `×`; the
 * value is the chips' id list, OR-combined by whoever applies it. A pick
 * while the field has search text clears the text (the focus stays in the
 * field). While anything is picked, a × at the field's end clears every
 * pick at once (the focus stays in the field).
 *
 * Keyboard (as `ChipSelector`): one option is highlighted — the first match
 * while a query is typed, else the last one moved to or picked (none until
 * then); ↑ / ↓ move it (wrapping), Enter toggles it, Tab with a query typed
 * adds it (never removes) and keeps the focus in the field. Tab / Shift+Tab
 * with no query move on as usual.
 *
 * The options come in as props: the field itself reads no store and never
 * the database (its callers read cached Zustand stores only — it is mounted
 * on widgets during drag-heavy interactions, and a query per keystroke would
 * tank the hover / typing path).
 */
export function PromptField({
  label, labelControl, options, value, onChange, inputRef: outerInputRef, inputLabel, placeholder, emptyText, chipMarks = false, trailing, resetKey,
}: PromptFieldProps) {
  const ids = value ?? NO_IDS
  const idSet = useMemo(() => new Set(ids), [ids])
  const optionsById = useMemo(() => {
    const map = new Map<number, PromptOption>()
    for (const o of options) map.set(o.id, o)
    return map
  }, [options])

  // Selected entities, in pick order. Unknown ids (entity deleted while a
  // pick referenced it) are skipped — render nothing for them rather than
  // dangling chips.
  const selected = useMemo<PromptOption[]>(() => {
    const out: PromptOption[] = []
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

  const query = searchText.trim().toLowerCase()
  const filtered = useMemo(
    () => (query ? options.filter((o) => o.name.toLowerCase().includes(query)) : options),
    [options, query],
  )

  // The highlighted option, by id (it survives the query narrowing): the one
  // moved to or picked, else the first match while a query is typed.
  const [activeId, setActiveId] = useState<number | null>(null)
  // A new `resetKey`: another field (adjusted during render, not in an effect: no render of the old text over the new options).
  const [shownKey, setShownKey] = useState(resetKey)
  if (resetKey !== shownKey) {
    setShownKey(resetKey)
    setSearchText('')
    setActiveId(null)
    setOpen(false)
  }
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
  // (closeOnScroll/closeOnResize=false → reposition mode). With a plain
  // label the wrapper row (label + chips + input) counts as "inside" so
  // clicking a chip's × or the label doesn't dismiss the panel mid-edit; a
  // label control or trailing content of the caller's is outside (the field
  // itself, the anchor, always is inside). Escape is owned by the input's
  // onKeyDown (also blurs the input), so closeOnEscape=false.
  const rowIsInside = labelControl == null && trailing == null
  const { panelRef, style, caret } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: fieldRef },
    open,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    onClose: handleClose,
    extraInsideRefs: rowIsInside ? [wrapperRef] : NO_REFS,
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
    const last = selected.at(-1)
    if (e.key === 'Backspace' && searchText === '' && last) {
      // Quick-delete the most recent chip shown when the input is empty (a
      // deleted entity's id, which shows no chip, isn't one).
      e.preventDefault()
      onChange(ids.filter((id) => id !== last.id))
    }
  }

  return (
    <div ref={wrapperRef} className={styles.row} data-prompt-row="">
      {labelControl ?? <span className={styles.label}>{label}</span>}
      <div
        ref={fieldRef}
        className={styles.field}
        onClick={() => inputRef.current?.focus()}
      >
        {selected.map((opt) => (
          <span key={opt.id} className={styles.chip}>
            {chipMarks && opt.mark != null && <span className={styles.chipMark} aria-hidden="true">{opt.mark}</span>}
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
          placeholder={selected.length === 0 ? placeholder : ''}
          aria-label={inputLabel}
          autoComplete="off"
          // Esc here closes the option list and leaves the field (below): a popover the row sits in — a small
          // face's whole widget — stays open.
          {...{ [ESCAPE_OWN_ATTR]: '' }}
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
      {trailing}
      {open && createPortal(
        <PopoverRoot
          ref={panelRef}
          caret={caret}
          className={styles.panel}
          style={style}
          data-prompt-panel=""
        >
          {filtered.length === 0 ? (
            <div className={styles.empty}>{searchText ? 'No matches' : emptyText}</div>
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
                    {opt.mark != null && <span className={styles.mark} aria-hidden="true">{opt.mark}</span>}
                    <span className={styles.optionName}>{opt.name}</span>
                    {opt.count != null && <span className={styles.count}>{opt.count}</span>}
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

/** A person's mark in a `PromptField`: their initials on their colour (smaller on a chip). */
export function PromptAvatar({ initials, color }: { initials: string; color?: string }) {
  return <span className={styles.avatar} style={{ background: color || NEUTRAL_PERSON_COLOR }}>{initials}</span>
}
