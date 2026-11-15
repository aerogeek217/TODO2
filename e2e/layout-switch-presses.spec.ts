import { expect, test, type Page } from '@playwright/test'
import { DB_NAME, readStore } from './fixtures/db'
import { layoutTab, openLayoutTab, seedWorkspace, wsCell, wsRow } from './fixtures/workspace'

/**
 * A press made during a layout switch lands (cr34 H4). A view transition
 * shows the old picture frozen, and sends every press to the root element,
 * from its start until its update has run; then its pictures lie over the
 * page while they animate. So:
 *
 * - the switch's read and writes run before the transition starts, and only
 *   the change on screen runs inside it (`workspace-store.load`'s `show`);
 * - the page itself is left out of the transition (`:root` in `tokens.css`:
 *   only the cells and list groups are pictured) and the pictures' overlay
 *   takes no press, so a click during the animation reaches the new page —
 *   its top bar and everything else that isn't a cell's own content.
 *
 * Real-browser because view transitions, hit-testing and IndexedDB's
 * transaction order are.
 */

const SEED = {
  tasks: Array.from({ length: 12 }, (_, i) => ({ title: `Task ${i + 1}` })),
  listDefinitions: [{ name: 'Everything' }],
  layouts: [
    { name: 'Lists', columns: [{ id: 'c1', rows: [wsRow({ id: 'list', tabs: [{ id: 'all', kind: 'lens' as const, listDefIdx: 0 }] })] }] },
    { name: 'Notes', columns: [{ id: 'c2', rows: [wsRow({ id: 'notes', tabs: [{ id: 'n', kind: 'notes' as const }] })] }] },
  ],
}

async function seed(page: Page) {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await seedWorkspace(page, SEED)
  await expect(wsCell(page, 'list')).toBeVisible()
  expect(await page.evaluate(() => typeof document.startViewTransition)).toBe('function')
}

declare global {
  interface Window {
    __vtStarts?: Array<Promise<string | undefined>>
  }
}

test('a layout switch has written the open layout before its view transition starts', async ({ page }) => {
  await seed(page)
  // At each transition's start, in the same task: a read of the stored open layout. IndexedDB runs
  // transactions in the order they were made, so it sees the switch's write only if that came first.
  await page.evaluate(async (name) => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    window.__vtStarts = []
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = ((...args: Parameters<Document['startViewTransition']>) => {
      window.__vtStarts?.push(new Promise((resolve, reject) => {
        const req = idb.transaction('settings', 'readonly').objectStore('settings').get('activeLayoutId')
        req.onsuccess = () => resolve((req.result as { value?: string } | undefined)?.value)
        req.onerror = () => reject(req.error)
      }))
      return start(...args)
    }) as Document['startViewTransition']
  }, DB_NAME)
  const storedOpen = async () => (await readStore<{ key: string; value: string }>(page, 'settings')).find((row) => row.key === 'activeLayoutId')?.value
  const before = await storedOpen()

  await layoutTab(page, 'Notes').click()
  await expect(wsCell(page, 'notes')).toBeVisible()
  await expect(openLayoutTab(page)).toHaveText('Notes')

  const after = await storedOpen()
  expect(after).toBeDefined()
  expect(after).not.toBe(before)
  const seenAtStart = await page.evaluate(() => Promise.all(window.__vtStarts ?? []))
  // One transition, and the stored open layout was already the new one when it began.
  expect(seenAtStart).toEqual([after])
})

test('a click made while the switch’s pictures animate reaches the page under them', async ({ page }) => {
  await seed(page)
  // A long animation: the test has time to press inside it.
  await page.addStyleTag({ content: `::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 4s !important; }` })
  const gear = page.getByRole('button', { name: 'Settings', exact: true })
  const box = await gear.boundingBox()
  if (!box) throw new Error('no gear')
  const at = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  await layoutTab(page, 'Notes').click()
  // The new layout is rendered and the transition's pictures are animating over it.
  await expect(wsCell(page, 'notes')).toBeAttached()
  await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition') === true))).toBe(true)
  // A press at the gear finds the gear: not the transition's overlay, nor the root a pictured page gave its presses to.
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? document.elementFromPoint(x, y)?.tagName, at)
  expect(hit).toBe('Settings')
  await page.mouse.click(at.x, at.y)
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition') === true)), 'still inside the transition').toBe(true)
})
