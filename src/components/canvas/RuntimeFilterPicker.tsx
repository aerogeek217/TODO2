import { useMemo } from 'react'
import type { RuntimeFilterSpec } from '../../models/list-definition'
import { usePersonStore } from '../../stores/person-store'
import { useOrgStore } from '../../stores/org-store'
import { useProjectStore } from '../../stores/project-store'
import { useStatusStore } from '../../stores/status-store'
import styles from './RuntimeFilterPicker.module.css'

interface Option {
  id: number
  name: string
}

interface RuntimeFilterPickerProps {
  spec: RuntimeFilterSpec
  value: number | undefined
  onChange: (value: number | undefined) => void
}

function defaultLabel(spec: RuntimeFilterSpec): string {
  if (spec.label && spec.label.trim()) return spec.label
  switch (spec.field) {
    case 'person': return 'Person'
    case 'org': return 'Org'
    case 'project': return 'Project'
    case 'status': return 'Status'
  }
}

/**
 * Single-value picker for a list-def's `runtimeFilter`. Native `<select>` for
 * compactness — the picker sits above the list body and is the card's first
 * user-interaction point, so we trade ChipSelector/ProjectPicker's richer
 * chrome for one-tap picking.
 */
export function RuntimeFilterPicker({ spec, value, onChange }: RuntimeFilterPickerProps) {
  const people = usePersonStore((s) => s.people)
  const orgs = useOrgStore((s) => s.orgs)
  const projects = useProjectStore((s) => s.projects)
  const statuses = useStatusStore((s) => s.statuses)

  const options = useMemo<Option[]>(() => {
    const base: Option[] = []
    switch (spec.field) {
      case 'person':
        for (const p of people) base.push({ id: p.id!, name: p.name })
        break
      case 'org':
        for (const o of orgs) base.push({ id: o.id!, name: o.name })
        break
      case 'project':
        for (const p of projects) {
          if (p.id == null) continue
          base.push({ id: p.id, name: p.name })
        }
        break
      case 'status':
        for (const s of statuses) base.push({ id: s.id!, name: s.name })
        break
    }
    return base.sort((a, b) => a.name.localeCompare(b.name))
  }, [spec.field, people, orgs, projects, statuses])

  const label = defaultLabel(spec)

  return (
    <div className={`${styles.row} nopan nodrag`}>
      <span className={styles.label}>{label}</span>
      <select
        className={styles.select}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          onChange(raw === '' ? undefined : Number(raw))
        }}
        aria-label={`Filter tasks by ${label.toLowerCase()}`}
      >
        <option value="">Pick a {label.toLowerCase()}…</option>
        {options.map((opt) => (
          <option key={opt.id} value={opt.id}>{opt.name}</option>
        ))}
      </select>
    </div>
  )
}
