import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { layoutTab, openLayoutTab, seedWorkspace, wsCell, wsRow, wsTab } from './fixtures/workspace'

/**
 * A press made during a layout switch lands (cr34 H4, answer 26). A view
 * transition shows the old picture frozen, and sends every press to the
 * root element, from its start until its update has rendered — and a
 * layout's mount is a long frame. Nothing morphs on a layout switch (every
 * cell is new), so it runs no transition: a press made while the new layout
 * mounts waits for that frame and then lands. Tab changes and group
 * collapses keep theirs (cells and groups morph there); the page itself is
 * left out of a transition (`:root` in `tokens.css`: only the cells and list
 * groups are pictured) and the pictures' overlay takes no press, so a click
 * while one animates reaches the page.
 *
 * Real-browser because view transitions, hit-testing, input queueing and
 * IndexedDB's transaction order are.
 */

const SEED = {
  tasks: Array.from({ length: 60 }, (_, i) => ({ title: `Task ${i + 1}`, dueInDays: (i % 9) - 3, urgent: i % 4 === 0 })),
  listDefinitions: [{ name: 'Everything' }, { name: 'Second' }],
  layouts: [
    {
      name: 'Lists',
      columns: [{ id: 'c1', rows: [wsRow({ id: 'list', tabs: [{ id: 'all', kind: 'lens' as const, listDefIdx: 0 }, { id: 'tn', kind: 'notes' as const }] })] }],
    },
    {
      name: 'More',
      columns: [
        { id: 'c2', rows: [wsRow({ id: 'more', tabs: [{ id: 'second', kind: 'lens' as const, listDefIdx: 1 }] })] },
        { id: 'c3', rows: [wsRow({ id: 'notes', tabs: [{ id: 'n', kind: 'notes' as const }] })] },
      ],
    },
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
    __vtStarts?: number
    __downs?: Array<{ at: number; label: string }>
  }
}

/** Counts `document.startViewTransition` calls from now on (`window.__vtStarts`). */
async function countTransitions(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.__vtStarts = 0
    const start = document.startViewTransition.bind(document)
    document.startViewTransition = ((...args: Parameters<Document['startViewTransition']>) => {
      window.__vtStarts = (window.__vtStarts ?? 0) + 1
      return start(...args)
    }) as Document['startViewTransition']
  })
}

test('a layout switch starts no view transition; a tab change still does', async ({ page }) => {
  await seed(page)
  await countTransitions(page)
  const storedOpen = async () => (await readStore<{ key: string; value: string }>(page, 'settings')).find((row) => row.key === 'activeLayoutId')?.value
  const before = await storedOpen()

  await layoutTab(page, 'More').click()
  await expect(wsCell(page, 'notes')).toBeVisible()
  await expect(openLayoutTab(page)).toHaveText('More')
  expect(await page.evaluate(() => window.__vtStarts)).toBe(0)
  // The switch is stored as ever.
  await expect.poll(storedOpen).not.toBe(before)

  await layoutTab(page, 'Lists').click()
  await expect(wsCell(page, 'list')).toBeVisible()
  expect(await page.evaluate(() => window.__vtStarts)).toBe(0)

  // A tab change in a cell keeps its transition (D19).
  await wsTab(page, 'tn').click()
  await expect(wsTab(page, 'tn')).toHaveAttribute('aria-selected', 'true')
  expect(await page.evaluate(() => window.__vtStarts)).toBe(1)
})

/**
 * A click sent straight to the browser's input queue, not waiting for the
 * page to answer each step (Playwright's own click waits for the pointer
 * move's answer, which a busy page delays): the press is made now, and
 * reaches the page when it next takes input — as a person's does.
 */
function rawClick(cdp: CDPSession, x: number, y: number): Promise<unknown> {
  const at = { x, y, button: 'left' as const, clickCount: 1 }
  return Promise.all([
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }),
    cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...at, buttons: 1 }),
    cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at }),
  ])
}

async function centre(locator: ReturnType<Page['locator']>): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox()
  if (!box) throw new Error('not on screen')
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) }
}

for (const delay of [60, 150, 300]) {
  test(`a press ${delay} ms after a layout-tab click lands`, async ({ page }) => {
    await seed(page)
    const cdp = await page.context().newCDPSession(page)
    // A slower CPU: the new layout's mount is a long frame, as at the user's size (about 200 ms there).
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.evaluate(() => {
      window.__downs = []
      window.addEventListener('pointerdown', (e) => {
        const el = e.target instanceof Element ? e.target.closest('button, [role="tab"]') : null
        window.__downs?.push({ at: e.timeStamp, label: el?.getAttribute('aria-label') ?? el?.textContent?.trim() ?? String(e.target) })
      }, true)
    })
    const tab = await centre(layoutTab(page, 'More'))
    const gear = await centre(page.getByRole('button', { name: 'Settings', exact: true }))

    // Neither click waits for the page: the second goes out `delay` ms after the first, however busy the page is.
    const first = rawClick(cdp, tab.x, tab.y)
    await new Promise((done) => setTimeout(done, delay))
    await Promise.all([first, rawClick(cdp, gear.x, gear.y)])

    // A lost press never lands, however long this waits; the long wait is for a 4× slowed CPU on a
    // machine running the whole suite, where the mount alone can take several seconds.
    await expect(wsCell(page, 'notes')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible({ timeout: 30_000 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    const downs = await page.evaluate(() => window.__downs ?? [])
    expect(downs.map((d) => d.label)).toEqual(['More', 'Settings'])
    const gap = Math.round((downs[1]?.at ?? 0) - (downs[0]?.at ?? 0))
    test.info().annotations.push({ type: 'press gap', description: `${gap} ms (asked ${delay} ms)` })
    expect(gap).toBeGreaterThanOrEqual(delay - 10)
  })
}

test('a click made while a tab change’s pictures animate reaches the page under them', async ({ page }) => {
  await seed(page)
  // A long animation: the test has time to press inside it.
  await page.addStyleTag({ content: `::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-duration: 4s !important; }` })
  const gear = await centre(page.getByRole('button', { name: 'Settings', exact: true }))

  await wsTab(page, 'tn').click()
  // The new tab is rendered and the transition's pictures are animating over it.
  await expect(wsTab(page, 'tn')).toHaveAttribute('aria-selected', 'true')
  await expect.poll(() => page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition') === true))).toBe(true)
  // A press at the gear finds the gear: not the transition's overlay, nor the root a pictured page gave its presses to.
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('button')?.getAttribute('aria-label') ?? document.elementFromPoint(x, y)?.tagName, gear)
  expect(hit).toBe('Settings')
  await page.mouse.click(gear.x, gear.y)
  await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.getAnimations().some((a) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition') === true)), 'still inside the transition').toBe(true)
})
