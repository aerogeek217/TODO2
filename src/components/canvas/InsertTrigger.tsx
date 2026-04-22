import { useRef, useLayoutEffect, useMemo } from 'react'
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { useClickOutside } from '../../hooks/use-click-outside'
import { NlpAutocomplete } from '../shared/NlpAutocomplete'
import { usePersonStore } from '../../stores/person-store'
import { useProjectStore } from '../../stores/project-store'
import { useOrgStore } from '../../stores/org-store'
import { resolvePersonColor } from '../../utils/person-color'
import styles from './InsertTrigger.module.css'

interface InsertTriggerProps {
  editing: boolean
  onActivate: () => void
  onCommit: (title: string) => void
  onCancel: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onPasteFromClipboard?: () => void
}

export function InsertTrigger({ editing, onActivate, onCommit, onCancel, onContextMenu, onPasteFromClipboard }: InsertTriggerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef('')
  const committedRef = useRef(false)

  const people = usePersonStore((s) => s.people)
  const projects = useProjectStore((s) => s.projects)
  const orgsFromStore = useOrgStore((s) => s.orgs)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)

  const acPeople = useMemo(
    () => people.map((p) => ({
      id: p.id!,
      name: p.name,
      color: resolvePersonColor(p.id, personOrgMap, orgsFromStore),
      kind: 'person' as const,
    })),
    [people, personOrgMap, orgsFromStore],
  )
  const acProjects = useMemo(() => projects.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'project' as const })), [projects])
  const acOrgs = useMemo(() => orgsFromStore.map((o) => ({ id: o.id!, name: o.name, color: o.color, kind: 'org' as const })), [orgsFromStore])

  const ac = useNlpAutocomplete({ people: acPeople, projects: acProjects, orgs: acOrgs })

  useClickOutside(wrapperRef, () => {
    ac.dismiss()
    committedRef.current = true
    const trimmed = titleRef.current.trim()
    if (trimmed) onCommit(trimmed)
    else onCancel()
  }, editing)

  // Use useLayoutEffect so focus is applied synchronously after the DOM
  // commit — prevents the brief focus-on-body gap when this InsertTrigger
  // becomes editing immediately after a sibling's input unmounted (the
  // Enter-chain scenario). useEffect would fire after paint, losing the first
  // keystroke.
  useLayoutEffect(() => {
    if (editing) {
      titleRef.current = ''
      committedRef.current = false
      inputRef.current?.focus()
      // Belt-and-suspenders: if another commit (e.g. the old trigger's unmount)
      // steals focus back to body after this layout effect, reclaim it on the
      // next frame.
      const raf = requestAnimationFrame(() => {
        if (inputRef.current && document.activeElement !== inputRef.current) {
          inputRef.current.focus()
        }
      })
      return () => cancelAnimationFrame(raf)
    } else {
      ac.dismiss()
    }
  }, [editing])

  const handleCommit = () => {
    ac.dismiss()
    const trimmed = titleRef.current.trim()
    if (trimmed) {
      // Reset input + ref synchronously so keystrokes arriving during the
      // async insert accumulate in a clean input (not appended to the
      // just-committed title). The parent then moves `activeInsertAfterId`
      // to the new task id when the insert resolves — the new InsertTrigger
      // mounts with `autoFocus` and picks up focus.
      if (inputRef.current) inputRef.current.value = ''
      titleRef.current = ''
      // Mark as committed so the deferred onBlur handler doesn't re-fire
      // handleCommit (which would then see an empty titleRef and call
      // onCancel, closing the trigger that the parent just moved to).
      committedRef.current = true
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  const handleSelect = (item: AutocompleteItem) => {
    const input = inputRef.current
    if (!input) return
    const result = ac.applySelection(input.value, input.selectionStart ?? input.value.length, item)
    if (result) {
      input.value = result.value
      titleRef.current = result.value
      input.setSelectionRange(result.cursor, result.cursor)
      input.focus()
    }
  }

  if (editing) {
    return (
      <div ref={wrapperRef} className={styles.inputRow} style={{ position: 'relative' }} onContextMenu={onContextMenu}>
        <input
          ref={inputRef}
          autoFocus
          className={styles.input}
          defaultValue=""
          onChange={(e) => {
            titleRef.current = e.target.value
            ac.handleInputChange(e.target.value, e.target.selectionStart ?? e.target.value.length, e.target)
          }}
          onKeyDown={(e) => {
            // Autocomplete navigation
            if (ac.state.visible) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                e.stopPropagation()
                ac.handleKeyDown(e)
                return
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && ac.state.items.length > 0)) {
                e.preventDefault()
                e.stopPropagation()
                const input = inputRef.current
                if (input) {
                  const result = ac.applySelection(input.value, input.selectionStart ?? input.value.length)
                  if (result) {
                    input.value = result.value
                    titleRef.current = result.value
                    input.setSelectionRange(result.cursor, result.cursor)
                  }
                }
                return
              }
              if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                ac.dismiss()
                return
              }
            }
            if (e.key === 'Enter') { e.preventDefault(); handleCommit() }
            if (e.key === 'Escape') onCancel()
            // Ctrl+V — paste tasks from clipboard if available
            if ((e.ctrlKey || e.metaKey) && e.key === 'v' && onPasteFromClipboard) {
              e.preventDefault()
              onPasteFromClipboard()
              return
            }
            e.stopPropagation()
          }}
          onBlur={() => {
            // Delay to allow autocomplete click to fire
            setTimeout(() => {
              if (committedRef.current) return
              if (!ac.state.visible) handleCommit()
              else { ac.dismiss(); handleCommit() }
            }, 150)
          }}
          placeholder="New task... (@person /project p1 tomorrow)"
        />
        <NlpAutocomplete state={ac.state} onSelect={handleSelect} />
      </div>
    )
  }

  return (
    <div className={styles.trigger} onClick={onActivate} onContextMenu={onContextMenu}>
      <div className={styles.line} />
      <div className={styles.circle}>+</div>
    </div>
  )
}
