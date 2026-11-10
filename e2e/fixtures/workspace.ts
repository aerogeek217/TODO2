import { expect, type Locator, type Page } from '@playwright/test'
import { createTab, WIDGET_KINDS, widgetKindLabel, widgetKindsOf, type LayoutTab, type WidgetKind } from '../../src/models/workspace-layout'
import { layoutTableOf } from '../../src/data/upgrades/v78/layout-table'
import { isV77Metric, numberConfigOfMetric } from '../../src/data/upgrades/v78/number-metrics'
import { DB_NAME, readStore } from './db'
import { box, pointIn, type Point } from './geometry'

export interface WsTabSeed {
  id: string
  kind: WidgetKind
  /** List tabs: index into `listDefinitions`. (The Eisenhower's list is a setting: `WorkspaceSeed.eisenhower`.) */
  listDefIdx?: number
  /** Calendar tabs: date types shown (default both). */
  dateTypes?: { due: boolean; followup: boolean }
  /** Calendar tabs: view state. */
  view?: 'month' | 'week'
  offset?: number
  /** Calendar tabs: the month shows titled bars (view state; default off = the heat map). */
  titles?: boolean
  /** Eisenhower tabs: collapsed sections (view state). */
  collapsed?: Array<'do' | 'schedule' | 'delegate' | 'drop'>
  /** List / Eisenhower tabs: the task rows' details width (view state). */
  detailsWidth?: number
  /** List tabs: the zoom (view state; absent = the Settings default; `strips`, a removed level, opens as `lines`). */
  zoom?: 'stacked' | 'rows' | 'lines' | 'strips'
  /**
   * Glance tabs (Number, the sections): config fields over the kind's defaults. A Number's
   * `metric` (a v77 one, e.g. `{ metric: 'open' }`) seeds the config v78 converts it to
   * (`numberConfigOfMetric`), its other fields over that.
   */
  glance?: Record<string, unknown>
  /** Project pulse tabs: the picked tags (names from `tags`; default none). */
  tagNames?: string[]
  /** Neglect map tabs: the config (defaults: colour by no tags, 14 days). */
  neglect?: {
    /** Colour by these tags (names from `tags`), by people, or not at all. */
    colourBy?: { tags: string[] } | 'people' | 'none'
    untouchedDays?: number
  }
  /** Review tabs (item 12): the pick — a person or tag by name, or a list (index into `listDefinitions`). */
  review?: { person?: string; tag?: string; listDefIdx?: number }
}

export interface WsCellSeed {
  id: string
  /** Columns / bands form: its share of the row's width (default 1). */
  weight?: number
  tabs: WsTabSeed[]
  activeTabId?: string
}

export interface WsRowSeed {
  /** Default `<first cell's id>-r`. */
  id?: string
  /** Its share of the column's height (default 1). */
  weight?: number
  collapsed?: boolean
  cells: WsCellSeed[]
}

export interface WsColumnSeed {
  id: string
  weight?: number
  rows: WsRowSeed[]
}

export interface WsBandSeed {
  id: string
  /** Height in px (default 160). */
  height?: number
  collapsed?: boolean
  cells: WsCellSeed[]
}

/** A row of one cell, its id `<cell>-r`: `extra` its height share and collapse. */
export function wsRow(cell: WsCellSeed, extra: Omit<WsRowSeed, 'cells'> = {}): WsRowSeed {
  return { ...extra, cells: [cell] }
}

/** A grid track's size: a weight (a number), or `{ px }` (fixed); `collapsed` on a row. */
export type WsTrackSeed = number | { weight?: number; px?: number; collapsed?: boolean }

/**
 * A layout drawn as a table (D26): `areas` a line per row track, each word a
 * column track holding a cell id — a cell over several tracks spans them.
 */
export interface WsTableSeed {
  areas: string[]
  cells: WsCellSeed[]
  /** Column / row track sizes (default weight 1000 each). */
  cols?: WsTrackSeed[]
  rows?: WsTrackSeed[]
}

/**
 * A layout: a `table` (D26), or — the shape most specs were written in —
 * columns of rows of cells with bands above and below, which the seed turns
 * into the table the v78 upgrade makes of it (`layout-table`).
 */
export interface WsLayoutSeed {
  name: string
  columns?: WsColumnSeed[]
  /** The full-width band above / below the columns. */
  top?: WsBandSeed
  bottom?: WsBandSeed
  table?: WsTableSeed
  /** The layout's hue (D19): a preset name or a hex colour. */
  hue?: string
}

/** A seeded layout's table: its tracks, and each cell's area with its tab seeds (built in the page). */
interface WsTable {
  grid: { columns: Array<Record<string, unknown>>; rows: Array<Record<string, unknown>> }
  cells: Array<{ id: string; area: { col: number; row: number; colSpan: number; rowSpan: number }; tabs: WsTabSeed[]; activeTabId?: string }>
}

