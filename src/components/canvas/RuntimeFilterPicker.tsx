import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RuntimeFilterSpec } from '../../models/list-definition'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useProjectStore } from '../../stores/project-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { usePopoverAnchor } from '../../hooks/use-popover-anchor'
import styles from './RuntimeFilterPicker.module.css'

// All option lookups for this picker go through cached Zustand stores
// (`usePersonStore`, `useOrgStore`, `useProjectStore`, `useStatusStore`,
// `useTagStore`) — there are no Dexie reads on render or keystroke. Keep it
// that way: the picker is mounted on canvas/list surfaces during drag-heavy
// interactions, and re-issuing repository queries per keystroke would tank
// the hover/typing path. The vitest companion (`runtime-filter-picker.test.tsx`)
// asserts this contract by failing on any `db.<table>.*` call.

interface Option {
  id: number
  name: string
}

interface RuntimeFilterPickerProps {
  spec: RuntimeFilterSpec
  /** Currently picked ids (OR-combined). Empty / undefined ≡ no narrowing. */
  value: number[] | undefined
  /**
   * Called with the next id list. Always emitted as an array; consumers
   * decide whether to normalize empty → undefined (the canvas-rails store
   * + list-inset store do).
   */
  onChange: (value: number[]) => void
}

function defaultLabel(spec: RuntimeFilterSpec): string {
  if (spec.label && spec.label.trim()) return spec.label
  switch (spec.field) {
    case 'person': return 'Person'
    case 'org': return 'Org'
    case 'project': return 'Project'
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
 * passes the predicate through unchanged); the canvas-rails / list-inset
 * stores normalize an empty array down to "no pick yet" so the placeholder
 * re-appears.
 */
export function RuntimeFilterPicker({ spec, value, onChange }: RuntimeFilterPickerProps) {
  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const options = useMemo<Option[]>(() => {
    const base: Option[] = []
    switch (spec.field) {
      case 'person':
        for (const p of people) if (p.id != null) base.push({ id: p.id, name: p.name })
        break
      case 'org':
        for (const o of orgs) if (o.id != null) base.push({ id: o.id, name: o.name })
        break
      case 'project':
        for (const p of projects) if (p.id != null) base.push({ id: p.id, name: p.name })
        break
      case 'status':
        for (const s of statuses) if (s.id != null) base.push({ id: s.id, name: s.name })
        break
      case 'tag':
        for (const t of tags) if (t.id != null) base.push({ id: t.id, name: t.name })
        break
    }
    return base.sort((a, b) => a.name.localeCompare(b.name))
  }, [spec.field, people, orgs, projects, statuses, tags])

  const ids = value ?? []
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
  const inputRef = useRef<HTMLInputElement>(null)

  const label = defaultLabel(spec)
  const lowerLabel = label.toLowerCase()

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options
  }, [options, searchText])

  const handleClose = () => {
    setOpen(false)
    setSearchText('')
  }

  // Element-anchored: the panel tracks the field rect on scroll/resize
  // (closeOnScroll/closeOnResize=false → reposition mode). The wrapper row
  // (label + chips + input) counts as "inside" so clicking a chip's × or
  // the label doesn't dismiss the panel mid-edit. Escape is owned by the
  // input's onKeyDown (also blurs the input), so closeOnEscape=false.
  const { panelRef, style } = usePopoverAnchor({
    anchor: { kind: 'ref', ref: fieldRef },
    open,
    closeOnScroll: false,
    closeOnResize: false,
    closeOnEscape: false,
    onClose: handleClose,
    extraInsideRefs: [wrapperRef],
  })

  const toggleOption = (id: number) => {
    if (idSet.has(id)) onChange(ids.filter((x) => x !== id))
    else onChange([...ids, id])
  }

  const removeChip = (id: number) => {
    onChange(ids.filter((x) => x !== id))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setSearchText('')
      inputRef.current?.blur()
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
    <div ref={wrapperRef} className={`${styles.row} nopan nodrag`}>
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
          onChange={(e) => { setSearchText(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={`Filter tasks by ${lowerLabel}`}
        />
      </div>
      {open && createPortal(
        <div
          ref={panelRef}
          className={`${styles.panel} nopan nodrag`}
          style={style}
        >
          {filtered.length === 0 ? (
            <div className={styles.empty}>{searchText ? 'No matches' : `No ${lowerLabel}s yet`}</div>
          ) : (
            <div className={styles.optionList}>
              {filtered.map((opt) => {
                const checked = idSet.has(opt.id)
                return (
                  <button
                    type="button"
                    key={opt.id}
                    className={styles.option}
                    // Prevent input blur so the click commits the toggle
                    // instead of dismissing the panel mid-gesture.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggleOption(opt.id)}
                  >
                    <span className={`${styles.check} ${checked ? styles.checked : ''}`} />
                    <span className={styles.optionName}>{opt.name}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  )
}
