import { expect, test, type Locator, type Page } from '@playwright/test'
import { releaseDrag, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'
import { rowTitles } from './fixtures/seed'
import { box, type Point } from './fixtures/geometry'

/**
 * A dragged task row is lifted (D25 E4): on grab its overlay animates from
 * the row's resting look to a −1.2° tilt at 1.02 scale; on drop it settles —
 * untilting while it moves onto the row's new spot (a reorder) or back to
 * where it came from (a cancel) — and goes. Reduced motion: no tilt, no
 * scale, gone at once. A drop the row follows later (another group, a
 * calendar day, an Eisenhower pane) untilts and fades where it was let go.
 * The list's drop line starts at the rows' title.
 * Real-browser because computed transforms, CSS / Web Animations and pseudo-
 * element geometry are.
 */

const LIFTED = '[data-drag-overlay="task"]'

function seed(list: { name: string; sort?: string }): WorkspaceSeed {
  return {
    listDefinitions: [list],
    tasks: [{ title: 'Alpha' }, { title: 'Bravo' }, { title: 'Charlie' }, { title: 'Delta' }],
    layouts: [{ name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] }],
  }
}

const row = (page: Page, title: string): Locator =>
  wsListWidget(page, 't1').locator('[data-row-key]', { has: page.locator(`span[data-task-title="${title}"]`) })

interface Pose { scale: number; angle: number }

/** The lifted row's scale and rotation (degrees) from its computed transform; null while there is none. */
async function pose(page: Page): Promise<Pose | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform)
    return {
      scale: Math.round(Math.hypot(m.a, m.b) * 1000) / 1000,
      angle: Math.round((Math.atan2(m.b, m.a) * 180) / Math.PI * 100) / 100,
    }
  }, LIFTED)
}

/** Presses on `row`, moves past the activation distance, then to `to`. */
async function lift(page: Page, from: Locator, to: Point): Promise<void> {
  const b = await box(from)
  const x = b.x + 12
  const y = b.y + b.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x, y + 8, { steps: 2 })
  await page.mouse.move(to.x, to.y, { steps: 8 })
}

interface Frame {
  overlay: { x: number; y: number } | null
  overlayOpacity: number | null
  angle: number | null
  rowOpacity: string | null
}

/**
 * Records, once a frame from now until the lifted row is gone, the
 * overlay's box (dnd-kit's wrapper, not the tilted row) and the lifted row's
 * rotation, and the opacity of `title`'s list row.
 */
async function recordFrames(page: Page, title: string): Promise<void> {
  await page.evaluate(([sel, title]) => {
    const w = window as unknown as { __liftFrames: Frame[]; __liftDone: Promise<void> }
    w.__liftFrames = []
    w.__liftDone = new Promise((resolve) => {
      const tick = () => {
        const lifted = document.querySelector<HTMLElement>(sel)
        const wrapper = lifted?.parentElement
        const wrap = wrapper?.getBoundingClientRect()
        const m = lifted ? new DOMMatrixReadOnly(getComputedStyle(lifted).transform) : null
        const listRow = [...document.querySelectorAll<HTMLElement>('[data-row-key]')]
          .find((r) => r.querySelector(`[data-task-title="${title}"]`))
        w.__liftFrames.push({
          overlay: wrap ? { x: wrap.left, y: wrap.top } : null,
          overlayOpacity: wrapper ? Number(getComputedStyle(wrapper).opacity) : null,
          angle: m ? (Math.atan2(m.b, m.a) * 180) / Math.PI : null,
          rowOpacity: listRow ? getComputedStyle(listRow).opacity : null,
        })
        if (lifted) requestAnimationFrame(tick)
        else resolve()
      }
      requestAnimationFrame(tick)
    })
  }, [LIFTED, title] as const)
}

async function recordedFrames(page: Page): Promise<Frame[]> {
  return page.evaluate(async () => {
    const w = window as unknown as { __liftFrames: Frame[]; __liftDone: Promise<void> }
    await w.__liftDone
    return w.__liftFrames
  })
}

