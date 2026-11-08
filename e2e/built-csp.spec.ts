import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { checkOfflineFile } from '../scripts/offline-file'
import { taskRowByTitle } from './fixtures/seed'
import { stubFilePermission } from './fixtures/sync-file'
import { openSettings, seedTaskList, seedWorkspace, wsCell, wsRow } from './fixtures/workspace'

/**
 * Both built targets start and run under their own Content-Security-Policy:
 * the online build (`dist/index.html`, served over http, scripts from
 * ./assets only — no 'unsafe-inline') and the offline single file
 * (`dist/todo2.html`, opened from disk, deny by default, its one inline
 * script by hash). The dev server can't show this: its page needs inline
 * scripts and both policies are set at build time.
 *
 * The offline file is also audited for egress: through its main flows —
 * tasks, Settings, a lens, the check-in preview, export and import, the
 * glance widgets and the Neglect map, and the sync file end to end — it requests nothing but itself and data: / blob: /
 * about: URLs, and causes no CSP violation.
 *
 * The builds go to a temp folder (no lint / type-check — the build command
 * gates those), so `dist/` is never touched.
 */

test.describe.configure({ mode: 'serial' })

const ROOT = resolve(import.meta.dirname, '..')
let outDir = ''
let server: Server | null = null
let onlineUrl = ''

const MIME: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

