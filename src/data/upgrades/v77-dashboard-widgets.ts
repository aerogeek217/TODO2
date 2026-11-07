import type { DataRow, DataSet } from '../schema-upgrades'

/**
 * v77 — the Dashboard retires: every `dashboard` tab becomes the glance
 * widgets its parts are now (D25 N), each part a tab of its own cell.
 *
 * A Dashboard's parts, in order (its config read as the Dashboard read it:
 * known ids, each once; a part it lacks — `tiles`, `listTiles`,
 * `sections` — takes the default a new Dashboard had):
 *
 * - each tile → a `number` tab `{ metric: <tile> }`;
 * - each list tile → a `lens` tab `{ listDefinitionId }` (so the layout
 *   still names the list, `layoutListRefs`);
 * - each section → its glance kind's tab, its options as the config (a
 *   missing one its default): `eisenhower` → `eisenhowerSummary`, the rest
 *   keep their ids. The tab's `detailsWidth` (view state) goes to the
 *   task-row ones (`followup`, `stale`, `recent`).
 *
 * Where they go:
 *
 * - **In a column's cell:** the parts become new rows in that column, one
 *   tab per cell — the Number cells six to a row (fit rows: their weight is
 *   1, unused), then one row of the list tiles' cells (each weight 1), then
 *   the sections packed into rows as the Dashboard laid them out (12
 *   columns, in order, a new row when the next doesn't fit, a row's last
 *   stretched to fill it), each cell's width weight its span. The new
 *   weighted rows share the old row's weight: each section row one share,
 *   the list row a quarter of one (it was the Dashboard's short 56px band).
 *   When the Dashboard tab was its cell's only tab and its cell its row's
 *   only cell, the new rows replace that row; otherwise the cell keeps its
 *   other tabs (and the row its other cells), the new rows go directly
 *   below it and the kept row counts as one share too. A collapsed row's
 *   new rows are collapsed.
 * - **In a band:** each part becomes a cell of the band's row, beside the
 *   Dashboard's cell (in its place when it held nothing else) — weights a
 *   Number 1, a list tile 2, a section its own span; scaled to the cell's
 *   weight when the band has other cells, so they keep their share.
 * - A cell whose active tab was a Dashboard that goes shows the next tab
 *   (else the one before it).
 * - A Dashboard with no parts just goes; a cell, row, column or band left
 *   with nothing goes too (a column left with only collapsed rows, when the
 *   removed row wasn't, expands the row above, else its first — as the
 *   layout's edits do).
 *
 * Fresh ids: a part's tab `<tab>-n<i>`, its cell `<tab>-c<i>`, a new row
 * `<tab>-r<i>` (`i` from 1), cut so the result stays within the 100
 * characters an id may have, with `_2`, `_3`, … after it when the layout
 * already holds that id — every id it holds, at any level, and every one
 * minted before — so the same layout always upgrades to the same ids, and a
 * draft's base upgrades to what its stored layout does.
 *
 * Over the `layouts` table, and kept layout drafts (through the pipeline:
 * each body read as a layout row). Holds its own copy of everything it
 * reads — the tile and section ids, the defaults, the option choices, the
 * spans and the packing — so it goes on meaning this whatever later builds
 * do. A part it can't read (a column without `rows`, a row or band without
 * `cells`, a cell without `tabs`, a part that isn't an object) passes
 * through, for the layout repair; a layout without a Dashboard is returned
 * as it is.
 */

type Obj = Record<string, unknown>

