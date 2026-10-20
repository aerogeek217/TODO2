import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { readSyncFile as readFile, stubFilePermission } from './fixtures/sync-file'

/**
 * First load of the current build over a production install of the v49
 * build: a v49 IndexedDB plus an attached v49 sync file holding the same data,
 * and no sync record in localStorage (the v49 build kept none).
 *
 * The browser side is built in raw IndexedDB with the v49 build's exact store
 * layout, before the app ever opens the database; the file side is the same
 * data in the shape the v49 build wrote (`{ __schemaVersion: 49, …tables,
 * savedAt }`). The file handle is a real OPFS `FileSystemFileHandle`, stored
 * where the app keeps its handle, so everything after that is the production
 * code path: Dexie's upgrade at open, then the sync-file load decision. As
 * after a browser restart, the handle first needs permission again: the
 * launch question comes before anything else (`stubFilePermission`).
 *
 * The data is the frozen v49 fixture (orgs, projects, a taskboard, a canvas,
 * floating widgets), with names, a title and notes past the old import limits,
 * and the app background colour overridden in both themes (stored under its
 * old `canvasBg` name).
 */

const SYNC_FILE = 'e2e-production-sync.json'
const DB_NAME = 'todo2'
const SAVED_AT = '2026-10-01T10:00:00.000Z'
const SEED_PAGE = '/__v49-install.html'

/** The v49 build's Dexie stores (frozen: the v49 schema never changes). */
const V49_STORES: Record<string, string> = {
  todos: '++id, projectId, canvasId, isCompleted, dueDate, sortOrder, statusId',
  projects: '++id, canvasId, sortOrder',
  canvases: '++id, sortOrder',
  people: '++id, name',
  settings: 'key',
  tags: '++id, name',
  todoTags: '++id, todoId, tagId',
  todoPeople: '++id, todoId, personId',
  todoOrgs: '++id, todoId, orgId',
  personOrgs: '++id, personId, orgId',
  listInsets: '++id, canvasId',
  orgs: '++id, name',
  backups: '++id, createdAt, trigger',
  statuses: '++id, sortOrder',
  listDefinitions: '++id, sortOrder',
  notes: '++id, modifiedAt, canvasId',
  floatingCalendars: '++id, canvasId',
  floatingNotes: '++id, canvasId',
  taskboards: '++id',
  floatingTaskboards: '++id, canvasId',
  floatingHorizons: '++id, canvasId',
  todoEvents: '++id, todoId, type, timestamp',
  floatingStatus: '++id, canvasId',
  floatingScoreboard: '++id, canvasId',
  floatingSnoozeGraveyard: '++id, canvasId',
}

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

const long = (prefix: string, length: number) => `${prefix} `.padEnd(length, 'x')
const LONG = {
  person: long('Long person', 260),
  tag: long('Long tag', 300),
  status: long('Long status', 240),
  org: long('Long org', 250),
  project: long('Long project', 250),
  list: long('Long list', 220),
  title: long('Long title', 1200),
  notes: long('Long notes', 60_000),
  note: long('Workspace note', 120_000),
}

/** The app background overrides, as the v49 build stored them. */
const APP_BACKGROUND = { dark: '#203040', light: '#fdf6e3' }

/** The frozen v49 fixture's tables, with the long values (a deep copy). */
function productionTables(): Tables {
  const path = fileURLToPath(new URL('../src/test/fixtures/v49-export.json', import.meta.url))
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  const tables: Tables = {}
  for (const [key, value] of Object.entries(raw)) if (Array.isArray(value)) tables[key] = value as Row[]
  const first = (name: string): Row => {
    const row = tables[name]?.[0]
    if (!row) throw new Error(`fixture has no ${name}`)
    return row
  }
  first('people').name = LONG.person
  first('tags').name = LONG.tag
  first('statuses').name = LONG.status
  first('orgs').name = LONG.org
  first('projects').name = LONG.project
  first('listDefinitions').name = LONG.list
  first('todos').title = LONG.title
  first('todos').notes = LONG.notes
  first('notes').content = LONG.note
  tables.settings!.push(
    { key: 'color.dark.canvasBg', value: APP_BACKGROUND.dark },
    { key: 'color.light.canvasBg', value: APP_BACKGROUND.light },
  )
  return tables
}

/**
 * Installs the v49 state in this origin: the v49 database with `tables`, the
 * sync file holding `fileText`, and its handle where the app looks for it.
 */
