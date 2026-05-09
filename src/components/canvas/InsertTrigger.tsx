import {
  useRef,
  useLayoutEffect,
  useMemo,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react'
import { useNlpAutocomplete, type AutocompleteItem } from '../../hooks/use-nlp-autocomplete'
import { useClickOutside } from '../../hooks/use-click-outside'
import { NlpAutocomplete } from '../shared/NlpAutocomplete'
import { usePersonStore } from '../../stores/person-store'
import { useProjectStore } from '../../stores/project-store'
import { useOrgStore } from '../../stores/org-store'
import { useStatusStore } from '../../stores/status-store'
import { useTagStore } from '../../stores/tag-store'
import { resolvePersonColor } from '../../utils/person-color'
import styles from './InsertTrigger.module.css'

/** Imperative handle exposed to `SortableTaskList` so the parent owns *when*
 * to focus the input (after the activeInsertAfterId render commits + the
 * t50 macrotask gap). The trigger owns *how*: a single `inputRef.focus()`
 * call. Phase 3 of `docs/plans/features/real-browser-testing/`. */
export interface InsertTriggerHandle {
  focusInput: () => void
}

interface InsertTriggerProps {
  editing: boolean
  onActivate: () => void
  onCommit: (title: string) => void
  onCancel: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onPasteFromClipboard?: () => void
}

export const InsertTrigger = forwardRef<InsertTriggerHandle, InsertTriggerProps>(function InsertTrigger(
  { editing, onActivate, onCommit, onCancel, onContextMenu, onPasteFromClipboard },
  ref,
) {
  const inputRef = useRef<HTMLInputElement>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef('')
  const committedRef = useRef(false)

  // Stable callback ref: only fires on real input mount/unmount.
  const setInputRef = useCallback((el: HTMLInputElement | null): void => {
    inputRef.current = el
  }, [])

  // Imperative focus handoff (Phase 3). Phase 2's post-Phase-4 trace showed
  // every focus mechanism earlier than t50 is 0/40 effective during the
  // Enter-chain re-render race — autoFocus, useLayoutEffect, rAF, t0 all
  // fail because something (most likely React Flow's ResizeObserver firing
  // when the project node grows for the new row) holds focus ineligible
  // for the full ~50ms window after mount. SortableTaskList drives this
  // method from a `setTimeout(_, 50)` after `setActiveInsertAfterId`, so
  // by the time we run the contention window has cleared.
  useImperativeHandle(
    ref,
    () => ({
      focusInput: () => {
        const input = inputRef.current
        if (!input || committedRef.current) return
        if (document.activeElement === input) return
        input.focus()
      },
    }),
    [],
  )

  const people = usePersonStore((s) => s.people)
  const projects = useProjectStore((s) => s.projects)
  const orgsFromStore = useOrgStore((s) => s.orgs)
  const personOrgMap = useOrgStore((s) => s.personOrgMap)
  const tagsFromStore = useTagStore((s) => s.tags)
  const statusesFromStore = useStatusStore((s) => s.statuses)

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
  const acTags = useMemo(
    () => [...tagsFromStore].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({
      id: t.id!,
      name: t.name,
      color: t.color,
      kind: 'tag' as const,
    })),
    [tagsFromStore],
  )
  const acStatuses = useMemo(
    () => statusesFromStore.map((s) => ({
      id: s.id!,
      name: s.name,
      color: s.color,
      kind: 'status' as const,
    })),
    [statusesFromStore],
  )

  const ac = useNlpAutocomplete({ people: acPeople, projects: acProjects, orgs: acOrgs, tags: acTags, statuses: acStatuses })

  useClickOutside(wrapperRef, () => {
    ac.dismiss()
    committedRef.current = true
    const trimmed = titleRef.current.trim()
    if (trimmed) onCommit(trimmed)
    else onCancel()
  }, editing)

  // Edit-state housekeeping. Initial focus is split by path:
  //   - Click-activate / Insert-key (no row insertion): the input's
  //     `autoFocus` lands focus at mount. Phase 5 MCP trace 2026-04-26
  //     confirmed 10/10 cycles, with the parent's t50 call exiting early
  //     via `already-on-input`. autoFocus is load-bearing here because
  //     no React Flow ResizeObserver fires (no row is being inserted).
  //   - Enter-chain (row insertion): `autoFocus` is contested by RF's
  //     ResizeObserver firing as the project node grows for the new row,
  //     and is 0/40 effective (Phase 2 trace). SortableTaskList's t50
  //     `setTimeout(focusInput, 50)` is the load-bearing path; this
  //     trigger's `focusInput` handle does the actual focus call.
  // Phase 2 also showed the in-component reclaim chain (rAF / t0 / t50 /
  // t150 / t300 / focusout-reclaim) was 0/40 effective on Enter-chain —
  // removed accordingly when Phase 3 landed.
  useLayoutEffect(() => {
    if (!editing) {
      ac.dismiss()
      return
    }
    titleRef.current = ''
    committedRef.current = false
  }, [editing])

  const handleCommit = () => {
    ac.dismiss()
    const trimmed = titleRef.current.trim()
    if (trimmed) {
      // Reset input + ref synchronously so keystrokes arriving during the
      // async insert accumulate in a clean input (not appended to the
      // just-committed title). The parent then moves `activeInsertAfterId`
      // to the new task id when the insert resolves and schedules the
      // imperative `focusInput()` call to land focus on the new trigger.
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

  const handleCreateNew = () => {
    const input = inputRef.current
    if (!input) return
    const result = ac.applySelection(input.value, input.selectionStart ?? input.value.length)
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
          ref={setInputRef}
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
              const isTagCreateNew = ac.state.trigger === '#' && ac.state.items.length === 0 && ac.state.query.length > 0
              if (e.key === 'Tab' || (e.key === 'Enter' && (ac.state.items.length > 0 || isTagCreateNew))) {
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
        <NlpAutocomplete state={ac.state} onSelect={handleSelect} onCreateNew={handleCreateNew} />
      </div>
    )
  }

  return (
    <div className={styles.trigger} onClick={onActivate} onContextMenu={onContextMenu}>
      <div className={styles.line} />
      <div className={styles.circle}>+</div>
    </div>
  )
})