function isRecord(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// ── The Dashboard's config, as v76 read it ──────────────────────────────────

const TILE_IDS: readonly string[] = ['open', 'focus', 'urgent', 'overdue', 'followupDue', 'dueToday', 'dueNext7', 'noFollowup']
const DEFAULT_TILES: readonly string[] = ['open', 'focus', 'urgent', 'overdue', 'followupDue']
const DEFAULT_SECTIONS: readonly string[] = ['followup', 'next7', 'trend', 'status', 'people']

/** Each section's span of the Dashboard's 12-column grid, its widget kind, and its config from its options. */
const SECTIONS: Readonly<Record<string, { span: number; kind: string; config: (o: Obj) => Obj }>> = {
  followup: { span: 4, kind: 'followup', config: (o) => ({ lookAhead: oneOf(o.lookAhead, [3, 7, 14], 7) }) },
  next7: { span: 3, kind: 'next7', config: () => ({}) },
  trend: { span: 5, kind: 'trend', config: (o) => ({ range: oneOf(o.range, ['14d', '4w', '12w'], '14d') }) },
  status: { span: 3, kind: 'status', config: () => ({}) },
  people: { span: 4, kind: 'people', config: (o) => ({ showUnassigned: typeof o.showUnassigned === 'boolean' ? o.showUnassigned : true }) },
  tags: { span: 4, kind: 'tags', config: (o) => ({ showUntagged: typeof o.showUntagged === 'boolean' ? o.showUntagged : true }) },
  stale: { span: 5, kind: 'stale', config: (o) => ({ staleDays: oneOf(o.staleDays, [7, 14, 30, 60], 14) }) },
  recent: { span: 4, kind: 'recent', config: (o) => ({ recentDays: oneOf(o.recentDays, [7, 14, 30], 7) }) },
  eisenhower: { span: 3, kind: 'eisenhowerSummary', config: () => ({}) },
}

/** The section kinds that show task rows: they take the Dashboard's details width. */
const ROWS_KINDS: ReadonlySet<string> = new Set(['followup', 'stale', 'recent'])

const GRID_COLUMNS = 12
const NUMBERS_PER_ROW = 6
/** A list row's share of the old row's height, against a section row's 1. */
const LIST_ROW_SHARE = 0.25
/** A list tile's width weight in a band (a Number's is 1, a section's its span). */
const BAND_LIST_WEIGHT = 2

function oneOf<T>(v: unknown, choices: readonly T[], fallback: T): T {
  return (choices as readonly unknown[]).includes(v) ? (v as T) : fallback
}

interface Section {
  id: string
  options: Obj
}

interface DashboardParts {
  tiles: string[]
  listTiles: number[]
  sections: Section[]
}

function partsOf(raw: unknown): DashboardParts {
  const config = isRecord(raw) ? raw : {}
  const tiles = Array.isArray(config.tiles)
    ? [...new Set(config.tiles.filter((t): t is string => TILE_IDS.includes(t as string)))]
    : [...DEFAULT_TILES]
  const listTiles = Array.isArray(config.listTiles)
    ? [...new Set(config.listTiles.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))]
    : []
  let sections: Section[] = DEFAULT_SECTIONS.map((id) => ({ id, options: {} }))
  if (Array.isArray(config.sections)) {
    const seen = new Set<string>()
    sections = []
    for (const s of config.sections) {
      if (!isRecord(s) || typeof s.id !== 'string' || !Object.hasOwn(SECTIONS, s.id) || seen.has(s.id)) continue
      seen.add(s.id)
      sections.push({ id: s.id, options: isRecord(s.options) ? s.options : {} })
    }
  }
  return { tiles, listTiles, sections }
}

/** The sections in rows of the 12-column grid: in order, a new row when the next doesn't fit, a row's last stretched to fill it. */
function packSections(sections: readonly Section[]): Array<Array<{ section: Section; span: number }>> {
  const rows: Array<Array<{ section: Section; span: number }>> = []
  let row: Array<{ section: Section; span: number }> = []
  let used = 0
  const close = () => {
    const last = row.at(-1)
    if (last) {
      last.span += GRID_COLUMNS - used
      rows.push(row)
    }
    row = []
    used = 0
  }
  for (const section of sections) {
    const span = SECTIONS[section.id]?.span ?? GRID_COLUMNS
    if (used + span > GRID_COLUMNS) close()
    row.push({ section, span })
    used += span
  }
  close()
  return rows
}

// ── Ids ─────────────────────────────────────────────────────────────────────

