import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { RuntimeFilterSpec } from '../../models/list-definition'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useProjectStore } from '../../stores/project-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import styles from './RuntimeFilterPicker.module.css'

const VIEWPORT_MARGIN_PX = 8
const PANEL_GAP_PX = 4

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
  const [panelPos, setPanelPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const label = defaultLabel(spec)
  const lowerLabel = label.toLowerCase()

  const filtered = useMemo(() => {
    const q = searchText.trim().toLowerCase()
    return q ? options.filter((o) => o.name.toLowerCase().includes(q)) : options
  }, [options, searchText])

  // Position the portaled panel below the field, flipping above when the
  // panel would clip below the viewport, and clamping horizontally so a
  // right-edge field doesn't push the panel off-screen.
  const computePanelPosition = useCallback(() => {
    const field = fieldRef.current
    if (!field) return
    const fieldRect = field.getBoundingClientRect()
    const panel = panelRef.current
    const panelRect = panel?.getBoundingClientRect()
    const panelHeight = panelRect?.height ?? 0
    const panelWidth = panelRect?.width ?? fieldRect.width

    let top = fieldRect.bottom + PANEL_GAP_PX
    if (panelHeight > 0 && top + panelHeight > window.innerHeight - VIEWPORT_MARGIN_PX) {
      const flipped = fieldRect.top - panelHeight - PANEL_GAP_PX
      if (flipped >= VIEWPORT_MARGIN_PX) top = flipped
    }

    let left = fieldRect.left
    if (left + panelWidth > window.innerWidth - VIEWPORT_MARGIN_PX) {
      left = Math.max(VIEWPORT_MARGIN_PX, fieldRect.right - panelWidth)
    }

    setPanelPos({ top, left })
  }, [])

  // Initial placement runs in useLayoutEffect so the flip lands before paint;
  // re-runs when option count / chip count changes the panel height.
  useLayoutEffect(() => {
    if (!open) return
    computePanelPosition()
  }, [open, computePanelPosition, filtered.length, selected.length])

  // Track scroll/resize while the panel is open. Capture-phase scroll catches
  // ancestors (e.g. inset body). React Flow pan does not fire scroll events,
  // so a canvas pan won't reposition the panel — acceptable since the panel
  // closes on outside-click anyway.
  useEffect(() => {
    if (!open) return
    const handler = () => computePanelPosition()
    window.addEventListener('scroll', handler, true)
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('scroll', handler, true)
      window.removeEventListener('resize', handler)
    }
  }, [open, computePanelPosition])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (wrapperRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
      setSearchText('')
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

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
          style={{ left: panelPos.left, top: panelPos.top }}
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