/** The settle as recorded: it untilted while it moved (not snapped), and its last box was on `at`. */
function expectSettledOnto(frames: Frame[], at: Point): void {
  const shown = frames.filter((f) => f.overlay)
  const log = JSON.stringify(shown)
  // Part way: tilted less than lifted, not yet flat.
  const settling = shown.filter((f) => f.angle != null && f.angle < -0.01 && f.angle > -1.19)
  expect(settling.length, log).toBeGreaterThan(0)
  const last = shown.at(-1)!
  expect(Math.abs(last.overlay!.x - at.x), log).toBeLessThanOrEqual(1.5)
  expect(Math.abs(last.overlay!.y - at.y), log).toBeLessThanOrEqual(1.5)
  expect(Math.abs(last.angle ?? 1), log).toBeLessThan(0.05)
  // The row stays hidden under the overlay while it settles, and shows again.
  expect(settling.every((f) => f.rowOpacity === '0'), log).toBe(true)
  expect(frames.at(-1)!.rowOpacity).toBe('1')
}

test('grabbing a row lifts it: tilted and scaled once the grab animation has run, from the resting look', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Order' }))
  await expect(row(page, 'Delta')).toBeVisible()
  const alpha = await box(row(page, 'Alpha'))
  await lift(page, row(page, 'Delta'), { x: alpha.x + 200, y: alpha.y + 4 })

  // The lift animates (from no tilt, no scale), on the spring curve.
  const lifted = page.locator(LIFTED)
  const animation = await lifted.evaluate((el) => {
    const cs = getComputedStyle(el)
    return { name: cs.animationName, duration: cs.animationDuration, timing: cs.animationTimingFunction }
  })
  expect(animation.name).toMatch(/lift/)
  expect(animation.duration).toBe('0.16s')
  expect(animation.timing).toBe('cubic-bezier(0.22, 0.61, 0.36, 1)')
  // Done: the lifted pose.
  await expect.poll(() => pose(page)).toEqual({ scale: 1.02, angle: -1.2 })
  // No opacity on the lifted row; no nudge off the row it was picked up from.
  expect(await lifted.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')

  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test('a reorder settles onto the row’s new spot, untilting as it goes', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Order' }))
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  const bravo = await box(row(page, 'Bravo'))
  await lift(page, row(page, 'Delta'), { x: bravo.x + 12, y: bravo.y + 4 })
  await expect(wsListWidget(page, 't1').locator('[data-drop-slot]')).toHaveCount(1)
  await expect.poll(() => pose(page)).toEqual({ scale: 1.02, angle: -1.2 })

  await recordFrames(page, 'Delta')
  await releaseDrag(page)
  const frames = await recordedFrames(page)
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  const landed = await box(row(page, 'Delta'))
  expectSettledOnto(frames, landed)
  await expect(page.locator(LIFTED)).toHaveCount(0)
})

test('a cancelled drag (Esc) settles back where it was picked up', async ({ page }) => {
  await seedWorkspace(page, seed({ name: 'Order' }))
  await expect(row(page, 'Delta')).toBeVisible()
  const origin = await box(row(page, 'Delta'))
  const alpha = await box(row(page, 'Alpha'))
  await lift(page, row(page, 'Delta'), { x: alpha.x + 240, y: alpha.y + 4 })
  await expect.poll(() => pose(page)).toEqual({ scale: 1.02, angle: -1.2 })

  await recordFrames(page, 'Delta')
  await page.keyboard.press('Escape')
  const frames = await recordedFrames(page)
  await page.mouse.up()
  expectSettledOnto(frames, origin)
  await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  expect(await box(row(page, 'Delta'))).toEqual(origin)
})

test('a drop into another group untilts and fades where it was let go', async ({ page }) => {
  await seedWorkspace(page, {
    listDefinitions: [{ name: 'Priority', grouping: 'priority' }],
    tasks: [{ title: 'Alpha', urgent: true }, { title: 'Bravo' }],
    layouts: seed({ name: 'x' }).layouts,
  })
  await expect(row(page, 'Bravo')).toBeVisible()
  const alpha = await box(row(page, 'Alpha'))
  const at = { x: alpha.x + 12, y: alpha.y + 4 }
  await lift(page, row(page, 'Bravo'), at)
  await expect(wsListWidget(page, 't1').locator('[data-drop-line]')).toHaveCount(1)
  await expect.poll(() => pose(page)).toEqual({ scale: 1.02, angle: -1.2 })
  const dropped = await page.locator(LIFTED).evaluate((el) => {
    const r = el.parentElement!.getBoundingClientRect()
    return { x: r.left, y: r.top }
  })

  await recordFrames(page, 'Bravo')
  await releaseDrag(page)
  const frames = (await recordedFrames(page)).filter((f) => f.overlay)
  const log = JSON.stringify(frames)
  // Fading and untilting, without moving.
  expect(frames.some((f) => f.overlayOpacity! > 0.05 && f.overlayOpacity! < 0.95 && f.angle! > -1.19), log).toBe(true)
  expect(frames.every((f) => Math.abs(f.overlay!.x - dropped.x) < 0.5 && Math.abs(f.overlay!.y - dropped.y) < 0.5), log).toBe(true)
  await expect(page.locator(LIFTED)).toHaveCount(0)
  // The row moved to Alpha's (Urgent) group.
  const sectionOf = (title: string) => row(page, title).evaluate((el) => el.closest('[data-list-section]')?.getAttribute('data-list-section'))
  await expect.poll(() => sectionOf('Bravo')).toBe(await sectionOf('Alpha'))
  expect(await row(page, 'Bravo').evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
})

test('the drop line starts at the rows’ title', async ({ page }) => {
  // A sorted list: the line (dashed) shows where the row would go.
  await seedWorkspace(page, seed({ name: 'Sorted', sort: 'name' }))
  await expect(row(page, 'Delta')).toBeVisible()
  const alpha = await box(row(page, 'Alpha'))
  await lift(page, row(page, 'Delta'), { x: alpha.x + 12, y: alpha.y + 4 })
  const line = wsListWidget(page, 't1').locator('[data-drop-line]')
  await expect(line).toHaveCount(1)
  const lineStart = await line.evaluate((el) => el.getBoundingClientRect().left + parseFloat(getComputedStyle(el, '::before').left))
  const titleStart = (await box(row(page, 'Alpha').locator('span[data-task-title]'))).x
  expect(Math.abs(lineStart - titleStart)).toBeLessThanOrEqual(1)

  await page.keyboard.press('Escape')
  await page.mouse.up()
})

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' })

  test('no tilt, no scale, and the drop lets go at once', async ({ page }) => {
    await seedWorkspace(page, seed({ name: 'Order' }))
    await expect(row(page, 'Delta')).toBeVisible()
    const bravo = await box(row(page, 'Bravo'))
    await lift(page, row(page, 'Delta'), { x: bravo.x + 12, y: bravo.y + 4 })
    await expect(page.locator(LIFTED)).toBeVisible()
    // Past the (1 ms) lift: still flat.
    await expect.poll(() => page.locator(LIFTED).evaluate((el) => el.getAnimations().length)).toBe(0)
    expect(await pose(page)).toEqual({ scale: 1, angle: 0 })

    await recordFrames(page, 'Delta')
    await releaseDrag(page)
    const frames = await recordedFrames(page)
    // No settle: gone by the first frame after the drop renders.
    expect(frames.filter((f) => f.overlay).every((f) => f.angle === 0)).toBe(true)
    await expect(page.locator(LIFTED)).toHaveCount(0)
    await expect.poll(() => rowTitles(wsListWidget(page, 't1'))).toEqual(['Alpha', 'Delta', 'Bravo', 'Charlie'])
  })
})