/** The longest id a layout part may have (`layout-shape`'s limit). */
const MAX_ID_LEN = 100

/** Every string `id` anywhere under `node`. */
function collectIds(node: unknown, into: Set<string>): void {
  if (Array.isArray(node)) {
    for (const item of node) collectIds(item, into)
    return
  }
  if (!isRecord(node)) return
  if (typeof node.id === 'string') into.add(node.id)
  for (const [key, value] of Object.entries(node)) if (key !== 'id') collectIds(value, into)
}

/** Mints `<base><suffix>` (`_2`, `_3`, … after it when taken), unique against `taken` and every id it minted before. */
function idMinter(taken: Set<string>): (base: unknown, suffix: string) => string {
  return (base, suffix) => {
    const stem = typeof base === 'string' && base !== '' ? base : 'part'
    for (let n = 1; ; n++) {
      const tail = n === 1 ? suffix : `${suffix}_${n}`
      const id = `${stem.slice(0, MAX_ID_LEN - tail.length)}${tail}`
      if (!taken.has(id)) {
        taken.add(id)
        return id
      }
    }
  }
}

type Mint = ReturnType<typeof idMinter>

// ── The parts as tabs ───────────────────────────────────────────────────────

interface Part {
  tab: Obj
  /** `number`, `list` or `section`. */
  what: 'number' | 'list' | 'section'
  /** A section's span once packed (its cell's width weight in a column). */
  span: number
  /** A section's own span (its width weight in a band). */
  ownSpan: number
}

function isDashboard(tab: unknown): tab is Obj {
  return isRecord(tab) && tab.kind === 'dashboard'
}

/** A cell (with a list of tabs) holding a Dashboard tab. */
function holdsDashboardTab(cell: unknown): cell is Obj & { tabs: unknown[] } {
  return isRecord(cell) && Array.isArray(cell.tabs) && cell.tabs.some(isDashboard)
}

