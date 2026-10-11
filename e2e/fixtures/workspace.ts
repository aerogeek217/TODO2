import type { Locator, Page } from '@playwright/test'

const DB_NAME = 'todo2'

export interface WsTabSeed {
  id: string
  kind: 'lens' | 'calendar' | 'notes' | 'taskboard' | 'status'
  /** Lens tabs: index into `listDefinitions`. */
  listDefIdx?: number
}

export interface WsCellSeed {
  id: string
  weight?: number
  tabs: WsTabSeed[]
  activeTabId?: string
  collapsed?: boolean
}

export interface WsColumnSeed {
  id: string
  weight?: number
  cells: WsCellSeed[]
}

export interface WsLayoutSeed {
  name: string
  columns: WsColumnSeed[]
}

export interface WorkspaceSeed {
  /** The first layout is opened. */
  layouts: WsLayoutSeed[]
  people?: string[]
  tags?: string[]
  listDefinitions?: Array<{ name: string; grouping?: string; sort?: string }>
  tasks?: Array<{ title: string; people?: string[]; tags?: string[] }>
}

/** Mirrors `emptyPredicate()` in the list-definition store. */
export function emptyPredicate(): Record<string, unknown> {
  return {
    showCompleted: false,
    personIds: null,
    projectIds: null,
    statusIds: null,
    searchText: '',
    dateField: 'deadline',
    dateRangeStart: null,
    dateRangeEnd: null,
    dateRangeIncludeNoDate: false,
    hasDeadline: null,
    hasFollowup: null,
    tags: null,
  }
}

/**
 * Seeds layouts (replacing the app's own), list definitions, people, tags and
 * tasks straight into IndexedDB, then reloads on the workspace. The app must
 * have booted once (Dexie upgraded) — this opens `/#/workspace` first.
 */
export async function seedWorkspace(page: Page, seed: WorkspaceSeed): Promise<void> {
  await page.goto('/#/workspace')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  const payload = { ...seed, predicate: emptyPredicate() }
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
    const tx = idb.transaction(['layouts', 'settings', 'listDefinitions', 'people', 'tags', 'todos', 'todoPeople', 'todoTags'], 'readwrite')
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error ?? new Error('seed aborted'))
    })
    const now = new Date()
    const personIds = new Map<string, number>()
    for (const name of seed.people ?? []) {
      personIds.set(name, await add(tx.objectStore('people'), { name, initials: name.slice(0, 2).toUpperCase() }))
    }
    const tagIds = new Map<string, number>()
    for (const name of seed.tags ?? []) {
      tagIds.set(name, await add(tx.objectStore('tags'), { name, color: '#7ec4bc' }))
    }
    const defIds: number[] = []
    let defOrder = 0
    for (const def of seed.listDefinitions ?? []) {
      defIds.push(await add(tx.objectStore('listDefinitions'), {
        name: def.name,
        sortOrder: ++defOrder,
        membership: { kind: 'custom', predicate: seed.predicate },
        sort: def.sort ?? 'manual',
        grouping: def.grouping ?? 'none',
        pinnedToDashboard: false,
      }))
    }
    let taskOrder = 0
    for (const task of seed.tasks ?? []) {
      const todoId = await add(tx.objectStore('todos'), {
        uid: crypto.randomUUID(),
        title: task.title,
        isCompleted: false,
        createdAt: now,
        modifiedAt: now,
        sortOrder: ++taskOrder,
      })
      for (const p of task.people ?? []) await add(tx.objectStore('todoPeople'), { todoId, personId: personIds.get(p) })
      for (const t of task.tags ?? []) await add(tx.objectStore('todoTags'), { todoId, tagId: tagIds.get(t) })
    }
    tx.objectStore('layouts').clear()
    let firstId: number | null = null
    for (const layout of seed.layouts) {
      const columns = layout.columns.map((col) => ({
        id: col.id,
        weight: col.weight ?? 1,
        cells: col.cells.map((cell) => ({
          id: cell.id,
          weight: cell.weight ?? 1,
          activeTabId: cell.activeTabId ?? cell.tabs[0]?.id,
          ...(cell.collapsed ? { collapsed: true } : {}),
          tabs: cell.tabs.map((tab) => {
            if (tab.kind === 'lens') {
              const listDefinitionId = tab.listDefIdx != null ? defIds[tab.listDefIdx] : undefined
              return { id: tab.id, kind: 'lens', config: listDefinitionId != null ? { listDefinitionId } : {} }
            }
            if (tab.kind === 'calendar') return { id: tab.id, kind: 'calendar', config: { dateTypes: { due: true, followup: true } } }
            return { id: tab.id, kind: tab.kind, config: {} }
          }),
        })),
      }))
      const id = await add(tx.objectStore('layouts'), { name: layout.name, columns, createdAt: now, modifiedAt: now })
      firstId ??= id
    }
    if (firstId != null) tx.objectStore('settings').put({ key: 'activeLayoutId', value: String(firstId) })
    await done
    idb.close()
  }, { db: DB_NAME, seed: payload })
  await page.reload()
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
}

export function wsCell(page: Page, cellId: string): Locator {
  return page.locator(`[data-ws-cell="${cellId}"]`)
}

export function wsTab(page: Page, tabId: string): Locator {
  return page.locator(`[data-ws-tab="${tabId}"]`)
}

/** Tab ids per cell per column, read from the rendered workspace. */
export async function wsShape(page: Page): Promise<string[][][]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-ws-column]')).map((col) =>
      Array.from(col.querySelectorAll('[data-ws-cell]')).map((cell) =>
        Array.from(cell.querySelectorAll<HTMLElement>('[data-ws-tab]')).map((t) => t.dataset.wsTab ?? ''),
      ),
    ),
  )
}

/**
 * Drags a tab with trusted mouse events to (x, y), checking `during` (if
 * given) before releasing. Crosses dnd-kit's 5px activation distance first.
 */
export async function dragTab(
  page: Page,
  tab: Locator,
  to: { x: number; y: number },
  during?: () => Promise<void>,
): Promise<void> {
  const box = await tab.boundingBox()
  if (!box) throw new Error('dragTab: tab has no bounding box')
  const x0 = box.x + box.width / 2
  const y0 = box.y + box.height / 2
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x0 + 8, y0 + 8, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  if (during) await during()
  await page.mouse.up()
}
