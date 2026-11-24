import { expect, type Locator, type Page } from '@playwright/test'

export interface Box { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

/** The locator's bounding box (viewport pixels); throws when it has none (hidden / detached). */
export async function box(locator: Locator): Promise<Box> {
  const b = await locator.boundingBox()
  if (!b) throw new Error(`no bounding box for ${locator.toString()}`)
  return b
}

/** A point inside the locator's box: `fx` / `fy` are fractions of its width / height (default: its centre). */
export async function pointIn(locator: Locator, fx = 0.5, fy = 0.5): Promise<Point> {
  const b = await box(locator)
  return { x: b.x + b.width * fx, y: b.y + b.height * fy }
}

/**
 * Where a divider is pressed to drag it: a quarter along its length, clear
 * of the collapse pill its hover or focus shows at its middle (the pill is
 * its own target: a press there never resizes).
 */
export function dividerGrip(b: Box): Point {
  return b.height > b.width ? { x: b.x + b.width / 2, y: b.y + b.height / 4 } : { x: b.x + b.width / 4, y: b.y + b.height / 2 }
}

/** The locator's box lies inside the viewport, at least `margin` px from every edge (half a pixel of rounding allowed). */
export async function expectInsideViewport(page: Page, locator: Locator, margin = 8): Promise<void> {
  const vp = page.viewportSize()
  if (!vp) throw new Error('no viewport')
  const b = await box(locator)
  expect(b.x).toBeGreaterThanOrEqual(margin - 0.5)
  expect(b.y).toBeGreaterThanOrEqual(margin - 0.5)
  expect(b.x + b.width).toBeLessThanOrEqual(vp.width - margin + 0.5)
  expect(b.y + b.height).toBeLessThanOrEqual(vp.height - margin + 0.5)
}

/**
 * A real mouse click outside any popover or row: the bottom of `area`
 * (20 px above its lower edge, centred) — e.g. a list widget's empty space
 * below its rows.
 */
export async function clickOutside(page: Page, area: Locator): Promise<void> {
  const b = await box(area)
  await page.mouse.click(b.x + b.width / 2, b.y + b.height - 20)
}
