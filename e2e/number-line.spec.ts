import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WsTabSeed } from './fixtures/workspace'
import { box } from './fixtures/geometry'

/**
 * A Number's 14-day line in a real browser (widget feedback 2D): it sits
 * beside the count wherever it fits — in a Numbers (fit) row too — and wraps
 * out of the count's one-line box where it doesn't, the change first, never
 * growing the row; it is drawn in the color that applies (lit, or the
 * color otherwise; Auto the accent); approximate, it says so in its
 * tooltip, with no ≈ mark beside it.
 */

test.use({ viewport: { width: 1280, height: 700 } })

const numberIn = (page: Page, tabId: string): Locator => page.locator(`[data-glance-tab="${tabId}"] [data-number]`)

/** Whether `part` of Number `tabId` lies inside the count's line box (shown) or was wrapped out of it (clipped). */
async function placement(page: Page, tabId: string, part: string): Promise<'shown' | 'clipped' | 'none'> {
  return numberIn(page, tabId).evaluate((n, sel) => {
    const el = n.querySelector(sel)
    if (!el) return 'none'
    const clip = n.querySelector('[data-testid="number-count"]')!.parentElement!.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    return r.top >= clip.top - 0.5 && r.bottom <= clip.bottom + 0.5 && r.right <= clip.right + 0.5 ? 'shown' : 'clipped'
  }, part)
}

/** A CSS color as the page computes it (for comparing with a stroke). */
function computed(page: Page, color: string): Promise<string> {
  return page.evaluate((c) => {
    const probe = document.createElement('span')
    probe.style.color = c
    document.body.appendChild(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, color)
}

const stroke = (page: Page, tabId: string): Promise<string> =>
  numberIn(page, tabId).locator('[data-sparkline] polyline').evaluate((p) => getComputedStyle(p).stroke)

const number = (id: string, glance: Record<string, unknown>): WsTabSeed => ({ id, kind: 'number', glance })

test('in a Numbers row the line shows beside the count where it fits, and the row stays as tall', async ({ page }) => {
  await seedWorkspace(page, {
    tasks: [{ title: 'Late', dueInDays: -2 }, { title: 'Open' }],
    layouts: [{
      name: 'Row',
      table: {
        // About 72 (the glance minimum), 128 and 490px wide; Notes takes the rest.
        areas: ['a b c d', 'x x x d'],
        cols: [70, 130, 500, 568],
        cells: [
          { id: 'a', tabs: [number('ta', { metric: 'open' })] },
          { id: 'b', tabs: [number('tb', { metric: 'open' })] },
          { id: 'c', tabs: [number('tc', { metric: 'open' })] },
          { id: 'd', tabs: [{ id: 'td', kind: 'notes' }] },
          { id: 'x', tabs: [{ id: 'tx', kind: 'notes' }] },
        ],
      },
    }],
  })
  await expect(numberIn(page, 'tc').locator('[data-sparkline]')).toHaveCount(1)
  // The small face (a fit row), each Number 58px tall as before the line.
  for (const id of ['a', 'b', 'c']) expect((await box(page.locator(`[data-ws-cell="${id}"]`))).height).toBeLessThanOrEqual(60)
  await expect(page.locator('[data-glance-tab="tc"]')).toHaveAttribute('data-face', 'small')
  // Wide: the line and its change; middle: the line alone; narrow: the count alone.
  expect(await placement(page, 'tc', '[data-sparkline]')).toBe('shown')
  expect(await placement(page, 'tc', '[data-testid="number-delta"]')).toBe('shown')
  expect(await placement(page, 'tb', '[data-sparkline]')).toBe('shown')
  expect(await placement(page, 'tb', '[data-testid="number-delta"]')).toBe('clipped')
  expect(await placement(page, 'ta', '[data-sparkline]')).toBe('clipped')
  expect(await placement(page, 'ta', '[data-testid="number-count"]')).toBe('shown')
})

test('the line takes the color that applies: lit, otherwise, Auto the accent', async ({ page }) => {
  await seedWorkspace(page, {
    settings: { themeMode: 'dark' },
    tasks: [{ title: 'Late', dueInDays: -2 }, { title: 'Open' }],
    layouts: [{
      name: 'Colors',
      table: {
        areas: ['a b c d', 'x x x d'],
        cells: [
          // Never lit, Auto: the accent (as before).
          { id: 'a', tabs: [number('ta', { metric: 'open' })] },
          // Never lit, a color otherwise: violet.
          { id: 'b', tabs: [number('tb', { metric: 'open', unlitColor: '#A78BFA' })] },
          // Lit (above 0) in rose; its color otherwise unused.
          { id: 'c', tabs: [number('tc', { metric: 'open', litWhen: 'above', litAt: 0, color: '#e07a9a', unlitColor: '#A78BFA' })] },
          // Lit on Auto: the accent.
          { id: 'd', tabs: [number('td', { metric: 'open', litWhen: 'above', litAt: 0 })] },
          { id: 'x', tabs: [{ id: 'tx', kind: 'notes' }] },
        ],
      },
    }],
  })
  await expect(numberIn(page, 'td').locator('[data-sparkline]')).toHaveCount(1)
  const accent = await computed(page, 'var(--color-accent)')
  const violet = await computed(page, 'var(--hue-violet-text)')
  const rose = await computed(page, 'var(--hue-rose-text)')
  expect(await stroke(page, 'ta')).toBe(accent)
  expect(await stroke(page, 'tb')).toBe(violet)
  expect(await stroke(page, 'tc')).toBe(rose)
  expect(await stroke(page, 'td')).toBe(accent)
  // Its name and count take the same color otherwise; Auto keeps the muted name.
  expect(await numberIn(page, 'tb').getByTestId('number-count').evaluate((e) => getComputedStyle(e).color)).toBe(violet)
  expect(await numberIn(page, 'ta').getByTestId('number-count').evaluate((e) => getComputedStyle(e).color)).toBe(await computed(page, 'var(--color-text-primary)'))
})

test('approximate under a lens: no ≈ beside the line; its tooltip says why', async ({ page }) => {
  await seedWorkspace(page, {
    people: ['Aisha'],
    lenses: [{ id: 'lens-aisha', name: 'Aisha', predicate: { personIds: [1] } }],
    tasks: [{ title: 'A', people: ['Aisha'] }, { title: 'B' }],
    layouts: [{ name: 'M', table: { areas: ['n', 'x'], rows: [{ px: 200 }, 1000], cells: [
      { id: 'n', tabs: [number('tn', { metric: 'open', compare: 'none' })] },
      { id: 'x', tabs: [{ id: 'tx', kind: 'notes' }] },
    ] } }],
  })
  const line = numberIn(page, 'tn').locator('[data-number-line]')
  await expect(line).toHaveCount(1)
  await expect(line).not.toHaveAttribute('data-approximate', 'true')
  await page.locator('header').getByRole('button', { name: /^Lens:/ }).click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^Aisha/ }).click()
  // The history log began today, so a filter reading people is approximate over the 14 days.
  await expect(line).toHaveAttribute('data-approximate', 'true')
  await expect(numberIn(page, 'tn')).not.toContainText('≈')
  await line.hover()
  await expect(page.getByRole('tooltip')).toContainText('Approximate: on some of these days, people read as they are now')
})