async function installV49(page: Page, tables: Tables, fileText: string) {
  await page.route(`**${SEED_PAGE}`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>v49 install</title>' }))
  await page.goto(SEED_PAGE)
  await page.evaluate(async ({ dbName, stores, tables, syncFile, fileText }) => {
    const done = (req: IDBRequest | IDBTransaction) => new Promise<void>((resolve, reject) => {
      if (req instanceof IDBTransaction) { req.oncomplete = () => resolve(); req.onerror = () => reject(req.error) } else { req.onsuccess = () => resolve(); req.onerror = () => reject(req.error) }
    })
    // Dexie stores version N as IndexedDB version N * 10.
    const open = indexedDB.open(dbName, 490)
    open.onupgradeneeded = () => {
      for (const [name, spec] of Object.entries(stores)) {
        const [primary = '', ...indexes] = spec.split(', ')
        const store = open.result.createObjectStore(name, primary.startsWith('++')
          ? { keyPath: primary.slice(2), autoIncrement: true }
          : { keyPath: primary })
        for (const index of indexes) store.createIndex(index, index)
      }
    }
    await done(open)
    const idb = open.result
    const tx = idb.transaction(Object.keys(tables), 'readwrite')
    for (const [name, rows] of Object.entries(tables)) for (const row of rows) tx.objectStore(name).add(row)
    await done(tx)
    idb.close()

    const dir = await navigator.storage.getDirectory()
    const handle = await dir.getFileHandle(syncFile, { create: true })
    const writable = await handle.createWritable()
    await writable.write(fileText)
    await writable.close()

    const meta = indexedDB.open('todo2-meta', 1)
    meta.onupgradeneeded = () => { meta.result.createObjectStore('handles') }
    await done(meta)
    const metaTx = meta.result.transaction('handles', 'readwrite')
    metaTx.objectStore('handles').put(handle, 'todo2-primary')
    await done(metaTx)
    meta.result.close()
  }, { dbName: DB_NAME, stores: V49_STORES, tables, syncFile: SYNC_FILE, fileText })
}

async function readSyncFile(page: Page): Promise<string> {
  return readFile(page, SYNC_FILE)
}

/** Raw-IDB snapshot of every store, JSON round-tripped (Dates → ISO strings). */
async function dumpDb(page: Page): Promise<{ version: number; stores: Tables }> {
  return page.evaluate(async (dbName) => new Promise<{ version: number; stores: Tables }>((resolve, reject) => {
    const req = indexedDB.open(dbName)
    req.onsuccess = () => {
      const idb = req.result
      const names = Array.from(idb.objectStoreNames)
      const tx = idb.transaction(names, 'readonly')
      const stores: Tables = {}
      for (const n of names) {
        const r = tx.objectStore(n).getAll()
        r.onsuccess = () => { stores[n] = r.result as Row[] }
      }
      tx.oncomplete = () => {
        const version = idb.version
        idb.close()
        resolve({ version, stores: JSON.parse(JSON.stringify(stores)) as Tables })
      }
      tx.onerror = () => reject(tx.error)
    }
    req.onerror = () => reject(req.error)
  }), DB_NAME)
}

/** JSON with object keys sorted recursively, so key order never matters. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Row
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))
    }
    return v
  })
}

/** Every data store's rows, canonical and sorted (row order never matters). */
function tableRows(tables: Tables, names: string[]): Record<string, string[]> {
  return Object.fromEntries(names.map((n) => [n, (tables[n] ?? []).map(canonical).sort()]))
}

test('the first load over a v49 install upgrades the browser, asks before upgrading the in-sync file, then both sides match and sync resumes', async ({ page }) => {
  test.slow() // a 60k-character note and a 120k-character workspace note go through the upgrade
  const tables = productionTables()
  const fileText = JSON.stringify({ __schemaVersion: 49, ...tables, savedAt: SAVED_AT }, null, 2)
  await stubFilePermission(page)
  await installV49(page, tables, fileText)

  await page.goto('/')
  // The launch question first: nothing touched yet on either side — the
  // browser database was upgraded at open (it must be), no purge prompt, no
  // backup, the file still the v49 text.
  const question = page.getByRole('dialog', { name: `Allow access to ${SYNC_FILE}` })
  await expect(question).toBeVisible()
  await expect(page.getByRole('dialog', { name: /old completed task/ })).toHaveCount(0)
  const atQuestion = await dumpDb(page)
  expect(atQuestion.stores.backups ?? []).toHaveLength(0)
  expect(await readSyncFile(page)).toBe(fileText)
  await question.getByRole('button', { name: 'Grant access…' }).click()
  await expect(question).toBeHidden()
  // In-sync sides get the upgrade prompt — not "Browser data and sync file differ".
  const upgrade = page.getByRole('dialog', { name: 'Upgrade sync file?' })
  await expect(upgrade).toBeVisible()
  const { CURRENT_DB_VERSION, ALL_DATA_TABLES } = await page.evaluate(async (url) => {
    const mod = (await import(/* @vite-ignore */ url)) as { CURRENT_DB_VERSION: number; ALL_DATA_TABLES: Array<{ name: string }> }
    return { CURRENT_DB_VERSION: mod.CURRENT_DB_VERSION, ALL_DATA_TABLES: mod.ALL_DATA_TABLES.map((t) => ({ name: t.name })) }
  }, '/src/data/database.ts')
  await expect(upgrade).toContainText(`${SYNC_FILE} was saved by an older version of TODO2 (schema v49)`)
  await expect(upgrade).toContainText(`save it back in the v${CURRENT_DB_VERSION} format`)
  await expect(upgrade).toContainText('A copy of the file as it is now is saved first')
  await expect(page.getByRole('dialog', { name: 'Browser data and sync file differ' })).toHaveCount(0)

  // The browser database was upgraded at open; the file is untouched so far.
  const dataTables = ALL_DATA_TABLES.map((t) => t.name)
  const upgradedAtOpen = await dumpDb(page)
  // Nothing changed while the launch question waited, nor with its answer.
  expect(tableRows(upgradedAtOpen.stores, dataTables)).toEqual(tableRows(atQuestion.stores, dataTables))
  expect(upgradedAtOpen.version).toBe(CURRENT_DB_VERSION * 10)
  expect(await readSyncFile(page)).toBe(fileText)

  // Cancel: both sides untouched, sync paused, no file backup.
  await upgrade.getByRole('button', { name: 'Cancel (pause sync)' }).click()
  const pill = page.getByTestId('storage-pill')
  expect(await readSyncFile(page)).toBe(fileText)
  const afterCancel = await dumpDb(page)
  expect(tableRows(afterCancel.stores, dataTables)).toEqual(tableRows(upgradedAtOpen.stores, dataTables))
  expect((afterCancel.stores.backups ?? []).filter((b) => b.data === fileText)).toHaveLength(0)
  // Startup goes on while sync is paused: the fixture's retention setting
  // brings up the launch purge prompt. Not now = this launch only.
  const purge = page.getByRole('dialog', { name: /old completed task/ })
  await purge.getByRole('button', { name: 'Not now' }).click()
  await expect(purge).toBeHidden()

  // The storage pill says so (no strip). Retry → the same prompt → upgrade.
  await expect(pill).toHaveAttribute('data-state', 'paused')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await pill.click()
  const paused = page.getByRole('dialog', { name: 'Sync paused' })
  await expect(paused).toContainText('was saved by an older version of TODO2')
  await paused.getByRole('button', { name: 'Retry' }).click()
  await expect(upgrade).toBeVisible()
  await upgrade.getByRole('button', { name: 'Upgrade file' }).click()
  await expect(upgrade).toBeHidden()
  await expect(pill).toHaveAttribute('data-state', 'syncing')
  await expect.poll(async () => (JSON.parse(await readSyncFile(page)) as Row).__schemaVersion).toBe(CURRENT_DB_VERSION)

  // The raw v49 text was backed up.
  const upgraded = await dumpDb(page)
  expect((upgraded.stores.backups ?? []).filter((b) => b.data === fileText)).toHaveLength(1)

  // Both sides hold identical rows, field by field (raw IndexedDB vs file JSON) …
  const file = JSON.parse(await readSyncFile(page)) as Tables
  const browserRows = tableRows(upgraded.stores, dataTables)
  expect(tableRows(file, dataTables)).toEqual(browserRows)
  // … the browser data is what it was after the upgrade at open …
  expect(browserRows).toEqual(tableRows(upgradedAtOpen.stores, dataTables))
  // … and it is the v49 data, upgraded: every task and event kept, long values intact.
  expect(upgraded.stores.todos).toHaveLength(tables.todos!.length)
  expect(upgraded.stores.todoEvents).toHaveLength(tables.todoEvents!.length)
  expect(upgraded.stores.people).toHaveLength(tables.people!.length + tables.orgs!.length)
  const people = (upgraded.stores.people ?? []).map((p) => p.name)
  const tags = (upgraded.stores.tags ?? []).map((t) => t.name)
  expect(people).toEqual(expect.arrayContaining([LONG.person, `Org: ${LONG.org}`]))
  expect(tags).toEqual(expect.arrayContaining([LONG.tag, `Project: ${LONG.project}`]))
  expect((upgraded.stores.statuses ?? []).map((s) => s.name)).toContain(LONG.status)
  expect((upgraded.stores.listDefinitions ?? []).map((l) => l.name)).toContain(LONG.list)
  expect(upgraded.stores.todos!.find((t) => t.title === LONG.title)?.notes).toBe(LONG.notes)
  expect(upgraded.stores.notes!.map((n) => n.content)).toContain(LONG.note)
  for (const t of upgraded.stores.todos!) expect(typeof t.uid, `todo ${String(t.id)} uid`).toBe('string')
  // The layouts are numbered: the Default layout, then "Lists from upgrade" for the lists the Default layout doesn't show.
  expect(upgraded.stores.layouts!.map((l) => [l.name, l.sortOrder])).toEqual([['Default', 0], ['Lists from upgrade', 1]])
  // The Eisenhower (on all tasks) has a list of its own, which its setting names.
  const eisenhowerLists = (upgraded.stores.listDefinitions ?? []).filter((l) => JSON.stringify(l.owner) === '{"eisenhower":true}')
  expect(eisenhowerLists.map((l) => l.name)).toEqual(['Eisenhower'])
  expect((upgraded.stores.settings ?? []).find((r) => r.key === 'eisenhowerSource')?.value).toBe(`list:${String(eisenhowerLists[0]?.id)}`)
  // Every other list belongs to a layout: the Default layout's to it, the rest to "Lists from upgrade", which shows them.
  const layoutIds = new Map(upgraded.stores.layouts!.map((l) => [l.name, l.id]))
  const ownerOf = (l: Row) => (l.owner as { layoutId?: unknown } | undefined)?.layoutId
  const others = (upgraded.stores.listDefinitions ?? []).filter((l) => !eisenhowerLists.includes(l))
  for (const l of others) expect([...layoutIds.values()], `${String(l.name)} owner`).toContain(ownerOf(l))
  const fromUpgrade = others.filter((l) => ownerOf(l) === layoutIds.get('Lists from upgrade')).map((l) => l.name)
  expect(fromUpgrade).toEqual([LONG.list, 'Acme next 30 days'])
  const upgradeTabs = JSON.stringify(upgraded.stores.layouts!.find((l) => l.name === 'Lists from upgrade')?.columns)
  for (const l of others.filter((o) => fromUpgrade.includes(o.name as string))) expect(upgradeTabs).toContain(`"listDefinitionId":${String(l.id)}`)
  expect((upgraded.stores.settings ?? []).some((r) => r.key === 'checkinTaskScope')).toBe(false)
  // The app background overrides kept their colours under the new name.
  const colours = Object.fromEntries((upgraded.stores.settings ?? []).filter((r) => String(r.key).startsWith('color.')).map((r) => [r.key, r.value]))
  expect(colours).toEqual({
    'color.dark.accent': '#4f8cff', 'color.light.accent': '#1a5fd0',
    'color.dark.appBg': APP_BACKGROUND.dark, 'color.light.appBg': APP_BACKGROUND.light,
  })
  // The lists' date filters are one clause per date type; no list or tag cap is left.
  const lists = upgraded.stores.listDefinitions ?? []
  for (const l of lists) {
    const predicate = (l.membership as { predicate: Record<string, unknown> }).predicate
    expect(typeof predicate.dates, `${String(l.name)} dates`).toBe('object')
    expect('dateField' in predicate || 'hasDeadline' in predicate, `${String(l.name)} old date keys`).toBe(false)
    expect('maxTasks' in l || 'limitMode' in l, `${String(l.name)} caps`).toBe(false)
  }
  expect(lists.find((l) => l.name === 'Someday')?.membership).toMatchObject({ predicate: { dates: { deadline: { match: 'unset' } } } })
  expect((upgraded.stores.settings ?? []).some((r) => r.key === 'maxTags')).toBe(false)

  // Sync resumes: a real edit reaches the file.
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Added after the upgrade')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (JSON.parse(await readSyncFile(page)) as Tables).todos!.map((t) => t.title))
    .toContain('Added after the upgrade')
  await expect.poll(async () => JSON.parse(await page.evaluate(() => localStorage.getItem('todo2-file-sync-state')) ?? '{}') as Row)
    .toMatchObject({ dirtySince: null })

  // A reload loads the file silently: once startup reaches the launch purge
  // prompt (after the sync-file load), no sync prompt showed.
  await page.reload()
  await expect(purge).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(1)
  await purge.getByRole('button', { name: 'Not now' }).click()
  await expect(page.getByTestId('storage-pill')).toHaveText('Synced')
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('title', `Syncing to ${SYNC_FILE}`)
  await expect(page.getByTestId('storage-pill')).toHaveAttribute('data-state', 'syncing')
  // The dark override paints the app (the fixture's theme is dark).
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(32, 48, 64)')
  const final = await dumpDb(page)
  expect(tableRows(JSON.parse(await readSyncFile(page)) as Tables, dataTables)).toEqual(tableRows(final.stores, dataTables))
})
