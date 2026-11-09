import type { DataRow, DataSet } from '../../schema-upgrades'

/**
 * v78, part 4 (D26 P8) — People, Tags and Status become Breakdowns: each
 * such tab becomes a `breakdown` tab with the same id, over every open task
 * (no filter), as bars, counting:
 *
 * | v77 kind | name   | splitBy | showNone           |
 * |----------|--------|---------|--------------------|
 * | people   | People | people  | its `showUnassigned` |
 * | tags     | Tags   | tags    | its `showUntagged`   |
 * | status   | Status | status  | shown              |
 *
 * (A missing or bad `showUnassigned` / `showUntagged` reads as shown, the
 * old default.) Over the `layouts` table, and kept layout drafts (through
 * the pipeline: each body read as a layout row), after `layout-table`
 * (cells with tabs). Holds its own copy of the shapes it writes, so it goes
 * on meaning this whatever later builds do. Defensive: a cell or tab that
 * isn't an object is left as it is (the layout repair handles it); a
 * Breakdown is left alone (idempotent).
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** No filter: every open task (the stored empty predicate). */
function noFilter(): Obj {
  return { showCompleted: false, personIds: null, statusIds: null, searchText: '', dates: {}, markers: null, tags: null }
}

const CONVERTED = {
  people: { name: 'People', noneKey: 'showUnassigned' },
  tags: { name: 'Tags', noneKey: 'showUntagged' },
  status: { name: 'Status', noneKey: null },
} as const

type V77Kind = keyof typeof CONVERTED

function isConvertedKind(v: unknown): v is V77Kind {
  return v === 'people' || v === 'tags' || v === 'status'
}

/** The Breakdown config a v77 People / Tags / Status tab becomes. */
export function breakdownConfigOfKind(kind: V77Kind, config: unknown): Obj {
  const { name, noneKey } = CONVERTED[kind]
  const raw = isRecord(config) && noneKey ? config[noneKey] : undefined
  return {
    name,
    filter: noFilter(),
    splitBy: kind,
    style: 'bars',
    show: 'count',
    showNone: typeof raw === 'boolean' ? raw : true,
  }
}

/** A People / Tags / Status tab as a Breakdown; `null` for any other. */
function convertTab(tab: unknown): Obj | null {
  if (!isRecord(tab) || !isConvertedKind(tab.kind)) return null
  return { id: tab.id, kind: 'breakdown', config: breakdownConfigOfKind(tab.kind, tab.config) }
}

/** A layout row (or a kept draft's body) with its People, Tags and Status tabs converted; the row itself when nothing changes. */
export function layoutBreakdownsOf(row: DataRow): DataRow {
  if (!isRecord(row) || !Array.isArray(row.cells)) return row
  let changed = false
  const cells = (row.cells as unknown[]).map((cell) => {
    if (!isRecord(cell) || !Array.isArray(cell.tabs)) return cell
    let cellChanged = false
    const tabs = (cell.tabs as unknown[]).map((tab) => {
      const next = convertTab(tab)
      if (!next) return tab
      cellChanged = true
      return next
    })
    if (!cellChanged) return cell
    changed = true
    return { ...cell, tabs }
  })
  return changed ? { ...row, cells } : row
}

export function upgradeBreakdown(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(layoutBreakdownsOf)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
