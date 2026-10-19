import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync, statSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { openSettings } from './fixtures/workspace'

/**
 * Both built targets start and run under their own Content-Security-Policy:
 * the online build (`dist/index.html`, served over http, scripts from
 * ./assets only — no 'unsafe-inline') and the offline single file
 * (`dist/todo2.html`, opened from disk, one inline script). The dev server
 * can't show this: its page needs inline scripts and the online CSP is set
 * at build time.
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
  const vite = resolve(ROOT, 'node_modules/vite/bin/vite.js')
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

/** Collects CSP violations (DOM events and console reports) for `page`. */
async function watchCsp(page: Page): Promise<() => Promise<string[]>> {
  const consoleReports: string[] = []
  page.on('console', (msg) => {
    if (/Content Security Policy/i.test(msg.text())) consoleReports.push(msg.text())
  })
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __csp: string[] }).__csp = seen
    document.addEventListener('securitypolicyviolation', (e) => {
      seen.push(`${e.violatedDirective} blocked ${e.blockedURI || '(inline)'}`)
    })
  })
  return async () => [
    ...consoleReports,
    ...await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp),
  ]
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
  expect(await violations()).toEqual([])
})

test('the offline single file runs from disk under its CSP', async ({ page }) => {
  const file = join(outDir, 'offline', 'todo2.html')
  const csp = cspOf(readFileSync(file, 'utf8'))
  expect(csp).toContain("script-src 'self' 'unsafe-inline'")
  expect(csp).toContain("font-src 'self' data:")
  expect(csp).toContain("base-uri 'none'")
  expect(csp).toContain("form-action 'none'")

  const violations = await watchCsp(page)
  await page.goto(pathToFileURL(file).href)
  await exercise(page)
  expect(await violations()).toEqual([])
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
  expect(await violations()).toEqual([])
})
