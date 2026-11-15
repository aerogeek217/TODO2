import type { Page } from '@playwright/test'

/**
 * Time a spec must let pass, on the page's own clock instead of a sleep
 * (specs never wait on timers: a sleep is too short on a slow machine and
 * wasted on a fast one; cr34 T11).
 */

/** Longer than the app tooltip's delay (`components/shared/use-tooltip`: 400 ms after a hover or a keyboard focus). */
const PAST_TOOLTIP_DELAY_MS = 1000

/**
 * Puts the page's timers on Playwright's clock, which keeps running like
 * the real one until a spec moves it (`tooltipDelayPassed`). Call it before
 * the page loads (before `seedWorkspace`), so every timer of the app is on
 * it.
 */
export async function installClock(page: Page): Promise<void> {
  await page.clock.install()
}

/**
 * The page's task queue has run what was posted so far — what a fired timer
 * scheduled (React's render of a state it set) is on screen. A message
 * channel's turn, queued behind React's own.
 */
export async function pageTasksDone(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      await new Promise<void>((resolve) => {
        const channel = new MessageChannel()
        channel.port1.onmessage = () => resolve()
        channel.port2.postMessage(null)
      })
    }
  })
}

/**
 * The tooltip delay has passed since the last hover or focus, exactly: the
 * page's clock (`installClock`) runs a second on, firing every timer due in
 * it — a resting pointer's among them —, and what they scheduled has been
 * drawn. A tooltip that is going to open is open after this; one that isn't
 * there now never opens for that hover.
 */
export async function tooltipDelayPassed(page: Page): Promise<void> {
  await page.clock.runFor(PAST_TOOLTIP_DELAY_MS)
  await pageTasksDone(page)
}
