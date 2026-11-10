import { useMemo, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react'
import { NEUTRAL_PERSON_COLOR } from '../../../constants'
import { DEFAULT_STATUS_ICON } from '../../../models'
import { listedLists } from '../../../models/list-definition'
import type { ReviewPick, ReviewPickKind } from '../../../models/review'
import { useStatsBase } from '../../../hooks/use-glance-data'
import { useListDefinitionStore } from '../../../stores/list-definition-store'
import { usePersonStore } from '../../../stores/person-store'
import { useStatusStore } from '../../../stores/status-store'
import { useTagStore } from '../../../stores/tag-store'
import { bySortOrder } from '../../../utils/sort-order'
import { AnchoredPicker } from '../../shared/AnchoredPicker'
import { WidgetKindIcon } from '../../shared/icons'
import { StatusIcon } from '../../shared/StatusIcon'
import { useListOwnerLayoutId } from '../widget-hooks'
import styles from './ReviewWidget.module.css'

/** The picker's segments, in order. */
const SEGMENTS: ReadonlyArray<{ kind: ReviewPickKind; label: string; search: string }> = [
  { kind: 'person', label: 'Person', search: 'Search people…' },
  { kind: 'tag', label: 'Tag', search: 'Search tags…' },
  { kind: 'status', label: 'Status', search: 'Search statuses…' },
  { kind: 'list', label: 'List', search: 'Search lists…' },
]

interface PickerRow {
  id: number
  name: string
  mark: ReactNode
  /** Its open tasks under the widget's screen filter (none for a list). */
  count?: number
}

/**
 * What a Review widget reviews (item 12, board BK): Person · Tag · Status ·
 * List (this layout's lists), a search field, and a row per choice with its
 * open tasks under the screen filter as the widget applies it (a list's
 * aren't counted: each is a build of its own). A click — or ⏎ in the
 * search, the first row — picks; Esc closes.
 */
export function ReviewPicker({ anchorRef, pick, onPick, onClose }: {
  anchorRef: RefObject<HTMLElement | null>
  pick: ReviewPick | undefined
  onPick: (pick: ReviewPick) => void
  onClose: () => void
}) {
  const [segment, setSegment] = useState<ReviewPickKind>(pick?.kind ?? 'person')
  const [query, setQuery] = useState('')
  const rows = usePickerRows(segment)
  const q = query.trim().toLowerCase()
  const shown = q === '' ? rows : rows.filter((r) => r.name.toLowerCase().includes(q))
  const choose = (id: number) => {
    onPick({ kind: segment, id })
    onClose()
  }
  const onSearchKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    const first = shown[0]
    if (first) choose(first.id)
  }
  const placeholder = SEGMENTS.find((s) => s.kind === segment)?.search ?? 'Search…'
  return (
    <AnchoredPicker anchorRef={anchorRef} onClose={onClose} closeOnEscape>
      <div className={styles.picker} role="dialog" aria-label="What to review" data-review-picker="">
        <div className={styles.segments} role="radiogroup" aria-label="Review by">
          {SEGMENTS.map((s) => (
            <button
              key={s.kind}
              type="button"
              role="radio"
              aria-checked={segment === s.kind}
              className={styles.segment}
              onClick={() => { setSegment(s.kind); setQuery('') }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <input
          className={styles.pickerSearch}
          value={query}
          placeholder={placeholder}
          aria-label={placeholder}
          autoFocus
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
        />
        <div className={styles.pickerRows} role="listbox" aria-label={SEGMENTS.find((s) => s.kind === segment)?.label}>
          {shown.length === 0 && <p className={styles.pickerEmpty}>{rows.length === 0 ? emptyWords(segment) : 'No match'}</p>}
          {shown.map((r) => {
            const on = pick?.kind === segment && pick.id === r.id
            return (
              <button
                key={r.id}
                type="button"
                role="option"
                aria-selected={on}
                className={styles.pickerRow}
                data-on={on || undefined}
                onClick={() => choose(r.id)}
              >
                {r.mark}
                <span className={styles.pickerName}>{r.name}</span>
                {r.count != null && <span className={styles.pickerCount}>{r.count}</span>}
              </button>
            )
          })}
        </div>
      </div>
    </AnchoredPicker>
  )
}

function emptyWords(kind: ReviewPickKind): string {
  switch (kind) {
    case 'person': return 'No people yet'
    case 'tag': return 'No tags yet'
    case 'status': return 'No statuses yet'
    case 'list': return 'This layout has no lists'
  }
}

/** The picker's rows for `kind`, with their open-task counts (the widget's screen filter). */
function usePickerRows(kind: ReviewPickKind): PickerRow[] {
  const base = useStatsBase()
  const people = usePersonStore((s) => s.people)
  const tags = useTagStore((s) => s.tags)
  const statuses = useStatusStore((s) => s.statuses)
  const lists = useListDefinitionStore((s) => s.listDefinitions)
  const layoutId = useListOwnerLayoutId()
  const counts = useMemo(() => {
    const byPerson = new Map<number, number>()
    const byTag = new Map<number, number>()
    const byStatus = new Map<number, number>()
    const bump = (m: Map<number, number>, id: number | undefined) => { if (id != null) m.set(id, (m.get(id) ?? 0) + 1) }
    for (const t of base.shown) {
      if (t.isCompleted) continue
      for (const p of base.ctx.assignedPeopleMap.get(t.id) ?? []) bump(byPerson, p.id)
      for (const g of base.ctx.assignedTagsMap.get(t.id) ?? []) bump(byTag, g.id)
      bump(byStatus, t.statusId)
    }
    return { byPerson, byTag, byStatus }
  }, [base])
  return useMemo<PickerRow[]>(() => {
    switch (kind) {
      case 'person':
        return [...people].sort((a, b) => a.name.localeCompare(b.name)).flatMap((p) => (p.id == null ? [] : [{
          id: p.id,
          name: p.name,
          count: counts.byPerson.get(p.id) ?? 0,
          mark: <span className={styles.avatar} style={{ background: p.color || NEUTRAL_PERSON_COLOR }} aria-hidden="true">{p.name.replace(/^Org: /, '').charAt(0)}</span>,
        }]))
      case 'tag':
        return [...tags].sort((a, b) => a.name.localeCompare(b.name)).flatMap((g) => (g.id == null ? [] : [{
          id: g.id,
          name: `#${g.name}`,
          count: counts.byTag.get(g.id) ?? 0,
          mark: <span className={styles.dot} style={{ background: g.color || 'var(--color-text-muted)' }} aria-hidden="true" />,
        }]))
      case 'status':
        return [...statuses].sort(bySortOrder).flatMap((st) => (st.id == null ? [] : [{
          id: st.id,
          name: st.name,
          count: counts.byStatus.get(st.id) ?? 0,
          mark: <span className={styles.statusMark} style={{ color: st.color }} aria-hidden="true"><StatusIcon icon={st.icon ?? DEFAULT_STATUS_ICON} filled /></span>,
        }]))
      case 'list':
        return listedLists([...lists].sort(bySortOrder), layoutId).map((d) => ({
          id: d.id,
          name: d.name,
          mark: <span className={styles.statusMark} aria-hidden="true"><WidgetKindIcon kind="lens" size={14} /></span>,
        }))
    }
  }, [kind, people, tags, statuses, lists, layoutId, counts])
}