function trackOf(id: string, spec: WsTrackSeed | undefined): Record<string, unknown> {
  if (spec == null) return { id, weight: 1000 }
  if (typeof spec === 'number') return { id, weight: spec }
  return { id, ...(spec.px != null ? { px: spec.px } : { weight: spec.weight ?? 1000 }), ...(spec.collapsed ? { collapsed: true } : {}) }
}

/** A layout seed as the table the app stores (tab seeds still to build). */
export function wsTableOf(layout: WsLayoutSeed): WsTable {
  if (layout.table) {
    const { areas, cells, cols, rows } = layout.table
    const lines = areas.map((line) => line.trim().split(/\s+/))
    const colCount = lines[0]?.length ?? 0
    const out: WsTable['cells'] = cells.map((cell) => {
      const at = lines.flatMap((line, r) => line.flatMap((id, c) => (id === cell.id ? [[r, c] as const] : [])))
      if (at.length === 0) throw new Error(`table seed: cell ${cell.id} is not in the areas`)
      const rs = at.map(([r]) => r)
      const cs = at.map(([, c]) => c)
      const area = { col: Math.min(...cs), row: Math.min(...rs), colSpan: Math.max(...cs) - Math.min(...cs) + 1, rowSpan: Math.max(...rs) - Math.min(...rs) + 1 }
      return { id: cell.id, area, tabs: cell.tabs, ...(cell.activeTabId ? { activeTabId: cell.activeTabId } : {}) }
    })
    out.sort((a, b) => a.area.row - b.area.row || a.area.col - b.area.col)
    return {
      grid: {
        columns: Array.from({ length: colCount }, (_, i) => trackOf(`c${i + 1}`, cols?.[i])),
        rows: lines.map((_, i) => trackOf(`r${i + 1}`, rows?.[i])),
      },
      cells: out,
    }
  }
  const cellRow = (cell: WsCellSeed) => ({ id: cell.id, weight: cell.weight ?? 1, tabs: cell.tabs, ...(cell.activeTabId ? { activeTabId: cell.activeTabId } : {}) })
  const v77 = {
    columns: (layout.columns ?? []).map((col) => ({
      id: col.id,
      weight: col.weight ?? 1,
      rows: col.rows.map((row) => ({
        id: row.id ?? `${row.cells[0]?.id ?? col.id}-r`,
        weight: row.weight ?? 1,
        ...(row.collapsed ? { collapsed: true } : {}),
        cells: row.cells.map(cellRow),
      })),
    })),
    ...Object.fromEntries((['top', 'bottom'] as const).flatMap((edge) => {
      const band = layout[edge]
      return band ? [[edge, { id: band.id, height: band.height ?? 160, ...(band.collapsed ? { collapsed: true } : {}), cells: band.cells.map(cellRow) }]] : []
    })),
  }
  return layoutTableOf(v77) as unknown as WsTable
}

/** `table` with each Number seeded by a v77 `metric` given the config v78 converts it to. */
function withNumberConfigs(table: WsTable): WsTable {
  return {
    ...table,
    cells: table.cells.map((cell) => ({
      ...cell,
      tabs: cell.tabs.map((tab) => {
        const { metric, ...rest } = tab.glance ?? {}
        if (tab.kind !== 'number' || !isV77Metric(metric)) return tab
        return { ...tab, glance: { ...numberConfigOfMetric(metric), ...rest } }
      }),
    })),
  }
}

/** The app-wide Eisenhower panes (a filter is merged over the empty predicate). */
export type EisenhowerPanesSeed = Partial<Record<'do' | 'schedule' | 'delegate' | 'drop', { name?: string; filter?: Record<string, unknown> }>>

