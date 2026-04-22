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

  // Enter-chain focus: when this trigger becomes `editing` right after a
  // sibling's input unmounted (user pressed Enter in the previous trigger),
  // we need to land focus on OUR input and hold it there. Prior attempts tried
  // useLayoutEffect + rAF — that covers the same-frame race but misses two
  // real-browser failure modes seen in Edge/Chrome:
  //   1. React Flow's ResizeObserver fires after the ProjectNode grows for the
  //      new task row. Its callback dispatches a store update → CanvasView
  //      re-renders and walks back through ProjectNode. Depending on browser
  //      scheduling, that can run AFTER our rAF reclaim, briefly snapping focus
  //      back to document.body between the paint and the next user input.
  //   2. The OLD input's blur event handler (set up by its own onBlur before
  //      unmount) fires on a 150ms timer. It early-returns via committedRef
  //      but the browser still flushes the blur through the focus queue, and
  //      in rare cases the focus-reclaim hasn't been honored yet when the user
  //      starts typing.
  // Robust fix: aggressive, low-cost retries at escalating deadlines AND a
  // short-window focusout reclaim. We only reclaim if focus went to body/null
  // (i.e. "nothing took it") — never fight a real focus target.
  useLayoutEffect(() => {
    if (!editing) {
      ac.dismiss()
      return
    }
    titleRef.current = ''
    committedRef.current = false
    const input = inputRef.current
    if (!input) return
    let cancelled = false

    const reclaim = () => {
      // Don't fight dismissal. `committedRef` flips true when the user
      // commits (Enter) or click-outside fires — either way the trigger is
      // on its way out and we must not force focus back.
      if (cancelled || committedRef.current || !inputRef.current) return
      const active = document.activeElement
      if (active === inputRef.current) return
      // Only reclaim when focus has nowhere else to go. If a user clicked
      // another real control (button, menu, another input), leave it alone.
      if (active === null || active === document.body) {
        inputRef.current.focus()
      }
    }

    input.focus()
    // Retry schedule spans sync post-commit (rAF) through the settle window
    // (~300ms) where async store publishes and ResizeObserver work typically
    // finish. Each retry is a no-op if focus already landed — the cost is a
    // handful of document.activeElement reads.
    const raf = requestAnimationFrame(reclaim)
    const t0 = setTimeout(reclaim, 0)
    const t1 = setTimeout(reclaim, 50)
    const t2 = setTimeout(reclaim, 150)
    const t3 = setTimeout(reclaim, 300)

    // Additionally reclaim on focusout for the first 400ms. This catches the
    // exact moment a stray blur fires after our retries finish but before the
    // user types. Scoped to the input via capture listener on the element.
    const onFocusOut = (e: FocusEvent) => {
      // relatedTarget === null means focus moved to nowhere (body). If it
      // moved to another focusable element, honor that.
      if (e.relatedTarget === null || e.relatedTarget === document.body) {
        // Defer one tick so we don't race with whatever event caused the blur.
        queueMicrotask(reclaim)
      }
    }
    input.addEventListener('focusout', onFocusOut)
    const offFocusOut = setTimeout(() => input.removeEventListener('focusout', onFocusOut), 400)

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      clearTimeout(t0)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      clearTimeout(offFocusOut)
      input.removeEventListener('focusout', onFocusOut)
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