test.beforeAll(async () => {
  test.setTimeout(180_000)
  outDir = mkdtempSync(join(tmpdir(), 'todo2-csp-'))
  // Found through the package (its `exports` hide the bin), so a worktree whose packages live in the parent checkout builds too.
  const vite = join(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js')
  execFileSync(process.execPath, [vite, 'build', '--outDir', join(outDir, 'online'), '--emptyOutDir', '--logLevel', 'error'], { cwd: ROOT, stdio: 'pipe' })
  execFileSync(process.execPath, [vite, 'build', '--config', 'vite.config.offline.ts', '--outDir', join(outDir, 'offline'), '--logLevel', 'error'], { cwd: ROOT, stdio: 'pipe' })

  const online = join(outDir, 'online')
  server = createServer((req, res) => {
    const path = normalize(join(online, decodeURIComponent((req.url ?? '/').split(/[?#]/)[0] ?? '/')))
    const file = path.startsWith(online) && existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path
    if (!file.startsWith(online) || !existsSync(file)) { res.writeHead(404).end(); return }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file))
  })
  await new Promise<void>((done) => server!.listen(0, '127.0.0.1', done))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no server address')
  onlineUrl = `http://127.0.0.1:${address.port}/`
})

test.afterAll(async () => {
  await new Promise<void>((done) => (server ? server.close(() => done()) : done()))
  if (outDir) rmSync(outDir, { recursive: true, force: true })
})

/**
 * Collects CSP violations for `page` across reloads: the DOM events, and
 * the console reports (which a sandboxed frame's violations reach too).
 */
async function watchCsp(page: Page): Promise<() => string[]> {
  const seen: string[] = []
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) seen.push(msg.text())
  })
  await page.exposeFunction('__e2eCspViolation', (report: string) => { seen.push(report) })
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      void (window as unknown as { __e2eCspViolation: (r: string) => Promise<void> })
        .__e2eCspViolation(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`)
    })
  })
  return () => [...seen]
}

/** The schemes the offline file may request: itself (a local file:), and what it makes in memory. */
const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'about:'] as const

/**
 * Records every request `context` makes (every page, popup and frame,
 * WebSockets included). Returns the requests that leave the machine: any
 * URL outside `LOCAL_SCHEMES`, and a file: URL with a host (a UNC share —
 * an SMB request); and every URL seen, so a spec can tell the watch ran.
 */
function watchRequests(context: BrowserContext): { remote: () => string[]; all: () => string[] } {
  const urls: string[] = []
  context.on('request', (req) => { urls.push(req.url()) })
  const onPage = (page: Page) => { page.on('websocket', (ws) => { urls.push(ws.url()) }) }
  context.pages().forEach(onPage)
  context.on('page', onPage)
  const isLocal = (url: string) => LOCAL_SCHEMES.some((s) => url.startsWith(s)) && !(url.startsWith('file:') && new URL(url).host !== '')
  return { remote: () => urls.filter((u) => !isLocal(u)), all: () => [...urls] }
}

/**
 * Starts the app, adds a task through Quick Add and opens Settings — whose
 * backdrop blurs the page in the built CSS too (the minifier once kept only
 * a `-webkit-` prefixed blur, which Chromium ignores).
 */
async function exercise(page: Page) {
  await expect(page.locator('[data-ws-area]')).toBeVisible()
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Built under the CSP')
  await page.keyboard.press('Enter')
  await expect(quickAdd).toBeHidden()
  await openSettings(page, 'Backups')
  await expect.poll(() => page.locator('[data-modal-backdrop]').evaluate((el) => getComputedStyle(el).backdropFilter)).toMatch(/^blur\(\d+px\)$/)
}

function cspOf(html: string): string {
  return /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(html)?.[1] ?? ''
}

test('the online build runs with a CSP that allows no inline script', async ({ page }) => {
  const csp = cspOf(readFileSync(join(outDir, 'online', 'index.html'), 'utf8'))
  expect(csp).toContain("script-src 'self';")
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  expect(csp).toContain("base-uri 'none'")
  expect(csp).toContain("form-action 'none'")

  // No network in tests: the Google Fonts stylesheet is answered locally.
  await page.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ contentType: 'text/css', body: '' }))
  const violations = await watchCsp(page)
  await page.goto(onlineUrl)
  await exercise(page)
  expect(violations()).toEqual([])
})

test('the offline single file runs from disk under its CSP', async ({ page }) => {
  const file = join(outDir, 'offline', 'todo2.html')
  const html = readFileSync(file, 'utf8')
  const csp = cspOf(html)
  expect(csp).toMatch(/^default-src 'none'; /)
  // On file:// 'self' would admit any file: URL, a UNC share's among them.
  expect(csp).not.toContain("'self'")
  // Its one inline script by hash: the page starting below is the proof the hash matches.
  expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/]{43}=';/)
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/)
  expect(csp).toContain("connect-src 'none'")
  expect(csp).toContain('font-src data:;')
  expect(csp).toContain("base-uri 'none'")
  expect(csp).toContain("form-action 'none'")
  expect(html).toContain('<meta name="referrer" content="no-referrer" />')

  const violations = await watchCsp(page)
  await page.goto(pathToFileURL(file).href)
  await exercise(page)
  expect(violations()).toEqual([])
})

test('the offline single file carries its own icons: data: URLs that load from a folder holding only the file', async ({ page }) => {
  const alone = join(outDir, 'alone')
  mkdirSync(alone)
  const file = join(alone, 'todo2.html')
  copyFileSync(join(outDir, 'offline', 'todo2.html'), file)
  const html = readFileSync(file, 'utf8')
  expect(html).not.toContain('rel="manifest"')

  const violations = await watchCsp(page)
  await page.goto(pathToFileURL(file).href)
  await expect(page.locator('[data-ws-area]')).toBeVisible()
  const icons = await page.evaluate(async () => Promise.all(
    [...document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')].map(async (link) => {
      const img = new Image()
      img.src = link.href
      const loaded = await img.decode().then(() => true, () => false)
      return { type: link.type, sizes: link.getAttribute('sizes'), data: link.href.startsWith('data:'), loaded, width: img.naturalWidth }
    }),
  ))
  expect(icons).toEqual([
    { type: 'image/svg+xml', sizes: null, data: true, loaded: true, width: expect.any(Number) },
    { type: 'image/x-icon', sizes: '16x16 32x32 48x48 64x64', data: true, loaded: true, width: expect.any(Number) },
    { type: 'image/png', sizes: '192x192', data: true, loaded: true, width: 192 },
  ])
  expect(violations()).toEqual([])
})

test('the written offline file passes the egress check the build ran on it', () => {
  expect(checkOfflineFile(readFileSync(join(outDir, 'offline', 'todo2.html'), 'utf8'))).toEqual([])
})

/**
 * Renames a list row's task in place: select its title, click it again to
 * edit (after the click / double-click window), type, Enter.
 */
async function renameRow(page: Page, from: string, to: string) {
  const row = taskRowByTitle(page, from)
  const id = await row.locator('[data-todo-id]').first().getAttribute('data-todo-id')
  const title = row.locator(`span[data-task-title="${from}"]`)
  await title.click()
  await expect(row).toHaveAttribute('data-selected', 'true')
  await title.click()
  const input = page.locator(`[data-todo-id="${id}"] input[maxlength="500"]`)
  await expect(input).toBeFocused()
  await input.fill(to)
  await input.press('Enter')
  await expect(taskRowByTitle(page, to)).toBeVisible()
}

async function quickAdd(page: Page, title: string) {
  await page.keyboard.press('Control+Space')
  const dialog = page.getByRole('dialog', { name: 'Quick add task' })
  await dialog.getByPlaceholder('New task…').fill(title)
  await page.keyboard.press('Enter')
  await expect(dialog).toBeHidden()
  await expect(taskRowByTitle(page, title)).toBeVisible()
}

test('the offline file requests nothing but itself through its main flows', async ({ page, context }) => {
  test.setTimeout(120_000)
  const requests = watchRequests(context)
  const violations = await watchCsp(page)
  // No File System Access pickers here (the sync file has its own test
  // below): the export falls back to a download, the import to the file input.
  await page.addInitScript(() => {
    for (const name of ['showOpenFilePicker', 'showSaveFilePicker']) {
      delete (Window.prototype as unknown as Record<string, unknown>)[name]
      delete (window as unknown as Record<string, unknown>)[name]
    }
  })
  const fileUrl = pathToFileURL(join(outDir, 'offline', 'todo2.html')).href
  await seedTaskList(page, {
    people: [{ name: 'Ada Lovelace', email: 'ada@example.com' }],
    tasks: [
      { title: 'Draft the plan', people: ['Ada Lovelace'], dueInDays: 2, notes: 'First line\n- a bullet' },
      { title: 'Book the room' },
      { title: 'Send the agenda' },
    ],
    lenses: [{ id: 'lens-plan', name: 'Planning', predicate: { searchText: 'plan' } }],
  }, { url: fileUrl })

  // Tasks: add, rename, open the editor (CodeMirror notes), complete.
  await quickAdd(page, 'Added offline')
  await renameRow(page, 'Book the room', 'Book the big room')
  await taskRowByTitle(page, 'Draft the plan').locator('span[data-task-title="Draft the plan"]').dblclick()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor).toBeVisible()
  await expect(editor.getByText('a bullet').first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()
  await taskRowByTitle(page, 'Send the agenda').getByRole('checkbox', { name: 'Mark complete' }).click()
  await expect(taskRowByTitle(page, 'Send the agenda')).toHaveCount(0)

  // A lens pick, and back.
  const lensName = page.locator('header').getByRole('button', { name: /^Lens:/ })
  for (const [pick, name] of [['Planning', 'Planning'], ['No lens', 'none']] as const) {
    await lensName.click()
    await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${pick}`) }).click()
    await expect(lensName).toHaveAccessibleName(`Lens: ${name}`)
  }

  // Every Settings section.
  const settings = await openSettings(page)
  for (const section of ['Database', 'Appearance', 'Tasks', 'People, statuses & tags', 'Keyboard shortcuts', 'About']) {
    await settings.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: section, exact: true }).click()
    await expect(settings.getByRole('heading', { level: 2, name: section })).toBeVisible()
  }
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()

  // The check-in dialog's preview: the email in its sandboxed srcdoc frame.
  await page.keyboard.press('Control+k')
  await page.getByPlaceholder(/Search tasks, commands/).fill('>check-in')
  await page.getByRole('option', { name: /Email task check-ins/ }).click()
  const checkin = page.getByRole('dialog', { name: 'Email task check-ins' })
  await checkin.locator('[data-checkin-row]').filter({ hasText: 'Ada Lovelace' }).getByRole('checkbox').check()
  await checkin.getByRole('button', { name: 'Preview email' }).click()
  const preview = page.getByRole('dialog', { name: 'Preview email' })
  await expect(preview.frameLocator('iframe[title="Check-in email for Ada Lovelace"]').getByText('Draft the plan')).toBeVisible()
  await preview.getByRole('button', { name: 'Close' }).click()
  await page.keyboard.press('Escape')
  await expect(checkin).toBeHidden()

  // Export JSON: a download (of a blob: URL).
  const io = await openSettings(page, 'Import / Export')
  const [download] = await Promise.all([page.waitForEvent('download'), io.getByRole('button', { name: 'Export JSON' }).click()])
  expect(download.url()).toMatch(/^blob:/)
  const exported = join(outDir, 'exported.json')
  await download.saveAs(exported)
  const titles = (JSON.parse(readFileSync(exported, 'utf8')) as { todos: Array<{ title: string }> }).todos.map((t) => t.title)
  expect(titles.sort()).toEqual(['Added offline', 'Book the big room', 'Draft the plan', 'Send the agenda'])

  // Import JSON, through the file input: the export replaces a newer task.
  await page.keyboard.press('Escape')
  await quickAdd(page, 'Added after the export')
  await openSettings(page, 'Import / Export')
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), io.getByRole('button', { name: 'Import JSON' }).click()])
  await chooser.setFiles(exported)
  await expect(io.getByText(/^Imported successfully/)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(taskRowByTitle(page, 'Added after the export')).toHaveCount(0)
  await expect(taskRowByTitle(page, 'Added offline')).toBeVisible()

  expect(requests.all()).toContain(fileUrl)
  expect(requests.remote()).toEqual([])
  expect(violations()).toEqual([])
})