export interface WorkspaceSeed {
  /** The first layout is opened. */
  layouts: WsLayoutSeed[]
  /**
   * The app-wide Eisenhower settings (every Eisenhower tab and Eisenhower
   * summary): its own list (index into `listDefinitions` — that list is
   * made the Eisenhower's, a hidden list; none = the one the app made, with
   * no filter) and its custom panes.
   */
  eisenhower?: { listDefIdx?: number; panes?: EisenhowerPanesSeed }
  /**
   * Lenses (the `lenses` settings row, the presets marked seeded so none are
   * added): each predicate merged over the empty one.
   */
  lenses?: Array<{ id: string; name: string; predicate?: Record<string, unknown> }>
  /**
   * Settings rows to store as they are (`key` → stored `value`), e.g. `{ rowDensity: 'lines' }`;
   * `null` stores none. The Default list zoom is seeded as Rows (`rowDensity: 'rows'`) unless given:
   * Auto (the app's default, no row — `{ rowDensity: null }`) would draw a cell under 480px Stacked.
   */
  settings?: Record<string, string | null>
  /** Names, or a name with initials / colour / email. */
  people?: Array<string | { name: string; initials?: string; color?: string; email?: string }>
  /** Names, or a name with its colour (default `#7ec4bc`). */
  tags?: Array<string | { name: string; color: string }>
  /** Status names, added after the app's own. */
  statuses?: string[]
  listDefinitions?: Array<{
    name: string
    grouping?: string
    sort?: string
    sortDirection?: 'asc' | 'desc'
    /** Merged over the empty predicate; `personIds` by name via `people`. */
    predicate?: Record<string, unknown>
    /** Names of people for the predicate's `personIds`. */
    people?: string[]
    runtimeFilter?: { field: 'person' | 'status' | 'tag' }
    /** `false` hides the list's filter line. */
    showFilterLine?: false
    /** The top bar's lens doesn't apply to the list. */
    ignoreLens?: true
    /** The layout (index into `layouts`) that owns the list; default: the first that shows it, else the first. */
    layoutIdx?: number
  }>
  tasks?: Array<{
    title: string
    people?: string[]
    tags?: string[]
    isCompleted?: boolean
    /** Days from today. */
    dueInDays?: number
    followupInDays?: number
    /** Hour of the due date (default midnight). */
    dueHour?: number
    recurrence?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly'
    /** Name of a status from `statuses`. */
    status?: string
    /** Task notes (Markdown). */
    notes?: string
    /** Status updates, newest first: each a text and its day (days from today, ≤ 0; default today). */
    statusUpdates?: Array<{ text: string; inDays?: number }>
    /** The task's checklist, in order. */
    subtasks?: Array<{ title: string; done?: boolean }>
    /** A fixed uid (default: a random UUID). */
    uid?: string
    /** Last modified (default: now), as a local date-time string, e.g. `2026-10-10T15:30`. */
    modifiedAt?: string
    /** Last modified this many days from now (negative = ago), at the current time of day. */
    modifiedInDays?: number
    /** Completed this many days from now (negative = ago), at the current time of day; implies `isCompleted`. */
    completedInDays?: number
    /** Last followed up this many days from now (negative = ago), at the current time of day. */
    lastFollowupInDays?: number
    /** Marker flags. */
    urgent?: boolean
    important?: boolean
    focus?: boolean
  }>
}

/** Mirrors `emptyPredicate()` in `models/filter-predicate`. */
export function emptyPredicate(): Record<string, unknown> {
  return {
    showCompleted: false,
    personIds: null,
    statusIds: null,
    searchText: '',
    dates: {},
    markers: null,
    tags: null,
  }
}

/**
 * Seeds layouts and list definitions (replacing the app's own), people, tags and
 * tasks straight into IndexedDB, then reloads on the workspace. The app must
 * have booted once (Dexie upgraded) — this opens the workspace (`/#/`, or
 * `url`: a built file's) first.
 */
