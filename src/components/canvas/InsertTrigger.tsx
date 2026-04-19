import { useRef, useEffect, useMemo } from 'react'
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { useClickOutside } from '../../hooks/use-click-outside'
import { NlpAutocomplete } from '../shared/NlpAutocomplete'
import { usePersonStore } from '../../stores/person-store'
import { useProjectStore } from '../../stores/project-store'
import { useOrgStore } from '../../stores/org-store'
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

  const acPeople = useMemo(() => people.map((p) => ({ id: p.id!, name: p.name, color: p.color, kind: 'person' as const })), [people])
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

  useEffect(() => {
    if (editing) {
      titleRef.current = ''
      committedRef.current = false
      inputRef.current?.focus()
    } else {
      ac.dismiss()
    }
  }, [editing])

  const handleCommit = () => {
    ac.dismiss()
    const trimmed = titleRef.current.trim()
    if (trimmed) {
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
