import { expect, type Locator, type Page } from '@playwright/test'
import { createTab, WIDGET_KINDS, widgetKindLabel, widgetKindsOf, type LayoutTab, type WidgetKind } from '../../src/models/workspace-layout'
import { isV77Metric, numberConfigOfMetric } from '../../src/test/helpers/number-metrics'
import { layoutTableOf } from './column-layout'
import { DB_NAME, readStore } from './db'
import { box, pointIn, type Point } from './geometry'

export interface WsTabSeed {
  id: string
  kind: WidgetKind
  /** List tabs: index into `listDefinitions`. */
  listDefIdx?: number
  /** The tab's picked icon as stored (items 11, 14), e.g. `{ kind: 'line', key: 'flag' }`. */
  icon?: Record<string, unknown>
  /** Calendar tabs: date types shown (default all three). */
  dateTypes?: { due: boolean; followup: boolean; plan: boolean }
  /** Calendar tabs: view state. */
  view?: 'month' | 'week'
  offset?: number
  /** Calendar tabs: the month shows titled bars (view state; default off = the heat map). */
  titles?: boolean
  /** List tabs: the task rows' details width (view state). */
  detailsWidth?: number
  /** List tabs: the zoom (view state; absent = the Settings default). */
  zoom?: 'stacked' | 'rows' | 'lines'
  /**
   * Glance tabs (Number, the sections): config fields over the kind's defaults. A Number's
   * `metric` (e.g. `{ metric: 'open' }`) seeds that metric's ready-made config
   * (`numberConfigOfMetric`), its other fields over that.
   */
  glance?: Record<string, unknown>
  /** List board tabs (kind `shortcuts`): config fields over the kind's defaults, e.g. `{ source: 'layout' }`. */
  board?: Record<string, unknown>
  /** Neglect map tabs: the config (defaults: colour by no tags, 14 days). */
  neglect?: {
    /** Colour by these tags (names from `tags`), by people, or not at all. */
    colourBy?: { tags: string[] } | 'people' | 'none'
    untouchedDays?: number
  }
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
 * into a table (`column-layout`).
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
  /** The layout's icon as stored (items 11, 14), e.g. `{ kind: 'emoji', emoji: '🏠' }`. */
  icon?: Record<string, unknown>
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
  const columnsForm = {
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
  return layoutTableOf(columnsForm) as unknown as WsTable
}

/** `table` with each Number seeded by a `metric` given that metric's ready-made config. */
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

export interface WorkspaceSeed {
  /** The first layout is opened. */
  layouts: WsLayoutSeed[]
  /**
   * Settings rows to store as they are (`key` → stored `value`), e.g. `{ rowDensity: 'lines' }`;
   * `null` stores none. The Default list zoom is seeded as Rows (`rowDensity: 'rows'`) unless given:
   * Auto (the app's default, no row — `{ rowDensity: null }`) would draw a cell under 480px Stacked.
   */
  settings?: Record<string, string | null>
  /** Names, or a name with initials / colour. */
  people?: Array<string | { name: string; initials?: string; color?: string }>
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
    /** Names of tags (from `tags`) for the predicate's `tags`. */
    tags?: string[]
    /** Names of statuses (from `statuses`) for the predicate's `statusIds`. */
    statuses?: string[]
    runtimeFilter?: { field: 'person' | 'status' | 'tag' }
    /** `false` hides the list's filter line. */
    showFilterLine?: false
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
    /** The planned day (the Planner's `doDate`, schema v85), days from today. */
    doInDays?: number
    /** Held in the Planner's Unplanned tray (`unplanned`, schema v86); ignored beside `doInDays`. */
    unplanned?: boolean
    /** Hour of the due date (default midnight). */
    dueHour?: number
    /** The repeat, by its old name; stored as its interval (schema v84: weekly `{ count: 1, unit: 'w' }`). */
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

/** A module the specs import in the page (`stores`, `services`, `data`), served with Vite's hot-update stamp. */
const HOT_MODULE = /\/src\/(?:stores|services|data)\/[^?]+\?(?:[^#]*&)?t=\d+/

/** The hot-updated modules each watched page has asked for. */
const hotByPage = new WeakMap<Page, string[]>()

/**
 * The hot-updated modules `page` asks for from now on (watched once per
 * page). After a source edit under a running dev server Vite serves the
 * changed module and its importers as `…?t=<stamp>`: the app runs on those
 * copies while a spec's bare `import('/src/stores/…')` gets a second one, so
 * the spec's store calls never reach the page (`no todo alpha`, a mass of
 * false failures). A freshly started server serves none.
 */
export function hotModules(page: Page): string[] {
  const known = hotByPage.get(page)
  if (known) return known
  const hot: string[] = []
  hotByPage.set(page, hot)
  page.on('request', (request) => {
    if (HOT_MODULE.test(request.url())) hot.push(request.url())
  })
  return hot
}

/** What a test fails with when its page ran on hot-updated modules (`hotModules`): what happened, and what to do. */
export function staleServerError(hotModule: string): Error {
  return new Error(
    `The dev server has hot-updated modules (${hotModule}): restart it, then run again. `
    + 'The app now runs on those copies, while a spec’s import(\'/src/stores/…\') loads a second, empty copy — its store calls would never reach the page.',
  )
}

/**
 * Seeds layouts and list definitions (replacing the app's own), people, tags and
 * tasks straight into IndexedDB, then reloads on the workspace. The app must
 * have booted once (Dexie upgraded) — this opens the workspace (`/#/`, or
 * `url`: a built file's) first.
 */
export async function seedWorkspace(page: Page, seed: WorkspaceSeed, { url = '/#/' }: { url?: string } = {}): Promise<void> {
  const hot = hotModules(page)
  await page.goto(url)
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  const stale = hot[0]
  if (stale !== undefined) throw staleServerError(stale)
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
    // The seed's lists replace any the database holds.
    tx.objectStore('listDefinitions').clear()
    const defIds: number[] = []
    let defOrder = 0
    for (const def of seed.listDefinitions ?? []) {
      const predicate: Record<string, unknown> = { ...seed.predicate, ...(def.predicate ?? {}) }
      if (def.people) predicate.personIds = def.people.map((n) => personIds.get(n))
      if (def.tags) predicate.tags = def.tags.map((n) => tagIds.get(n))
      if (def.statuses) predicate.statusIds = def.statuses.map((n) => statusIds.get(n))
      defIds.push(await add(tx.objectStore('listDefinitions'), {
        name: def.name,
        sortOrder: ++defOrder,
        membership: { kind: 'custom', predicate },
        sort: def.sort ?? 'manual',
        ...(def.sortDirection ? { sortDirection: def.sortDirection } : {}),
        grouping: def.grouping ?? 'none',
        ...(def.runtimeFilter ? { runtimeFilter: def.runtimeFilter } : {}),
        ...(def.showFilterLine === false ? { showFilterLine: false } : {}),
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
        ...(task.recurrence ? {
          recurrenceRule: {
            every: {
              daily: { count: 1, unit: 'd' }, weekly: { count: 1, unit: 'w' }, biweekly: { count: 2, unit: 'w' },
              monthly: { count: 1, unit: 'm' }, quarterly: { count: 3, unit: 'm' }, yearly: { count: 1, unit: 'y' },
            }[task.recurrence],
          },
        } : {}),
        ...(task.followupInDays != null ? { nextFollowupAt: day(task.followupInDays) } : {}),
        ...(task.doInDays != null ? { doDate: day(task.doInDays) } : task.unplanned ? { unplanned: true } : {}),
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
      if (tab.kind === 'neglect' && tab.neglect) {
        const n = tab.neglect
        if (n.colourBy === 'people' || n.colourBy === 'none') config.colourBy = { kind: n.colourBy }
        else if (n.colourBy) config.colourBy = { kind: 'tags', tagIds: n.colourBy.tags.map((name) => tagIds.get(name)).filter((id) => id != null) }
        if (n.untouchedDays != null) config.untouchedDays = n.untouchedDays
      }
      if (tab.glance) Object.assign(config, tab.glance)
      if (tab.kind === 'shortcuts' && tab.board) Object.assign(config, tab.board)
      if (tab.detailsWidth != null) out.viewState = { ...(out.viewState as object | undefined), detailsWidth: tab.detailsWidth }
      if (tab.zoom != null) out.viewState = { ...(out.viewState as object | undefined), zoom: tab.zoom }
      if (tab.icon) out.icon = tab.icon
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
      const id = await add(tx.objectStore('layouts'), { name: layout.name, sortOrder: i, grid: table.grid, cells: table.cells.map(buildCell), ...(layout.hue ? { hue: layout.hue } : {}), ...(layout.icon ? { icon: layout.icon } : {}), createdAt: now, modifiedAt: now })
      firstId ??= id
      layoutIds.push(id)
    }
    // Every list belongs to a layout (now that it has an id): `layoutIdx`'s,
    // else the first layout whose tabs show it, else the first one.
    const shownBy = (i: number) => seed.tables.findIndex((table) => table.cells.some((p) => p.tabs.some((t) => t.listDefIdx === i)))
    for (const [i, def] of (seed.listDefinitions ?? []).entries()) {
      const listId = defIds[i]
      const layoutId = layoutIds[def.layoutIdx ?? Math.max(0, shownBy(i))]
      if (listId == null || layoutId == null) continue
      const store = tx.objectStore('listDefinitions')
      store.put({ ...(await get(store, listId)), owner: { layoutId } })
    }
    if (firstId != null) tx.objectStore('settings').put({ key: 'activeLayoutId', value: String(firstId) })
    for (const [key, value] of Object.entries({ rowDensity: 'rows', ...seed.settings })) {
      if (value === null) tx.objectStore('settings').delete(key)
      else tx.objectStore('settings').put({ key, value })
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

/**
 * A card's surface in the layout edit mode (E3, `data-edit-surface`): under
 * the card's dimmed content, so a press anywhere on the card (its middle —
 * `pointIn`) drags the whole card, a click selects it, and it takes the
 * keys. Drawn only in the mode.
 */
export function wsCard(page: Page, cellId: string): Locator {
  return page.locator(`[data-edit-surface="${cellId}"]`)
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
 * Every layout edit is saved at once: waits until the open layout's writes
 * have landed (`data-layout-writing` off the layout controls) and none has
 * failed (no `Couldn't save · Retry`). What a spec awaits where it once
 * clicked the save button, or checked it read "Layout saved".
 */
export async function expectLayoutStored(page: Page): Promise<void> {
  await expect(page.locator('[data-layout-controls][data-layout-writing]')).toHaveCount(0)
  await expect(page.getByTestId('layout-write-failed')).toHaveCount(0)
}

/**
 * A structural layout edit was made: saved at once as an undo step — the
 * snackbar names it (`name`, when given) and offers Undo — then stored.
 */
export async function expectLayoutStep(page: Page, name?: string | RegExp): Promise<void> {
  const snackbar = page.locator('[data-snackbar-live]')
  if (name !== undefined) await expect(snackbar).toContainText(name)
  await expect(snackbar.getByRole('button', { name: 'Undo', exact: true })).toBeVisible()
  await expectLayoutStored(page)
}

/**
 * A divider's Alt-drag moved part of a line: a structural edit saved at once — the
 * newest undo step (`Moved divider`), with no snackbar (the table shows the
 * move), then stored. A drag that did nothing leaves no such step.
 */
export async function expectDividerStep(page: Page): Promise<void> {
  await expectLayoutStored(page)
  await expect.poll(() => newestUndoStep(page)).toBe('Moved divider')
  await expect(page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
}

/** The name of the newest step on the undo stack (what Ctrl+Z would undo), `null` with none. */
export async function newestUndoStep(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/undo-store.ts' as string)) as {
      useUndoStore: { getState: () => { undoStack: Array<{ description: string }> } }
    }
    return mod.useUndoStore.getState().undoStack.at(-1)?.description ?? null
  })
}

/**
 * Records what the undo snackbar says from now on (its live region's text
 * at every change): the returned reader gives every text so far — empty
 * while no snackbar has shown, however briefly.
 */
export async function watchSnackbar(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const region = document.querySelector('[data-snackbar-live]')
    if (!region) throw new Error('no snackbar region')
    const said: string[] = []
    const note = () => {
      const text = region.textContent?.trim() ?? ''
      if (text !== '' && said.at(-1) !== text) said.push(text)
    }
    note()
    new MutationObserver(note).observe(region, { childList: true, subtree: true, characterData: true })
    ;(window as unknown as { __snackbarSaid: string[] }).__snackbarSaid = said
  })
  return () => page.evaluate(() => (window as unknown as { __snackbarSaid: string[] }).__snackbarSaid.slice())
}

/**
 * Picks an action for the open layout (Duplicate layout…, Name, icon and hue…,
 * Delete layout…): from its tab's menu, or the picker's when the tabs are
 * folded.
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
  await clicksGetThrough(page)
}

/**
 * Resolves once a click reaches its target again: dnd-kit's stop on every
 * click at the document, 50 ms long after a drag ends or is cancelled, is
 * over (`releaseDrag` has the reason and the probe's how). Also while the
 * mouse is still down — after a drag cancelled with Esc, before letting go.
 */
export async function clicksGetThrough(page: Page): Promise<void> {
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

/**
 * A multi-tab card's header room: the empty space between its tabs and its
 * end, which in the layout edit mode passes a press to the card's surface
 * (so a drag from there moves the card; a click selects it). It takes no
 * pointer events itself: press it by its point (`pointIn`), not `.click()`.
 */
export function wsPanelHandle(page: Page, panelId: string): Locator {
  return page.locator(`[data-ws-cell-header="${panelId}"] [data-strip-room]`)
}

/** Picks Insert ▸ New cell `item` (a side: Split this cell) in the open card menu (`openCellLayoutMenu`). */
export async function pickSplit(page: Page, item: 'Above' | 'Left' | 'Right' | 'Below'): Promise<void> {
  await pickCellMenu(page, 'Insert', `New cell ${item.toLowerCase()}`)
}

/** Picks `parent` ▸ `item` in the open card menu (Insert, Merge with, Move to, Swap with). */
export async function pickCellMenu(page: Page, parent: 'Insert' | 'Merge with' | 'Move to' | 'Swap with', item: string): Promise<void> {
  await page.getByRole('menuitem', { name: parent, exact: true }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

/**
 * Opens cell `cellId`'s ⋯ menu, `Cell options` (over the cell first: a
 * one-widget cell shows its ⋯ on hover): outside the layout edit mode the
 * widget's entries, Add widget as tab ›, Remove widget, Collapse row and
 * Edit layout. In the mode a card's ⋯ opens its own menu
 * (`openCellLayoutMenu`).
 */
export async function openCellMenu(page: Page, cellId: string): Promise<void> {
  await wsCell(page, cellId).hover()
  await wsCell(page, cellId).getByRole('button', { name: 'Cell options' }).click()
}

/**
 * Opens card `cellId`'s menu in the layout edit mode, `Cell layout` (E3: the
 * card's ⋯, at its top-right): Move to ▸, Swap with ▸, Split ▸, Merge with
 * ▸, Stretch right / down, Remove widget, Close cell (a selected card's
 * toolbar holds the ⋯ then). Open the mode first (`enterLayoutEdit`); rows
 * and columns are the selection's edge tabs (`insertBeside`) and the
 * headers' menus.
 */
export async function openCellLayoutMenu(page: Page, cellId: string): Promise<Locator> {
  await wsCell(page, cellId).hover()
  await wsCell(page, cellId).getByRole('button', { name: 'Cell layout' }).click()
  return page.getByRole('menu', { name: 'Cell layout' })
}

/** A selected card's or slot's edge tab in the layout edit mode: where its track goes. */
export type EdgeTab = 'Row above' | 'Row below' | 'Column left' | 'Column right'

/**
 * In the layout edit mode, selects card or slot `cellId` (its focus: no
 * move armed) and returns its edge tab `edge` (`+ Row above` …), a full
 * row / column on that edge's line.
 */
export async function edgeTab(page: Page, cellId: string, edge: EdgeTab): Promise<Locator> {
  await page.locator(`[data-edit-focus="${cellId}"]`).focus()
  const tab = page.getByRole('button', { name: `Insert ${edge.toLowerCase()}`, exact: true })
  await expect(tab).toBeVisible()
  return tab
}

/** Clicks card or slot `cellId`'s edge tab `edge` (`edgeTab`): the track inserted, its first new cell selected. */
export async function insertBeside(page: Page, cellId: string, edge: EdgeTab): Promise<void> {
  await (await edgeTab(page, cellId, edge)).click()
}

/** The ⋯'s Add widget as tab › (a lone widget) or Add tab › (a cell showing a tab strip). */
export const ADD_TAB_ENTRY = /^Add (widget as )?tab$/

/**
 * The ⋯'s **Add widget as tab ›** `label` on cell `cellId` (layout edit mode
 * E4): the new widget a tab of that cell, made its active one; a Breakdown
 * from `preset` (default Custom). No editor opens.
 */
export async function addWidgetAsTab(page: Page, cellId: string, label: string, preset = 'Custom'): Promise<void> {
  await openCellMenu(page, cellId)
  // Add widget as tab › on a lone widget, Add tab › in a cell showing a tab strip.
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: ADD_TAB_ENTRY }).click()
  await page.getByRole('menu', { name: ADD_TAB_ENTRY }).getByRole('menuitem', { name: label, exact: true }).click()
  if (label === 'Breakdown') await page.getByRole('menu', { name: 'Breakdown' }).getByRole('menuitem', { name: preset, exact: true }).click()
}

/**
 * A layout-wide edit made in the layout edit mode (the cards, their menus,
 * the headers live only there): opens the mode, runs `edit` on the draft,
 * then Done — stored as one undo step, `Edited layout “X”`.
 */
export async function editLayout(page: Page, edit: () => Promise<void>): Promise<void> {
  await enterLayoutEdit(page)
  await edit()
  await finishLayoutEdit(page)
}

/** The layout edit mode's bar (layout edit mode E1). */
export function layoutEditBar(page: Page): Locator {
  return page.locator('[data-layout-edit-bar]')
}

/**
 * Opens the layout edit mode (E1) from the open layout's tab menu (Edit
 * layout…) — or the picker's, while the layouts are folded into it — and
 * waits for its bar. Everything layout-wide — the cards and their menus,
 * whole-cell and cross-cell drags, the drop ghost, the headers, the tray —
 * is drawn only there, and acts on the draft until `finishLayoutEdit`.
 */
export async function enterLayoutEdit(page: Page): Promise<void> {
  const picker = page.getByTestId('layout-picker')
  if (await picker.isVisible()) {
    await picker.click()
    await page.getByRole('menu', { name: 'Layouts' }).getByRole('menuitem', { name: 'Edit layout…' }).click()
  } else {
    const menu = await openLayoutTabMenu(page)
    await menu.getByRole('menuitem', { name: 'Edit layout…' }).click()
  }
  await expect(layoutEditBar(page)).toBeVisible()
}

/** Done in the layout edit mode: the draft stored as one undo step (`Edited layout “X”`); waits for the bar to go and the write to land. */
export async function finishLayoutEdit(page: Page): Promise<void> {
  await layoutEditBar(page).getByRole('button', { name: 'Done', exact: true }).click()
  await expect(layoutEditBar(page)).toHaveCount(0)
  await expectLayoutStored(page)
}

/**
 * A point in a one-widget card's tab area in the layout edit mode (its top
 * band, where its label sits): a whole card or a tab dropped there joins it
 * as tabs — on its middle a whole card swaps with it instead.
 */
export async function tabAreaPoint(page: Page, cellId: string): Promise<Point> {
  const b = await box(wsCell(page, cellId))
  return { x: b.x + b.width / 2, y: b.y + 14 }
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

/** The Insights kinds' names: the add-widget and Change widget menus list them in a submenu. */
const INSIGHTS_LABELS: ReadonlySet<string> = new Set(widgetKindsOf('insights').map(widgetKindLabel))

/**
 * Picks the kind named `label` in the open add-widget (`Add widget`) or
 * cell (`Change widget`: the ⋯ menu, `Cell options`) menu. Adding: a task
 * kind from the menu itself, an Insights kind from its submenu, and
 * a Breakdown one of its presets (`preset`, default Custom: D26 P8); no
 * editor opens. Changing: every kind from the Change widget › submenu.
 */
export async function pickWidgetKind(page: Page, menuName: 'Add widget' | 'Change widget', label: string, preset = 'Custom'): Promise<void> {
  if (menuName === 'Change widget') {
    await openChangeWidget(page)
    await page.getByRole('menu', { name: 'Change widget' }).getByRole('menuitemradio', { name: label, exact: true }).click()
    return
  }
  const role = 'menuitem'
  let menu = page.getByRole('menu', { name: 'Add widget' })
  if (INSIGHTS_LABELS.has(label)) {
    await menu.getByRole('menuitem', { name: /^Insights/ }).click()
    menu = page.getByRole('menu', { name: 'Insights' })
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
 * Drags a whole card in the layout edit mode (E3) to `to` — grabbed at its
 * header's room when it has a tab strip, else at its middle (its surface) —,
 * checking `lifted` / `during` (if given) before releasing.
 */
export async function dragPanel(
  page: Page,
  panelId: string,
  to: Point,
  checks: { lifted?: () => Promise<void>; during?: () => Promise<void> } = {},
): Promise<void> {
  const room = wsPanelHandle(page, panelId)
  const from = (await room.count()) > 0 ? await pointIn(room) : await pointIn(wsCard(page, panelId))
  await drag(page, from, to, checks)
}

/**
 * Drags a tab (grabbed at its centre) to (x, y), checking `during` (if
 * given) before releasing. A widget alone in its cell has no tab (its top
 * line stands for it): its card drags it — in the layout edit mode only
 * (E3: grabbed on its surface, at the card's middle); outside it a tab
 * reorders only inside its own strip.
 */
export async function dragTab(page: Page, tab: Locator, to: Point, during?: () => Promise<void>): Promise<void> {
  const grip = (await tab.getAttribute('data-widget-top-line')) != null
    ? tab.locator('xpath=ancestor::*[@data-ws-cell][1]').locator('[data-edit-surface]')
    : null
  await drag(page, await pointIn(grip ?? tab), to, { during })
}

export function wsListWidget(page: Page, tabId: string): Locator {
  return page.locator(`[data-list-widget="${tabId}"]`)
}

/** The filter field of Review widget `tabId` (widget feedback 2A). */
export function reviewField(page: Page, tabId: string): Locator {
  return page.locator(`[data-review-widget="${tabId}"]`).getByRole('textbox', { name: 'Review filter' })
}

/**
 * Picks in Review widget `tabId` by typing: each of `names` typed bare at the
 * field's end and taken with ⏎ (the first match — a second person joins with
 * `or`), as a user would; its filter is temporary, so no seed holds it. The
 * field is left afterwards (its text settled, the list closed).
 */
export async function pickInReview(page: Page, tabId: string, ...names: string[]): Promise<void> {
  const field = reviewField(page, tabId)
  await field.click()
  for (const name of names) {
    await field.press('End')
    await field.pressSequentially(name)
    await expect(page.locator('[data-nlp-popup]').getByRole('option').first()).toBeVisible()
    await field.press('Enter')
  }
  await field.blur()
}

/**
 * An edit to the list named `listName` written for good, as Edit list's
 * Save writes one (`list-definition-store.editList`: one undo step) —
 * without going through the dialog.
 */
export async function editListNow(page: Page, listName: string, changes: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ name, patch }) => {
    const defs = (await import(/* @vite-ignore */ '/src/stores/list-definition-store.ts' as string)) as {
      useListDefinitionStore: { getState: () => {
        listDefinitions: Array<{ id: number; name: string }>
        editList: (id: number, fn: (d: Record<string, unknown>) => Record<string, unknown>, description: string) => Promise<boolean>
      } }
    }
    const store = defs.useListDefinitionStore.getState()
    const def = store.listDefinitions.find((d) => d.name === name)
    if (!def) throw new Error(`no list “${name}”`)
    if (!(await store.editList(def.id, (d) => ({ ...d, ...patch }), `Edited list “${name}”`))) throw new Error(`list “${name}” not edited`)
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
  'New tasks': 'Tasks',
  Rules: 'Tasks',
  'New lists': 'Tasks',
  'Task rows': 'Appearance',
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

/**
 * Opens Edit list from a list's filter line inside `scope` (a list
 * widget): the line reads the filter in words (UX cleanup
 * 2A), and a click on them opens Edit list, where the filter is edited — its
 * chips, + Filter, Another filter (AND). Returns the open Edit list; the
 * edits there are the list's draft, kept when it closes (Esc).
 */
export async function openListFilterEditor(page: Page, scope: Locator): Promise<Locator> {
  await scope.getByTestId('list-filter-row').getByTestId(/^list-filter-(expression|every)$/).click()
  const editor = page.getByTestId('edit-list')
  await expect(editor).toBeVisible()
  return editor
}

/**
 * Finishes an open Edit list: its Save (written for good, one undo step)
 * while it has changes, else its × (nothing to save).
 */
export async function closeListFilterEditor(page: Page): Promise<void> {
  const editor = page.getByTestId('edit-list')
  const save = editor.getByRole('button', { name: 'Save', exact: true })
  if (await save.isEnabled()) await save.click()
  else await editor.getByRole('button', { name: 'Close Edit list' }).click()
  await expect(editor).toHaveCount(0)
}

/** Edit list's Save button (the dialog's own; the list's line has none). */
export function editListSave(page: Page): Locator {
  return page.getByTestId('edit-list').getByRole('button', { name: 'Save', exact: true })
}

/**
 * Opens the check-in dialog for nobody (the first person selected), asking
 * the store: the app opens it only from a Review widget's Check-in, so a
 * spec without one asks the store. Returns the open dialog.
 */
export async function openCheckinDialog(page: Page): Promise<Locator> {
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/ui-store.ts' as string)) as {
      useUIStore: { getState: () => { openCheckinDialog: () => void } }
    }
    mod.useUIStore.getState().openCheckinDialog()
  })
  const dialog = page.getByRole('dialog', { name: 'Task check-ins' })
  await expect(dialog).toBeVisible()
  return dialog
}

/** Opens the check-in reply import, as the Review widget's Paste reply does. Returns the open dialog. */
export async function openCheckinImport(page: Page): Promise<Locator> {
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/ui-store.ts' as string)) as {
      useUIStore: { getState: () => { openCheckinImport: () => void } }
    }
    mod.useUIStore.getState().openCheckinImport()
  })
  const dialog = page.getByRole('dialog', { name: 'Import task update' })
  await expect(dialog).toBeVisible()
  return dialog
}