export async function seedWorkspace(page: Page, seed: WorkspaceSeed, { url = '/#/' }: { url?: string } = {}): Promise<void> {
  await page.goto(url)
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  // Every kind's new tab, as the app makes it: the seeded tabs start from these.
  const newTabs = Object.fromEntries(WIDGET_KINDS.map((kind) => [kind, createTab(kind, '')])) as Record<WidgetKind, LayoutTab>
  const payload = { ...seed, tables: seed.layouts.map(wsTableOf).map(withNumberConfigs), predicate: emptyPredicate(), newTabs }
  await page.evaluate(async ({ db, seed }) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const add = (store: IDBObjectStore, value: unknown) => new Promise<number>((resolve, reject) => {
      const r = store.add(value)
      r.onsuccess = () => resolve(r.result as number)
      r.onerror = () => reject(r.error)
    })
    const tx = idb.transaction(['layouts', 'settings', 'listDefinitions', 'people', 'tags', 'statuses', 'todos', 'todoPeople', 'todoTags', 'statusUpdates', 'subtasks'], 'readwrite')
    const get = (store: IDBObjectStore, key: number) => new Promise<Record<string, unknown>>((resolve, reject) => {
      const r = store.get(key)
      r.onsuccess = () => resolve(r.result as Record<string, unknown>)
      r.onerror = () => reject(r.error)
    })
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('seed aborted'))
    })
    const now = new Date()
    const personIds = new Map<string, number>()
    for (const entry of seed.people ?? []) {
      const p = typeof entry === 'string' ? { name: entry } : entry
      const row: Record<string, unknown> = { name: p.name, initials: p.initials ?? p.name.slice(0, 2).toUpperCase() }
      if (p.color) row.color = p.color
      if (p.email) row.email = p.email
      personIds.set(p.name, await add(tx.objectStore('people'), row))
    }
    const tagIds = new Map<string, number>()
    for (const entry of seed.tags ?? []) {
      const { name, color } = typeof entry === 'string' ? { name: entry, color: '#7ec4bc' } : entry
      tagIds.set(name, await add(tx.objectStore('tags'), { name, color }))
    }
    const statusIds = new Map<string, number>()
    let statusOrder = 100
    for (const name of seed.statuses ?? []) {
      statusIds.set(name, await add(tx.objectStore('statuses'), { name, color: '#4caf50', icon: 'circle', sortOrder: ++statusOrder }))
    }
    // The seed's lists replace the app's own (the Eisenhower's list it made
    // at launch): the app makes that again on the reload unless the seed
    // names one (`eisenhower.listDefIdx`).
    tx.objectStore('listDefinitions').clear()
    const defIds: number[] = []
    let defOrder = 0
    for (const def of seed.listDefinitions ?? []) {
      const predicate: Record<string, unknown> = { ...seed.predicate, ...(def.predicate ?? {}) }
      if (def.people) predicate.personIds = def.people.map((n) => personIds.get(n))
      defIds.push(await add(tx.objectStore('listDefinitions'), {
        name: def.name,
        sortOrder: ++defOrder,
        membership: { kind: 'custom', predicate },
        sort: def.sort ?? 'manual',
        ...(def.sortDirection ? { sortDirection: def.sortDirection } : {}),
        grouping: def.grouping ?? 'none',
        ...(def.runtimeFilter ? { runtimeFilter: def.runtimeFilter } : {}),
        ...(def.showFilterLine === false ? { showFilterLine: false } : {}),
        ...(def.ignoreLens ? { ignoreLens: true } : {}),
        ...(seed.eisenhower?.listDefIdx === defIds.length ? { owner: { eisenhower: true } } : {}),
      }))
    }
    let taskOrder = 0
    for (const task of seed.tasks ?? []) {
      const day = (n: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n)
      const atDay = (n: number) => {
        const d = new Date(now)
        d.setDate(d.getDate() + n)
        return d
      }
      const completed = task.isCompleted === true || task.completedInDays != null
      const modifiedAt = task.modifiedInDays != null ? atDay(task.modifiedInDays) : task.modifiedAt ? new Date(task.modifiedAt) : now
      const todoId = await add(tx.objectStore('todos'), {
        uid: task.uid ?? crypto.randomUUID(),
        title: task.title,
        isCompleted: completed,
        ...(completed ? { completedAt: task.completedInDays != null ? atDay(task.completedInDays) : now } : {}),
        ...(task.dueInDays != null ? { dueDate: new Date(day(task.dueInDays).setHours(task.dueHour ?? 0)) } : {}),
        ...(task.recurrence ? { recurrenceRule: { type: task.recurrence } } : {}),
        ...(task.followupInDays != null ? { nextFollowupAt: day(task.followupInDays) } : {}),
        ...(task.lastFollowupInDays != null ? { lastFollowupAt: atDay(task.lastFollowupInDays) } : {}),
        ...(task.status != null ? { statusId: statusIds.get(task.status) } : {}),
        ...(task.urgent ? { urgent: true } : {}),
        ...(task.important ? { important: true } : {}),
        ...(task.focus ? { focus: true } : {}),
        ...(task.notes ? { notes: task.notes } : {}),
        // A task changed days ago was created no later than that.
        createdAt: task.modifiedInDays != null && modifiedAt < now ? modifiedAt : now,
        modifiedAt,
        sortOrder: ++taskOrder,
      })
      for (const p of task.people ?? []) await add(tx.objectStore('todoPeople'), { todoId, personId: personIds.get(p) })
      for (const t of task.tags ?? []) await add(tx.objectStore('todoTags'), { todoId, tagId: tagIds.get(t) })
      // Written newest first, each a moment older than the one before (same-day order).
      for (const [i, u] of (task.statusUpdates ?? []).entries()) {
        await add(tx.objectStore('statusUpdates'), { todoId, date: day(u.inDays ?? 0), text: u.text, createdAt: new Date(now.getTime() - i * 1000) })
      }
      for (const [i, s] of (task.subtasks ?? []).entries()) {
        await add(tx.objectStore('subtasks'), { todoId, title: s.title, isCompleted: s.done === true, sortOrder: i, createdAt: new Date(now.getTime() - 60_000 + i * 1000) })
      }
    }
    tx.objectStore('layouts').clear()
    let firstId: number | null = null
    const layoutIds: number[] = []
    type TabSeed = (typeof seed.tables)[number]['cells'][number]['tabs'][number]
    type CellSeed = (typeof seed.tables)[number]['cells'][number]
    const buildTab = (tab: TabSeed) => {
      const base = structuredClone(seed.newTabs[tab.kind])
      const out: Record<string, unknown> = { ...base, id: tab.id }
      const config = { ...(base.config as Record<string, unknown>) }
      if (tab.kind === 'lens' && tab.listDefIdx != null) {
        const listDefinitionId = defIds[tab.listDefIdx]
        if (listDefinitionId != null) config.listDefinitionId = listDefinitionId
      }
      if (tab.kind === 'calendar') {
        if (tab.dateTypes) config.dateTypes = tab.dateTypes
        if (tab.view != null || tab.offset != null) out.viewState = { view: tab.view ?? 'month', offset: tab.offset ?? 0 }
        if (tab.titles != null) out.viewState = { ...(out.viewState as object | undefined), titles: tab.titles }
      }
      if (tab.kind === 'eisenhower' && tab.collapsed) out.viewState = { collapsed: tab.collapsed }
      if (tab.kind === 'neglect' && tab.neglect) {
        const n = tab.neglect
        if (n.colourBy === 'people' || n.colourBy === 'none') config.colourBy = { kind: n.colourBy }
        else if (n.colourBy) config.colourBy = { kind: 'tags', tagIds: n.colourBy.tags.map((name) => tagIds.get(name)).filter((id) => id != null) }
        if (n.untouchedDays != null) config.untouchedDays = n.untouchedDays
      }
      if (tab.kind === 'pulse' && tab.tagNames) {
        config.tagIds = tab.tagNames.map((name) => tagIds.get(name)).filter((id) => id != null)
      }
      if (tab.kind === 'review' && tab.review) {
        const r = tab.review
        const id = r.person != null ? personIds.get(r.person) : r.tag != null ? tagIds.get(r.tag) : r.listDefIdx != null ? defIds[r.listDefIdx] : undefined
        const kind = r.person != null ? 'person' : r.tag != null ? 'tag' : 'list'
        if (id != null) config.pick = { kind, id }
      }
      if (tab.glance) Object.assign(config, tab.glance)
      if (tab.detailsWidth != null) out.viewState = { ...(out.viewState as object | undefined), detailsWidth: tab.detailsWidth }
      if (tab.zoom != null) out.viewState = { ...(out.viewState as object | undefined), zoom: tab.zoom }
      out.config = config
      return out
    }
    const buildCell = (cell: CellSeed) => ({
      id: cell.id,
      area: cell.area,
      ...(cell.tabs.length > 0 ? { activeTabId: cell.activeTabId ?? cell.tabs[0]?.id } : {}),
      tabs: cell.tabs.map(buildTab),
    })
    for (const [i, layout] of seed.layouts.entries()) {
      const table = seed.tables[i]!
      const id = await add(tx.objectStore('layouts'), { name: layout.name, sortOrder: i, grid: table.grid, cells: table.cells.map(buildCell), ...(layout.hue ? { hue: layout.hue } : {}), createdAt: now, modifiedAt: now })
      firstId ??= id
      layoutIds.push(id)
    }
    // Every list belongs to a layout (now that it has an id): `layoutIdx`'s,
    // else the first layout whose tabs show it, else the first one.
    const shownBy = (i: number) => seed.tables.findIndex((table) => table.cells.some((p) => p.tabs.some((t) => t.listDefIdx === i)))
    for (const [i, def] of (seed.listDefinitions ?? []).entries()) {
      const listId = defIds[i]
      if (seed.eisenhower?.listDefIdx === i) continue
      const layoutId = layoutIds[def.layoutIdx ?? Math.max(0, shownBy(i))]
      if (listId == null || layoutId == null) continue
      const store = tx.objectStore('listDefinitions')
      store.put({ ...(await get(store, listId)), owner: { layoutId } })
    }
    if (firstId != null) tx.objectStore('settings').put({ key: 'activeLayoutId', value: String(firstId) })
    const eis = seed.eisenhower
    const eisListId = eis?.listDefIdx != null ? defIds[eis.listDefIdx] : undefined
    if (eisListId != null) tx.objectStore('settings').put({ key: 'eisenhowerSource', value: `list:${eisListId}` })
    if (eis?.panes) {
      const panes = Object.fromEntries(Object.entries(eis.panes).map(([q, p]) => [q, {
        ...(p?.name != null ? { name: p.name } : {}),
        ...(p?.filter ? { filter: { ...seed.predicate, ...p.filter } } : {}),
      }]))
      tx.objectStore('settings').put({ key: 'eisenhowerPanes', value: JSON.stringify(panes) })
    }
    for (const [key, value] of Object.entries({ rowDensity: 'rows', ...seed.settings })) {
      if (value === null) tx.objectStore('settings').delete(key)
      else tx.objectStore('settings').put({ key, value })
    }
    if (seed.lenses) {
      const lenses = seed.lenses.map((l) => ({ id: l.id, name: l.name, predicate: { ...seed.predicate, ...(l.predicate ?? {}) } }))
      tx.objectStore('settings').put({ key: 'lenses', value: JSON.stringify(lenses) })
      tx.objectStore('settings').put({ key: 'lensPresetsSeeded', value: 'true' })
    }
    await done
    idb.close()
  }, { db: DB_NAME, seed: payload })
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