/**
 * The glance widgets and the Neglect map from the built file (cr33 security
 * I2): a Number's small face, its full widget in the face popover (the
 * 14-day sparkline) and its tasks in the task dialog; Tags, Status and a
 * Project pulse card opening its tag's tasks; the Neglect map's dots,
 * one opening the editor. Nothing is requested but the file itself.
 */
test('the offline file requests nothing through the glance widgets and the Neglect map', async ({ page, context }) => {
  test.setTimeout(120_000)
  const requests = watchRequests(context)
  const violations = await watchCsp(page)
  const fileUrl = pathToFileURL(join(outDir, 'offline', 'todo2.html')).href
  await page.setViewportSize({ width: 1440, height: 900 })
  await seedWorkspace(page, {
    tags: [{ name: 'Project: Atlas', color: '#4f8cff' }],
    tasks: [
      { title: 'Ship the beta', focus: true, dueInDays: 2, tags: ['Project: Atlas'] },
      { title: 'Renew the domain', dueInDays: -1, modifiedInDays: -20, tags: ['Project: Atlas'] },
      { title: 'Pay the invoice', dueInDays: 0, tags: ['Project: Atlas'] },
      { title: 'Archive old tickets', modifiedInDays: -50 },
      { title: 'Closed already', dueInDays: -3, completedInDays: -1 },
    ],
    layouts: [{
      name: 'Glance',
      columns: [
        { id: 'c1', rows: [
          wsRow({ id: 'kn', tabs: [{ id: 'num', kind: 'number', glance: { metric: 'open' } }] }),
          wsRow({ id: 'km', tabs: [{ id: 'map', kind: 'neglect', neglect: { colourBy: { tags: ['Project: Atlas'] } } }] }),
        ] },
        { id: 'c2', rows: [
          { cells: [
            { id: 'kc', tabs: [{ id: 'tags', kind: 'tags' }] },
            { id: 'kt', tabs: [{ id: 'status', kind: 'status' }] },
          ] },
          wsRow({ id: 'kp', tabs: [{ id: 'pulse', kind: 'pulse', tagNames: ['Project: Atlas'] }] }),
        ] },
      ],
    }],
  }, { url: fileUrl })
  const taskDialog = page.locator('[data-task-dialog]')

  // A Number: its small face, its full widget in the popover, its tasks.
  const numberCell = wsCell(page, 'kn')
  await expect(numberCell.locator('[data-number="num"]').getByTestId('number-count')).toHaveText('4')
  await numberCell.getByRole('button', { name: 'Open Open' }).focus()
  await page.keyboard.press('Enter')
  const full = page.getByTestId('widget-face-popover')
  await expect(full.locator('[data-sparkline]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(full).toHaveCount(0)
  await numberCell.locator('[data-number="num"]').click()
  await expect(taskDialog.getByRole('heading')).toHaveText('Open')
  await page.keyboard.press('Escape')
  await expect(taskDialog).toBeHidden()

  // Tags, Status, Project pulse.
  await expect(page.locator('[data-glance="tags"] [data-tag-row]').first()).toContainText('#Project: Atlas')
  await expect(page.locator('[data-glance="status"] [data-glance-section="status"]')).toContainText('4 open')
  const card = page.locator('[data-glance="pulse"] [data-pulse-card]').first()
  await expect(card).toContainText('Project: Atlas')
  await card.click()
  await expect(taskDialog.getByRole('heading')).toHaveText('#Project: Atlas')
  await page.keyboard.press('Escape')
  await expect(taskDialog).toBeHidden()

  // The Neglect map: its dots, one opening the editor.
  const map = wsCell(page, 'km').locator('[data-neglect-map]')
  await expect(map.locator('[data-neglect-dot]')).toHaveCount(4)
  await map.locator('[data-neglect-dot]').and(page.getByRole('button', { name: /^Renew the domain: / })).click()
  const editor = page.getByRole('dialog', { name: 'Edit task' })
  await expect(editor.getByRole('textbox', { name: 'Task title' })).toHaveValue('Renew the domain')
  await page.keyboard.press('Escape')
  await expect(editor).toBeHidden()

  expect(requests.all()).toContain(fileUrl)
  expect(requests.remote()).toEqual([])
  expect(violations()).toEqual([])
})

/**
 * The sync file, end to end, from the built file under its CSP: create a new
 * file, edit, the write lands in the file; reload — the browser asks again
 * for access, as after a restart — grant it, and the next edit lands too.
 *
 * The native file pickers can't be driven, so the save picker hands the app
 * an origin-private (OPFS) file — a real `FileSystemFileHandle`, so
 * everything after the picker is the production path. Chromium serves OPFS
 * to a file:// page only with `--allow-file-access-from-files`, so this test
 * runs its own browser with that switch (it lets file: pages read other
 * files; the CSP's directives apply as without it).
 */
test('the sync file works from the offline file under its CSP: create, write, reload, reconnect', async ({ playwright }) => {
  test.setTimeout(120_000)
  const SYNC_FILE = 'todo2-offline-sync.json'
  const browser = await playwright.chromium.launch({ args: ['--allow-file-access-from-files'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const requests = watchRequests(context)
    const page = await context.newPage()
    const violations = await watchCsp(page)
    await page.addInitScript((name) => {
      const pick = async () => (await navigator.storage.getDirectory()).getFileHandle(name, { create: true })
      Object.defineProperty(window, 'showSaveFilePicker', { value: pick, configurable: true })
      Object.defineProperty(window, 'showOpenFilePicker', { value: async () => [await pick()], configurable: true })
    }, SYNC_FILE)
    await stubFilePermission(page)
    const syncedTitles = () => page.evaluate(async (name) => {
      try {
        const dir = await navigator.storage.getDirectory()
        const text = await (await (await dir.getFileHandle(name)).getFile()).text()
        return (JSON.parse(text) as { todos: Array<{ title: string }> }).todos.map((t) => t.title).sort()
      } catch {
        return null // not written yet, or read mid-save
      }
    }, SYNC_FILE)

    const fileUrl = pathToFileURL(join(outDir, 'offline', 'todo2.html')).href
    await seedTaskList(page, { tasks: [{ title: 'Before the sync file' }] }, { url: fileUrl })

    // Create a new sync file: the browser's data is written into it.
    const settings = await openSettings(page, 'File storage')
    await settings.getByRole('button', { name: 'Create New File' }).click()
    const pill = page.getByTestId('storage-pill')
    await expect(pill).toHaveText('Synced')
    await expect(pill).toHaveAttribute('title', `Syncing to ${SYNC_FILE}`)
    await expect.poll(syncedTitles).toEqual(['Before the sync file'])

    // Edits land in the file.
    await page.keyboard.press('Escape')
    await quickAdd(page, 'Synced from the offline file')
    await renameRow(page, 'Before the sync file', 'Renamed in the sync file')
    await expect.poll(syncedTitles).toEqual(['Renamed in the sync file', 'Synced from the offline file'])

    // Reload: access is asked for again; granted, the file loads and syncs on.
    await page.reload()
    const question = page.getByRole('dialog', { name: `Allow access to ${SYNC_FILE}` })
    await question.getByRole('button', { name: 'Grant access…' }).click()
    await expect(question).toBeHidden()
    await expect(pill).toHaveText('Synced')
    await expect(taskRowByTitle(page, 'Renamed in the sync file')).toBeVisible()
    await quickAdd(page, 'After reconnecting')
    await expect.poll(syncedTitles).toEqual(['After reconnecting', 'Renamed in the sync file', 'Synced from the offline file'])

    expect(requests.all()).toContain(fileUrl)
    expect(requests.remote()).toEqual([])
    expect(violations()).toEqual([])
  } finally {
    await browser.close()
  }
})