function isWeight(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

/**
 * A Dashboard tab's parts, each a tab with its fresh id, in order: the
 * Numbers, the list tiles, then the sections (the sections packed into
 * rows, `sectionRows`).
 */
function tabParts(dash: Obj, mint: Mint): { numbers: Part[]; lists: Part[]; sectionRows: Part[][] } {
  const parts = partsOf(dash.config)
  const width = isRecord(dash.viewState) ? dash.viewState.detailsWidth : undefined
  let i = 0
  const tabId = () => mint(dash.id, `-n${++i}`)
  const numbers = parts.tiles.map((metric): Part => ({
    tab: { id: tabId(), kind: 'number', config: { metric } }, what: 'number', span: 1, ownSpan: 1,
  }))
  const lists = parts.listTiles.map((listDefinitionId): Part => ({
    tab: { id: tabId(), kind: 'lens', config: { listDefinitionId } }, what: 'list', span: 1, ownSpan: 1,
  }))
  const sectionRows = packSections(parts.sections).map((row) => row.map(({ section, span }): Part => {
    const spec = SECTIONS[section.id]!
    const tab: Obj = { id: tabId(), kind: spec.kind, config: spec.config(section.options) }
    if (ROWS_KINDS.has(spec.kind) && width !== undefined) tab.viewState = { detailsWidth: width }
    return { tab, what: 'section', span, ownSpan: spec.span }
  }))
  return { numbers, lists, sectionRows }
}

/** Each part's cell: one tab, its id `<tab>-c<i>`. */
function cellOf(dashId: unknown, part: Part, weight: number, mint: Mint, i: number): Obj {
  return { id: mint(dashId, `-c${i}`), weight, tabs: [part.tab] }
}

/** A cell's tabs without its Dashboards, its active tab moved off one that goes. */
function withoutDashboards(cell: Obj, tabs: unknown[]): Obj {
  const kept = tabs.filter((t) => !isDashboard(t))
  const active = tabs.find((t) => isRecord(t) && t.id === cell.activeTabId) ?? tabs[0]
  const out: Obj = { ...cell, tabs: kept }
  if (isDashboard(active)) {
    const at = tabs.indexOf(active)
    const next = tabs.slice(at + 1).find((t) => !isDashboard(t)) ?? tabs.slice(0, at).reverse().find((t) => !isDashboard(t))
    if (isRecord(next) && next.id !== undefined) out.activeTabId = next.id
    else delete out.activeTabId
  }
  return out
}

// ── Columns ─────────────────────────────────────────────────────────────────

/**
 * The new rows for one Dashboard, in order, each with its share of the old
 * row's height (0 for a fit row of Numbers, which takes none: weight 1).
 */
function columnRowsFor(dash: Obj, mint: Mint, collapsed: boolean): Array<{ row: Obj; share: number }> {
  const { numbers, lists, sectionRows } = tabParts(dash, mint)
  const out: Array<{ row: Obj; share: number }> = []
  let r = 0
  let c = 0
  const add = (parts: Part[], weightOf: (p: Part) => number, share: number) => {
    const id = mint(dash.id, `-r${++r}`)
    const cells = parts.map((p) => cellOf(dash.id, p, weightOf(p), mint, ++c))
    out.push({ row: { id, weight: 1, ...(collapsed ? { collapsed: true } : {}), cells }, share })
  }
  for (let at = 0; at < numbers.length; at += NUMBERS_PER_ROW) add(numbers.slice(at, at + NUMBERS_PER_ROW), () => 1, 0)
  if (lists.length > 0) add(lists, () => 1, LIST_ROW_SHARE)
  for (const parts of sectionRows) add(parts, (p) => p.span, 1)
  return out
}

/** `rows` with `rows[at]` removed, the row above (else the first) expanded when it was the last expanded one. */
function removeRow(rows: unknown[], at: number): unknown[] {
  const gone = rows[at]
  const rest = rows.filter((_, i) => i !== at)
  const lostLastExpanded = !(isRecord(gone) && gone.collapsed === true)
    && rest.length > 0 && rest.every((r) => isRecord(r) && r.collapsed === true)
  if (!lostLastExpanded) return rest
  const heirIdx = at - 1 >= 0 ? at - 1 : 0
  return rest.map((r, i) => {
    if (i !== heirIdx || !isRecord(r)) return r
    const { collapsed: _drop, ...open } = r
    void _drop
    return open
  })
}

/**
 * What takes a row's place once its Dashboards are converted: the row kept
 * (with its other cells and tabs; none when nothing is left of it), then the
 * new rows; `null` when it holds no Dashboard.
 */
function upgradeRow(row: unknown, mint: Mint): unknown[] | null {
  if (!isRecord(row) || !Array.isArray(row.cells)) return null
  const cells = row.cells as unknown[]
  if (!cells.some(holdsDashboardTab)) return null
  const collapsed = row.collapsed === true
  const keptCells: unknown[] = []
  const added: Array<{ row: Obj; share: number }> = []
  for (const cell of cells) {
    if (!holdsDashboardTab(cell)) {
      keptCells.push(cell)
      continue
    }
    const tabs = cell.tabs as unknown[]
    const kept = withoutDashboards(cell, tabs)
    if ((kept.tabs as unknown[]).length > 0) keptCells.push(kept)
    for (const dash of tabs.filter(isDashboard)) added.push(...columnRowsFor(dash, mint, collapsed))
  }
  const keptRow = keptCells.length > 0 ? { ...row, cells: keptCells } : null
  if (added.length === 0) return keptRow ? [keptRow] : []
  // The weighted new rows (and the kept one) share the old row's weight.
  const weight = isWeight(row.weight) ? row.weight : 1
  const shares = added.reduce((sum, a) => sum + a.share, 0) + (keptRow ? 1 : 0)
  const sized = added.map(({ row: r, share }) => (share > 0 ? { ...r, weight: (weight * share) / shares } : r))
  return keptRow ? [{ ...keptRow, weight: weight / shares }, ...sized] : sized
}

/** A column with its Dashboards converted; `null` when nothing is left of it; the column itself when it holds none. */
function upgradeColumn(col: unknown, mint: Mint): unknown {
  if (!isRecord(col) || !Array.isArray(col.rows)) return col
  let rows = col.rows as unknown[]
  let changed = false
  for (let at = 0; at < rows.length; at++) {
    const placed = upgradeRow(rows[at], mint)
    if (!placed) continue
    changed = true
    if (placed.length === 0) {
      rows = removeRow(rows, at)
      at--
      continue
    }
    rows = [...rows.slice(0, at), ...placed, ...rows.slice(at + 1)]
    at += placed.length - 1
  }
  if (!changed) return col
  return rows.length > 0 ? { ...col, rows } : null
}

// ── Bands ───────────────────────────────────────────────────────────────────

/** A band with its Dashboards converted; `null` when it is left without cells; the band itself when it holds none. */
function upgradeBand(band: unknown, mint: Mint): unknown {
  if (!isRecord(band) || !Array.isArray(band.cells)) return band
  const cells = band.cells as unknown[]
  if (!cells.some(holdsDashboardTab)) return band
  const out: unknown[] = []
  for (const cell of cells) {
    if (!holdsDashboardTab(cell)) {
      out.push(cell)
      continue
    }
    const tabs = cell.tabs
    const keptCell = withoutDashboards(cell, tabs)
    const keeps = (keptCell.tabs as unknown[]).length > 0
    const added: Array<{ cell: Obj; weight: number }> = []
    for (const dash of tabs.filter(isDashboard)) {
      const { numbers, lists, sectionRows } = tabParts(dash, mint)
      let c = 0
      for (const p of [...numbers, ...lists, ...sectionRows.flat()]) {
        const weight = p.what === 'number' ? 1 : p.what === 'list' ? BAND_LIST_WEIGHT : p.ownSpan
        added.push({ cell: cellOf(dash.id, p, weight, mint, ++c), weight })
      }
    }
    // Beside other cells, the parts share what the Dashboard's cell had.
    const weight = isWeight(cell.weight) ? cell.weight : 1
    const total = added.reduce((sum, a) => sum + a.weight, 0)
    const scale = total > 0 && (cells.length > 1 || keeps) ? weight / total : 1
    if (keeps) out.push(keptCell)
    for (const a of added) out.push(scale === 1 ? a.cell : { ...a.cell, weight: a.weight * scale })
  }
  return out.length > 0 ? { ...band, cells: out } : null
}

// ── Layouts ─────────────────────────────────────────────────────────────────

function holdsDashboard(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(holdsDashboard)
  if (!isRecord(node)) return false
  return isDashboard(node) || Object.values(node).some(holdsDashboard)
}

/** A layout row (or a kept draft's body) with its Dashboards converted; the row itself when it has none. */
function upgradeLayout(row: DataRow): DataRow {
  if (!isRecord(row) || !holdsDashboard([row.columns, row.top, row.bottom])) return row
  const taken = new Set<string>()
  collectIds([row.columns, row.top, row.bottom], taken)
  const mint = idMinter(taken)
  let out: DataRow = row
  if (Array.isArray(row.columns)) {
    const columns = (row.columns as unknown[]).map((col) => upgradeColumn(col, mint))
    if (columns.some((col, i) => col !== (row.columns as unknown[])[i])) {
      out = { ...out, columns: columns.filter((col) => col !== null) }
    }
  }
  for (const edge of ['top', 'bottom'] as const) {
    if (row[edge] === undefined) continue
    const band = upgradeBand(row[edge], mint)
    if (band === row[edge]) continue
    if (band === null) {
      const { [edge]: _gone, ...rest } = out
      void _gone
      out = rest
    } else {
      out = { ...out, [edge]: band }
    }
  }
  return out
}

export function upgradeV77(data: DataSet): DataSet {
  const layouts = data.layouts
  if (!layouts) return data
  const next = layouts.map(upgradeLayout)
  if (next.every((row, i) => row === layouts[i])) return data
  return { ...data, layouts: next }
}