/** Tab id of the list widget `seedTaskList` opens. */
export const TASK_LIST_TAB = 'tasks'

type ListDefinitionSeed = NonNullable<WorkspaceSeed['listDefinitions']>[number]

/**
 * Seeds people / tags / statuses / tasks and opens one layout with a single
 * list widget (tab `TASK_LIST_TAB`) over a list named "Tasks" that shows
 * every open task in manual order — a host for task-row specs. `list`
 * overrides the list definition (grouping, predicate, runtime filter, …);
 * `url` is `seedWorkspace`'s. Returns the list widget.
 */
export async function seedTaskList(
  page: Page,
  seed: Omit<WorkspaceSeed, 'layouts' | 'listDefinitions'> & { list?: Partial<ListDefinitionSeed> },
  options: { url?: string } = {},
): Promise<Locator> {
  const { list, ...rest } = seed
  await seedWorkspace(page, {
    ...rest,
    listDefinitions: [{ name: 'Tasks', ...list }],
    layouts: [{ name: 'Main', columns: [{ id: 'col', rows: [wsRow({ id: 'cell', tabs: [{ id: TASK_LIST_TAB, kind: 'lens', listDefIdx: 0 }] })] }] }],
  }, options)
  const widget = wsListWidget(page, TASK_LIST_TAB)
  await widget.waitFor({ state: 'visible' })
  return widget
}

