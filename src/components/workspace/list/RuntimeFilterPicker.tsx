import { useMemo, type RefObject } from 'react'
import type { RuntimeFilterSpec } from '../../../models/list-definition'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { byName } from '../../../utils/sort-order'
import { PromptAvatar, PromptField, type PromptOption } from '../../shared/PromptField'

// All option lookups for this picker go through cached Zustand stores
// (`usePersonStore`, `useStatusStore`, `useTagStore`) — there are no Dexie reads on render or keystroke. Keep it
// that way: the picker is mounted on list widgets during drag-heavy
// interactions, and re-issuing repository queries per keystroke would tank
// the hover/typing path. The vitest companion (`runtime-filter-picker.test.tsx`)
// asserts this contract by failing on any `db.<table>.*` call.

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
 * Multi-value picker for a list-def's `runtimeFilter`: the shared prompt row
 * (`components/shared/PromptField` — its look, selection semantics and
 * keyboard) over the field's people, statuses or tags, sorted by name. The
 * underlying value is the chips' id list, OR-combined when the helper
 * applies it (`applyRuntimeFilter`). Empty selection is a no-op (helper
 * passes the predicate through unchanged).
 */
export function RuntimeFilterPicker({ spec, value, onChange, inputRef }: RuntimeFilterPickerProps) {
  const people = usePersonStore((s) => s.people)
  const statuses = useStatusStore((s) => s.statuses)
  const tags = useTagStore((s) => s.tags)

  const options = useMemo<PromptOption[]>(() => {
    const base: PromptOption[] = []
    switch (spec.field) {
      case 'person':
        for (const p of people) {
          if (p.id != null) base.push({ id: p.id, name: p.name, mark: <PromptAvatar initials={p.initials || p.name.slice(0, 2).toUpperCase()} color={p.color} /> })
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

  const label = defaultLabel(spec)
  const lowerLabel = label.toLowerCase()

  return (
    <PromptField
      label={label}
      options={options}
      value={value}
      onChange={onChange}
      inputRef={inputRef}
      inputLabel={`Filter tasks by ${lowerLabel}`}
      placeholder={`Pick a ${lowerLabel}…`}
      emptyText={`No ${lowerLabel}s yet`}
    />
  )
}
