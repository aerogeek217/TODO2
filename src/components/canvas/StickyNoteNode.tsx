import { memo, useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { type NodeProps, useReactFlow } from '@xyflow/react'
import type { StickyNote, Person, Tag, Project, Org } from '../../models'
import { useClickOutside } from '../../hooks/use-click-outside'
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { useUIStore } from '../../stores/ui-store'
import styles from './StickyNoteNode.module.css'

/** Compute the visual row index and column of the cursor in a textarea value */
function getCaretRowCol(text: string, cursorPos: number): { row: number; col: number } {
  const before = text.slice(0, cursorPos)
  const lines = before.split('\n')
  return { row: lines.length - 1, col: lines[lines.length - 1].length }
}

const PRESET_COLORS = [
  { label: 'Default', value: undefined, css: 'var(--color-surface)' },
  { label: 'Yellow', value: '#FFF3B0', css: '#FFF3B0' },
  { label: 'Green', value: '#B8F0C0', css: '#B8F0C0' },
  { label: 'Blue', value: '#B0D4FF', css: '#B0D4FF' },
  { label: 'Pink', value: '#FFB8D0', css: '#FFB8D0' },
  { label: 'Purple', value: '#D4B8FF', css: '#D4B8FF' },
]

export interface StickyNoteNodeData {
  note: StickyNote
  onDelete: (id: number) => void
  onUpdateText: (id: number, text: string) => void
  onUpdateTitle: (id: number, title: string) => void
  onUpdateColor: (id: number, color: string | undefined) => void
  onResize?: (id: number, width: number, height: number) => void
  onConvertLines?: (lines: string[]) => Promise<void>
  people?: Person[]
  tags?: Tag[]
  projects?: Project[]
  orgs?: Org[]
}

type StickyNoteNodeType = StickyNoteNodeData

function StickyNoteNodeInner({ data }: NodeProps & { data: StickyNoteNodeType }) {
  const { note, onDelete, onUpdateText, onUpdateTitle, onUpdateColor, onResize, onConvertLines, people = [], tags = [], projects = [], orgs = [] } = data
  const { getZoom } = useReactFlow()
  const [localText, setLocalText] = useState(note.text)
  const [localTitle, setLocalTitle] = useState(note.title || '')
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [showPalette, setShowPalette] = useState(false)
  const [lineHeight, setLineHeight] = useState(0)
  const [lineHeights, setLineHeights] = useState<number[]>([])
  const paletteRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const resizeCleanupRef = useRef<(() => void) | null>(null)

  // Clean up resize listeners and debounce timer on unmount
  useEffect(() => () => {
    resizeCleanupRef.current?.()
    if (debounceRef.current) clearTimeout(debounceRef.current)
  }, [])

  useClickOutside(paletteRef, () => setShowPalette(false), showPalette)

  // Sync external text changes (e.g. from undo)
  useEffect(() => {
    setLocalText(note.text)
  }, [note.text])

  // Sync external title changes
  useEffect(() => {
    setLocalTitle(note.title || '')
  }, [note.title])

  const handleTitleSave = useCallback(() => {
    setIsEditingTitle(false)
    if (note.id && localTitle !== (note.title || '')) {
      onUpdateTitle(note.id, localTitle)
    }
  }, [note.id, note.title, localTitle, onUpdateTitle])

  // Autocomplete for @person/@org #tag /project
  const acPeople = useMemo(() => people.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'person' as const })), [people])
  const acTags = useMemo(() => tags.map((t) => ({ id: t.id!, name: t.name, color: t.color, kind: 'tag' as const })), [tags])
  const acProjects = useMemo(() => projects.map((p) => ({ id: p.id!, name: p.name, color: (p as { color?: string }).color, kind: 'project' as const })), [projects])
  const acOrgs = useMemo(() => orgs.map((o) => ({ id: o.id!, name: o.name, color: o.color, kind: 'org' as const })), [orgs])
  const ac = useNlpAutocomplete({ people: acPeople, tags: acTags, projects: acProjects, orgs: acOrgs })
  const [acDropdownPos, setAcDropdownPos] = useState<{ top: number; left: number } | null>(null)
  // Save cursor position when autocomplete triggers so selection works after re-render
  const acCursorRef = useRef<number>(0)

  const handleAcSelect = useCallback((item: AutocompleteItem) => {
    const ta = textareaRef.current
    if (!ta) return
    const result = ac.applySelection(localText, acCursorRef.current, item)
    if (result) {
      setLocalText(result.value)
      if (note.id) onUpdateText(note.id, result.value)
      setAcDropdownPos(null)
      requestAnimationFrame(() => {
        ta.focus()
        ta.setSelectionRange(result.cursor, result.cursor)
      })
    }
  }, [ac, localText, note.id, onUpdateText])

  // Measure actual line height from the textarea
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) return
    const computed = getComputedStyle(ta)
    const fs = parseFloat(computed.fontSize)
    const lh = parseFloat(computed.lineHeight)
    setLineHeight(isNaN(lh) ? fs * 1.5 : lh)
  }, [])

  // Measure per-line visual heights (accounts for word-wrap)
  const measureLineHeights = useCallback(() => {
    const ta = textareaRef.current
    if (!ta || lineHeight <= 0) return
    const lines = localText.split('\n')
    const mirror = document.createElement('div')
    const computed = getComputedStyle(ta)
    mirror.style.cssText = `position:absolute;visibility:hidden;height:auto;overflow:hidden;white-space:pre-wrap;word-wrap:break-word;box-sizing:border-box;`
    mirror.style.width = `${ta.clientWidth}px`
    mirror.style.font = computed.font
    mirror.style.lineHeight = computed.lineHeight
    mirror.style.paddingLeft = computed.paddingLeft
    mirror.style.paddingRight = computed.paddingRight
    document.body.appendChild(mirror)
    const heights = lines.map((line) => {
      mirror.textContent = line || '\u200b' // zero-width space for empty lines
      return mirror.offsetHeight
    })
    document.body.removeChild(mirror)
    setLineHeights(heights)
  }, [localText, lineHeight])

  useEffect(() => {
    measureLineHeights()
  }, [measureLineHeights])

  const handleTextChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value
    const cursor = e.target.selectionStart
    setLocalText(text)
    acCursorRef.current = cursor
    ac.handleInputChange(text, cursor, e.target)
    // Compute dropdown position from caret row/col
    if (lineHeight > 0) {
      const { row } = getCaretRowCol(text, cursor)
      const ta = textareaRef.current
      const scrollTop = ta ? ta.scrollTop : 0
      // Position below the current line, offset by textarea padding
      const top = 8 + (row + 1) * lineHeight - scrollTop
      setAcDropdownPos({ top, left: 24 })
    }
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (note.id) onUpdateText(note.id, text)
    }, 500)
  }, [note.id, onUpdateText, ac, lineHeight])

  const handleBlur = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (note.id && localText !== note.text) {
      onUpdateText(note.id, localText)
    }
  }, [note.id, localText, note.text, onUpdateText])

  const handleConvertLine = useCallback(async (lineIndex: number) => {
    if (!onConvertLines || !note.id) return
    const lines = localText.split('\n')
    const line = lines[lineIndex]
    if (!line || !line.trim()) return
    await onConvertLines([line])
    // Remove the converted line
    lines.splice(lineIndex, 1)
    const newText = lines.join('\n').replace(/^\n+/, '').replace(/\n{3,}/g, '\n\n')
    setLocalText(newText)
    onUpdateText(note.id, newText)
  }, [localText, onConvertLines, onUpdateText, note.id])

  const textLines = localText.split('\n')
  const gutterRef = useRef<HTMLDivElement>(null)

  // Sync gutter scroll with textarea scroll
  const handleTextareaScroll = useCallback(() => {
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop
    }
  }, [])

  const bgColor = note.color || undefined
  // Pastel backgrounds need dark text for contrast
  const noteStyle: React.CSSProperties = bgColor
    ? { backgroundColor: bgColor, color: '#1a1a1a' }
    : {}

  return (
    <div className={styles.note} style={{ width: note.width, height: note.height, ...noteStyle }}>
      <div className={styles.titleBar}>
        <div style={{ position: 'relative' }} ref={paletteRef}>
          <div
            className={`${styles.colorDot} nopan nodrag`}
            style={{ backgroundColor: note.color || 'var(--color-surface)' }}
            onClick={(e) => { e.stopPropagation(); setShowPalette(!showPalette) }}
            onDoubleClick={(e) => { e.stopPropagation(); note.id && onUpdateColor(note.id, undefined) }}
            title="Set color (double-click to reset)"
          />
          {showPalette && (
            <div className={`${styles.palette} nopan nodrag`}>
              {PRESET_COLORS.map((c) => (
                <div
                  key={c.label}
                  className={`${styles.paletteSwatch} ${note.color === c.value || (!note.color && !c.value) ? styles.paletteSwatchActive : ''}`}
                  style={{ backgroundColor: c.css }}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (note.id) onUpdateColor(note.id, c.value)
                    setShowPalette(false)
                  }}
                  title={c.label}
                />
              ))}
            </div>
          )}
        </div>

        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className={`${styles.titleInput} nopan nodrag`}
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSave()
              if (e.key === 'Escape') { setLocalTitle(note.title || ''); setIsEditingTitle(false) }
            }}
            placeholder="Note"
            maxLength={200}
            autoFocus
          />
        ) : (
          <span
            className={styles.noteLabel}
            onDoubleClick={() => { setIsEditingTitle(true); requestAnimationFrame(() => titleInputRef.current?.select()) }}
          >
            {localTitle || 'Note'}
          </span>
        )}

        <button
          className={`${styles.deleteButton} nopan nodrag`}
          onClick={() => {
            if (!note.id) return
            if (localText.trim() || localTitle.trim()) {
              useUIStore.getState().showBulkConfirmation('custom', [note.id], {
                title: 'Delete note',
                message: `Delete "${localTitle.trim() || 'Note'}"? This cannot be undone.`,
                confirmLabel: 'Delete',
                onConfirm: () => onDelete(note.id!),
              })
            } else {
              onDelete(note.id)
            }
          }}
        >
          &times;
        </button>
      </div>

      <div className={styles.body}>
        {onConvertLines && lineHeight > 0 && (
          <div ref={gutterRef} className={`${styles.gutter} nopan nodrag nowheel`}>
            {textLines.map((line, i) => (
              <div key={i} className={styles.gutterRow} style={{ height: lineHeights[i] || lineHeight }}>
                {line.trim() && (
                  <button
                    className={styles.convertIcon}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => handleConvertLine(i)}
                    title="Convert to task"
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <circle cx="8" cy="8" r="6" />
                      <line x1="5" y1="8" x2="11" y2="8" />
                      <line x1="8" y1="5" x2="8" y2="11" />
                    </svg>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className={`${styles.textarea} nopan nodrag nowheel`}
          value={localText}
          onChange={handleTextChange}
          onBlur={() => {
            handleBlur()
            // Delay dismiss so dropdown click can fire first
            setTimeout(() => { ac.dismiss(); setAcDropdownPos(null) }, 150)
          }}
          onScroll={handleTextareaScroll}
          onKeyDown={(e) => {
            if (ac.handleKeyDown(e)) {
              e.preventDefault()
              if ((e.key === 'Tab' || e.key === 'Enter') && ac.state.items.length > 0) {
                handleAcSelect(ac.state.items[ac.state.selectedIndex])
              }
              return
            }
          }}
          placeholder="Type a note..."
        />
      </div>

      {ac.state.visible && ac.state.items.length > 0 && acDropdownPos && (
        <div
          className={`${styles.acDropdown} nopan nodrag nowheel`}
          style={{ top: acDropdownPos.top, left: acDropdownPos.left }}
        >
          <div className={styles.acHeader}>
            {ac.state.trigger === '@' ? (ac.state.items.some((item) => item.kind === 'org') ? 'People & Orgs' : 'People') : ac.state.trigger === '#' ? 'Tags' : 'Projects'}
          </div>
          {ac.state.items.map((item, i) => (
            <button
              key={`${item.kind}-${item.id}`}
              className={`${styles.acItem} ${i === ac.state.selectedIndex ? styles.acItemSelected : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleAcSelect(item)
              }}
            >
              {item.color && (
                <span className={styles.acDot} style={{ background: item.color }} />
              )}
              <span>{ac.state.trigger}{item.name}</span>
              {item.kind === 'org' && (
                <span className={styles.acKindLabel}>(org)</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div
        className={`${styles.resizeHandle} nopan nodrag`}
        onMouseDown={(e) => {
          e.stopPropagation()
          const startX = e.clientX
          const startY = e.clientY
          const startW = note.width
          const startH = note.height
          const zoom = getZoom()
          const nodeEl = (e.currentTarget as HTMLElement).closest('.react-flow__node')
          const noteDiv = nodeEl?.querySelector('.' + styles.note) as HTMLElement | null

          const onMouseMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX
            const dy = ev.clientY - startY
            const newW = Math.max(160, startW + dx / zoom)
            const newH = Math.max(120, startH + dy / zoom)

            if (noteDiv) {
              noteDiv.style.width = `${newW}px`
              noteDiv.style.height = `${newH}px`
            }
          }

          const onMouseUp = (ev: MouseEvent) => {
            const newW = Math.max(160, startW + (ev.clientX - startX) / zoom)
            const newH = Math.max(120, startH + (ev.clientY - startY) / zoom)

            if (note.id && onResize) onResize(note.id, newW, newH)
            // Re-measure line heights after resize (width change affects wrapping)
            requestAnimationFrame(measureLineHeights)

            resizeCleanupRef.current?.()
          }

          const cleanup = () => {
            window.removeEventListener('mousemove', onMouseMove)
            window.removeEventListener('mouseup', onMouseUp)
            resizeCleanupRef.current = null
          }
          resizeCleanupRef.current = cleanup
          window.addEventListener('mousemove', onMouseMove)
          window.addEventListener('mouseup', onMouseUp)
        }}
      />
    </div>
  )
}

export const StickyNoteNode = memo(StickyNoteNodeInner)