export function wsCell(page: Page, cellId: string): Locator {
  return page.locator(`[data-ws-cell="${cellId}"]`)
}

/**
 * A widget's tab in its cell's strip — or, alone in its cell (no strip, D26
 * AA1), its widget's top line, which stands for the tab (`data-ws-tab`).
 */
export function wsTab(page: Page, tabId: string): Locator {
  return page.locator(`[data-ws-tab="${tabId}"]`)
}

/** A cell's grip (alone in its cell, a widget's top line holds it; `data-ws-panel-handle` as the strip's handle). */
export function wsGrip(page: Page, cellId: string): Locator {
  return wsCell(page, cellId).getByTestId('ws-cell-grip')
}

/** A layout's tab in the top bar, by its exact name. */
export function layoutTab(page: Page, name: string): Locator {
  const exact = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
  return page.getByTestId('layout-tab').filter({ hasText: exact })
}

/** The open layout's tab in the top bar. */
export function openLayoutTab(page: Page): Locator {
  return page.locator('[data-testid="layout-tab"][aria-selected="true"]')
}

/** The layouts' names as the top bar's tabs show them, in order. */
export async function layoutTabNames(page: Page): Promise<string[]> {
  return page.getByTestId('layout-tab').allTextContents()
}

/** Opens a layout tab's menu (right-click; the open layout's when no name is given). */
export async function openLayoutTabMenu(page: Page, name?: string): Promise<Locator> {
  await (name != null ? layoutTab(page, name) : openLayoutTab(page)).click({ button: 'right' })
  const menu = page.getByRole('menu', { name: /^Layout / })
  await menu.waitFor({ state: 'visible' })
  return menu
}

/**
 * `seed` with `n` more (empty) layouts with long names after its own: their
 * tabs take the top bar's room, so a narrow window folds the filters (and
 * the tabs) whatever else the bar shows.
 */
export function withSpareLayouts(seed: WorkspaceSeed, n = 3): WorkspaceSeed {
  const spare = Array.from({ length: n }, (_, i) => ({ name: `A layout with a long name, number ${i + 1}`, columns: [] }))
  return { ...seed, layouts: [...seed.layouts, ...spare] }
}

/** Opens layout `name` from its top-bar tab, or from the picker when the tabs are folded. */
export async function switchLayout(page: Page, name: string): Promise<void> {
  if (await page.getByTestId('layout-picker').isVisible()) {
    await page.getByTestId('layout-picker').click()
    await page.getByRole('menuitemradio', { name, exact: true }).click()
  } else {
    await layoutTab(page, name).click()
  }
}

/**
 * Picks an action for the open layout (Save as new layout…, Edit…,
 * Delete layout…, Discard changes, …): from its tab's menu, or the picker's
 * when the tabs are folded.
 */
export async function openLayoutAction(page: Page, item: string): Promise<void> {
  const menu = await page.getByTestId('layout-picker').isVisible()
    ? (await page.getByTestId('layout-picker').click(), page.getByRole('menu', { name: 'Layouts' }))
    : await openLayoutTabMenu(page)
  await menu.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Expects layout `name` to be the open one (its tab selected, or the picker's name). */
export async function expectOpenLayout(page: Page, name: string): Promise<void> {
  if (await page.getByTestId('layout-picker').isVisible()) {
    await expect(page.getByTestId('layout-picker')).toHaveAccessibleName(`Layout: ${name}`)
  } else {
    await expect(openLayoutTab(page)).toHaveText(name)
  }
}

/**
 * Tab ids per cell per column track, read from the rendered table: each
 * column track's cells — those starting in it — top to bottom.
 */
export async function wsShape(page: Page): Promise<string[][][]> {
  return page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll<HTMLElement>('[data-ws-table] [data-ws-cell]')).map((cell) => {
      const style = getComputedStyle(cell)
      return {
        col: Number.parseInt(style.gridColumnStart, 10) || 1,
        row: Number.parseInt(style.gridRowStart, 10) || 1,
        tabs: Array.from(cell.querySelectorAll<HTMLElement>('[data-ws-tab]')).map((t) => t.dataset.wsTab ?? ''),
      }
    })
    const cols = [...new Set(cells.map((c) => c.col))].sort((a, b) => a - b)
    return cols.map((col) => cells.filter((c) => c.col === col).sort((a, b) => a.row - b.row).map((c) => c.tabs))
  })
}

/**
 * Lets go of a dnd-kit drag and waits until the page takes clicks again.
 * After a drag, dnd-kit stops every click at the document for 50 ms (so the
 * release isn't a click); a test that clicks a drop prompt sooner than any
 * person could would lose that click. Probes with a click on a scratch
 * element (stopped there, so no app listener sees it) until one gets through.
 */
export async function releaseDrag(page: Page): Promise<void> {
  await page.mouse.up()
  await page.waitForFunction(() => {
    const probe = document.createElement('div')
    let reached = false
    probe.addEventListener('click', (e) => { reached = true; e.stopPropagation() })
    document.body.appendChild(probe)
    probe.click()
    probe.remove()
    return reached
  })
}

/**
 * A trusted-mouse drag from `from` to `to` (viewport points): presses at
 * `from`, moves 8 px down in two steps — past dnd-kit's 5 px activation
 * distance — and checks `lifted` (if given), travels to `to` in 12 steps,
 * checks `during` (if given), then lets go (`releaseDrag`).
 */
export async function drag(
  page: Page,
  from: Point,
  to: Point,
  { lifted, during }: { lifted?: () => Promise<void>; during?: () => Promise<void> } = {},
): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x, from.y + 8, { steps: 2 })
  if (lifted) await lifted()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (during) await during()
  await releaseDrag(page)
}

/** A panel's header handle: the empty space between its tabs and its buttons. */
export function wsPanelHandle(page: Page, panelId: string): Locator {
  return page.locator(`[data-ws-panel-handle="${panelId}"]`)
}

/** Picks Split cell ▸ `item` (Right / Below) in the open cell menu. */
export async function pickSplit(page: Page, item: 'Right' | 'Below'): Promise<void> {
  await pickCellMenu(page, 'Split cell', item)
}

/** Picks `parent` ▸ `item` in the open cell menu (Split cell, Merge with, Insert). */
export async function pickCellMenu(page: Page, parent: 'Split cell' | 'Merge with' | 'Insert', item: string): Promise<void> {
  await page.getByRole('menuitem', { name: parent, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/** Opens cell `cellId`'s ⋯ menu (over the cell first: a one-widget cell shows its ⋯ on hover). */
export async function openCellMenu(page: Page, cellId: string): Promise<void> {
  await wsCell(page, cellId).hover()
  await wsCell(page, cellId).getByRole('button', { name: 'Cell options' }).click()
}

/** The drop ghost while a tab or cell is dragged (D26 board T). */
export function wsGhost(page: Page): Locator {
  return page.getByTestId('ws-drop-ghost')
}

/** A box's edges, rounded to the px, for comparing a ghost with the cell that lands there. */
export async function edges(locator: Locator): Promise<{ left: number; top: number; right: number; bottom: number }> {
  const b = await box(locator)
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height }
}

/** Expects two boxes' edges within `tolerance` px of each other. */
export function expectSameEdges(a: { left: number; top: number; right: number; bottom: number }, b: typeof a, tolerance = 2): void {
  for (const k of ['left', 'top', 'right', 'bottom'] as const) {
    expect(Math.abs(a[k] - b[k]), `${k}: ${a[k]} vs ${b[k]}`).toBeLessThanOrEqual(tolerance)
  }
}

/** The divider between cells `a` and `b` (the first cells on either side of its stretch). */
export function wsDivider(page: Page, a: string, b: string): Locator {
  return page.locator(`[data-ws-divider="${a}|${b}"]`)
}

/** The Numbers & charts kinds' names: the add-widget and Change widget menus list them in a submenu. */
const GLANCE_LABELS: ReadonlySet<string> = new Set(widgetKindsOf('glance').map(widgetKindLabel))

/**
 * Picks the kind named `label` in the open add-widget (`Add widget`) or
 * cell (`Change widget`: the ⋯ menu, `Cell options`) menu. Adding: a task
 * kind from the menu itself, a Numbers & charts kind from its submenu, and
 * a Breakdown one of its presets (`preset`, default Custom: D26 P8), whose
 * editor then opens. Changing: every kind from the Change widget › submenu.
 */
export async function pickWidgetKind(page: Page, menuName: 'Add widget' | 'Change widget', label: string, preset = 'Custom'): Promise<void> {
  if (menuName === 'Change widget') {
    await openChangeWidget(page)
    await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitemradio', { name: label, exact: true }).click()
    return
  }
  const role = 'menuitem'
  let menu = page.getByRole('menu', { name: 'Add widget' })
  if (GLANCE_LABELS.has(label)) {
    await menu.getByRole('menuitem', { name: /^Numbers & charts/ }).click()
    menu = page.getByRole('menu', { name: 'Numbers & charts' })
  }
  await menu.getByRole(role, { name: label, exact: true }).click()
  if (menuName === 'Add widget' && label === 'Breakdown') {
    await page.getByRole('menu', { name: 'Breakdown' }).getByRole('menuitem', { name: preset, exact: true }).click()
  }
}

/** Opens the open ⋯ menu's (`Cell options`) Change widget › submenu; returns it. */
export async function openChangeWidget(page: Page): Promise<Locator> {
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: /^Change widget/ }).click()
  return page.getByRole('menu', { name: 'Change widget' })
}

/**
 * Drags a whole panel by its header's empty space (grabbed at its centre)
 * to `to`, checking `lifted` / `during` (if given) before releasing.
 */
export async function dragPanel(
  page: Page,
  panelId: string,
  to: Point,
  checks: { lifted?: () => Promise<void>; during?: () => Promise<void> } = {},
): Promise<void> {
  await drag(page, await pointIn(wsPanelHandle(page, panelId)), to, checks)
}

/**
 * Drags a tab (grabbed at its centre) to (x, y), checking `during` (if
 * given) before releasing. A widget alone in its cell has no tab (its top
 * line stands for it): its cell's grip drags it.
 */
export async function dragTab(page: Page, tab: Locator, to: Point, during?: () => Promise<void>): Promise<void> {
  const grip = (await tab.getAttribute('data-widget-top-line')) != null
    ? tab.locator('xpath=ancestor::*[@data-ws-cell][1]').getByTestId('ws-cell-grip')
    : null
  await drag(page, await pointIn(grip ?? tab), to, { during })
}

export function wsListWidget(page: Page, tabId: string): Locator {
  return page.locator(`[data-list-widget="${tabId}"]`)
}

/**
 * An unsaved edit to the list named `listName` made outside Edit list (as the
 * filter line's chips make them): its shared draft, with Edit list closed.
 */
export async function editListDraft(page: Page, listName: string, changes: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ name, patch }) => {
    const defs = (await import(/* @vite-ignore */ '/src/stores/list-definition-store.ts' as string)) as {
      useListDefinitionStore: { getState: () => { listDefinitions: Array<{ id: number; name: string }> } }
    }
    const drafts = (await import(/* @vite-ignore */ '/src/stores/list-draft-store.ts' as string)) as {
      useListDraftStore: { getState: () => { edit: (id: number, fn: (d: Record<string, unknown>) => Record<string, unknown>) => void } }
    }
    const def = defs.useListDefinitionStore.getState().listDefinitions.find((d) => d.name === name)
    if (!def) throw new Error(`no list “${name}”`)
    drafts.useListDraftStore.getState().edit(def.id, (d) => ({ ...d, ...patch }))
  }, { name: listName, patch: changes })
}

/** The stored list definitions. */
export async function readListDefinitions(page: Page): Promise<Array<Record<string, unknown>>> {
  return readStore(page, 'listDefinitions')
}

/** The stored manual list order (`listOrders` rows). */
export async function readListOrders(page: Page): Promise<Array<{ listDefinitionId: number; todoId: number; rank: number }>> {
  return readStore(page, 'listOrders')
}

/**
 * Drags a list widget row by its left edge (the grip) to viewport y `toY`,
 * checking `during` (if given) before releasing.
 */
export async function dragRow(page: Page, row: Locator, toY: number, during?: () => Promise<void>): Promise<void> {
  const b = await box(row)
  await drag(page, { x: b.x + 10, y: b.y + b.height / 2 }, { x: b.x + 10, y: toY }, { during })
}

/**
 * Follows the `#/settings` deep link and waits for what it does on desktop:
 * the Settings modal opens (from an effect, after the route renders) and the
 * URL goes back to `#/`. From a loaded page this is a same-document hash
 * change, so `goto` returns before the modal is there — callers must not
 * look for it (or click the gear) until this resolves.
 */
export async function gotoSettingsDeepLink(page: Page): Promise<Locator> {
  await page.goto('/#/settings')
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(dialog).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)
  return dialog
}

/** The headed parts of the merged Settings sections, by label: their section. */
const SETTINGS_PART_SECTION: Readonly<Record<string, string>> = {
  'Task defaults': 'Tasks',
  Eisenhower: 'Tasks',
  'Completed tasks': 'Tasks',
  'File storage': 'Database',
  Backups: 'Database',
  'Import / Export': 'Database',
  'Data integrity': 'Database',
}

/**
 * The Settings modal, opened with the top bar's gear unless it is already
 * open (e.g. after `gotoSettingsDeepLink`); optionally switched to a section
 * by its label — or to a merged section's part (`Backups` → Database,
 * scrolled to its heading).
 */
export async function openSettings(page: Page, section?: string): Promise<Locator> {
  const dialog = page.getByRole('dialog', { name: 'Settings', exact: true })
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(dialog).toBeVisible()
  if (section) {
    const nav = SETTINGS_PART_SECTION[section] ?? section
    await dialog.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: nav, exact: true }).click()
    await expect(dialog.getByRole('heading', { level: 2, name: nav })).toBeVisible()
    if (nav !== section) await dialog.getByRole('heading', { level: 3, name: section, exact: true }).scrollIntoViewIfNeeded()
  }
  return dialog
}

/** The + Filter button's name: `Filter`, or in an editor with a row already, `Another filter (AND)`. */
export const ADD_FILTER = /^(Filter|Another filter \(AND\))$/
