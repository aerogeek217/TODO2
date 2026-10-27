import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedWorkspace, type WorkspaceSeed } from './fixtures/workspace'

/**
 * cr22: the top bar's lens control is its own part of the bar, between the
 * layout tabs and the screen-filter tray — never inside the tray, never
 * lifted with it over the filtered-tasks panel. While a lens is on the
 * whole control takes the accent (a tinted surface, an inset accent border,
 * the glasses and the name in the text accent), as the tray takes red while
 * a filter is on; lifted or with no lens it is neutral. It never folds: the
 * tray shrinks and folds around it, and only when the bar folded as far as
 * it goes is still short is its name cut (the whole name in its tooltip).
 */

const SEED: WorkspaceSeed = {
  people: ['Aisha Rahman', 'Marcus Chen', 'Sarah Kim'],
  tags: ['customer', 'urgent'],
  statuses: ['Assigned', 'Waiting'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Write the review', people: ['Aisha Rahman'] },
    { title: 'Plan the offsite', people: ['Marcus Chen'], tags: ['customer'] },
    { title: 'Call the vendor' },
  ],
  lenses: [
    { id: 'lens-person', name: 'Has a person', predicate: { personIds: [0], negate: { personIds: true } } },
    { id: 'lens-long', name: 'Customer escalations this quarter', predicate: { searchText: 'e' } },
  ],
  layouts: [
    { name: 'Default', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
    { name: 'Lists from upgrade', columns: [] },
  ],
}

const header = (page: Page) => page.locator('header')
const tray = (page: Page) => header(page).getByRole('group', { name: 'Screen filters — apply to every widget' })
const control = (page: Page) => header(page).getByTestId('lens-control')
const lensName = (page: Page) => header(page).getByRole('button', { name: /^Lens:/ })

async function pickLens(page: Page, name: string) {
  await lensName(page).click()
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click()
  await expect(lensName(page)).toHaveAccessibleName(`Lens: ${name === 'No lens' ? 'none' : name}`)
}

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** The top bar's People filter on one person (or off), through the filter store. */
async function personChip(page: Page, name: string | null) {
  await page.evaluate(async (n) => {
    const people = (await import(/* @vite-ignore */ '/src/stores/person-store.ts' as string)) as {
      usePersonStore: { getState: () => { people: Array<{ id?: number; name: string }> } }
    }
    const filters = (await import(/* @vite-ignore */ '/src/stores/filter-store.ts' as string)) as {
      useFilterStore: { getState: () => { setPersonIds: (ids: Set<number> | null) => void } }
    }
    const p = people.usePersonStore.getState().people.find((x) => x.name === n)
    filters.useFilterStore.getState().setPersonIds(p?.id != null ? new Set([p.id]) : null)
  }, name)
}

type Rgba = [number, number, number, number]

/**
 * Resolves CSS colours to 0–255 channels and a 0–1 alpha in the page, through
 * a canvas pixel (whatever the computed form: `rgb()`, `color(srgb …)`, …).
 */
async function resolve<K extends string>(page: Page, colours: Record<K, string>): Promise<Record<K, Rgba>> {
  return page.evaluate((cs) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!
    const px = (c: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = c
      ctx.fillRect(0, 0, 1, 1)
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
      return [r!, g!, b!, a! / 255]
    }
    return Object.fromEntries(Object.entries(cs).map(([k, v]) => [k, px(v as string)]))
  }, colours) as Promise<Record<K, Rgba>>
}

/** The theme's tokens, as computed now. */
async function tokens(page: Page) {
  const raw = await page.evaluate(() => {
    const probe = document.createElement('span')
    document.body.append(probe)
    const read = (v: string) => {
      probe.style.color = `var(${v})`
      return getComputedStyle(probe).color
    }
    const out = { accent: read('--color-accent'), accentText: read('--color-accent-text'), surface: read('--color-surface'), borderMuted: read('--color-border-muted') }
    probe.remove()
    return out
  })
  return resolve(page, raw)
}

/** The control's look once its transition is over: its background, its inset border's colour, the name's and the glasses' colours. */
async function look(page: Page) {
  const raw = await control(page).evaluate(async (el) => {
    await Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished))
    const cs = getComputedStyle(el)
    const first = el.firstElementChild as HTMLElement
    return {
      background: cs.backgroundColor,
      // `<colour> 0px 0px 0px 1px inset`.
      border: cs.boxShadow.replace(/\s+-?[\d.]+px.*$/, ''),
      name: getComputedStyle(el.querySelector('[data-lens-name]')!).color,
      glasses: getComputedStyle(first).color,
    }
  })
  return resolve(page, raw)
}

const near = (a: Rgba, b: Rgba, tol = 2) => a.every((v, i) => Math.abs(v - b[i]!) <= (i === 3 ? 0.02 : tol))
const mix = (a: Rgba, b: Rgba, p: number): Rgba => [0, 1, 2].map((i) => a[i]! * p + b[i]! * (1 - p)).concat(1) as Rgba

async function expectLit(page: Page) {
  const t = await tokens(page)
  const l = await look(page)
  expect(near(l.background, mix(t.accent, t.surface, 0.08)), `background ${l.background} vs accent ${t.accent}`).toBe(true)
  expect(near(l.border, [t.accent[0], t.accent[1], t.accent[2], 0.45]), `border ${l.border} vs accent ${t.accent}`).toBe(true)
  expect(near(l.name, t.accentText), `name ${l.name} vs ${t.accentText}`).toBe(true)
  expect(near(l.glasses, t.accentText), `glasses ${l.glasses} vs ${t.accentText}`).toBe(true)
}

async function expectNeutral(page: Page) {
  const t = await tokens(page)
  const l = await look(page)
  // The tray's neutral frame: the surface at 70 %, the muted border; no accent anywhere.
  expect(near(l.background, [t.surface[0], t.surface[1], t.surface[2], 0.7]), `background ${l.background}`).toBe(true)
  expect(near(l.border, t.borderMuted), `border ${l.border} vs ${t.borderMuted}`).toBe(true)
  expect(near(l.name, t.accentText, 12)).toBe(false)
  expect(near(l.glasses, t.accentText, 12)).toBe(false)
}

/** The edges of the layout controls, the control and the tray; the bar on one line. */
const geometry = (page: Page) => header(page).evaluate((bar) => {
  const rect = (sel: string) => bar.querySelector(sel)!.getBoundingClientRect()
  const layout = rect('[data-fold-part="layout"]')
  const lens = rect('[data-testid="lens-control"]')
  const trayBox = rect('[data-filter-row]')
  const spring = rect('[data-fold-part="spring"]')
  const box = bar.getBoundingClientRect()
  const parts = [...bar.querySelectorAll('button, input')].map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0)
  const name = bar.querySelector<HTMLElement>('[data-lens-name]')!
  return {
    fold: bar.dataset.fold,
    layoutRight: Math.round(layout.right),
    lensLeft: Math.round(lens.left),
    lensRight: Math.round(lens.right),
    lensHeight: lens.height,
    trayLeft: Math.round(trayBox.left),
    trayRight: Math.round(trayBox.right),
    trayHeight: trayBox.height,
    springLeft: Math.round(spring.left),
    nameCut: name.scrollWidth > name.clientWidth + 1,
    nameWidth: Math.round(name.getBoundingClientRect().width),
    oneLine: box.height === 40 && bar.scrollWidth === bar.clientWidth
      && parts.every((r) => r.right <= box.right + 0.5 && r.top >= box.top - 0.5 && r.bottom <= box.bottom + 0.5),
  }
})

async function settled(page: Page) {
  let last = ''
  await expect.poll(async () => {
    const now = JSON.stringify(await geometry(page))
    const same = now === last
    last = now
    return same
  }, { intervals: [100, 100, 100, 200] }).toBe(true)
  return JSON.parse(last) as Awaited<ReturnType<typeof geometry>>
}

const panel = (page: Page) => page.locator('[data-filter-panel]')
const counter = (page: Page) => tray(page).getByRole('button', { name: /tasks shown\. Show them$/ })
const expanded = (page: Page) => header(page).locator('[data-expanded]')

/** The panel's left edge against the tray's, px (0: lined up). */
const panelOffset = (page: Page) => page.evaluate(() => {
  const t = document.querySelector('header [data-filter-row]')!.getBoundingClientRect()
  const p = document.querySelector('[data-filter-panel]')!.getBoundingClientRect()
  return Math.round(p.left - t.left) || 0 // Not -0.
})

/** The palette's Cycle Lens, run from the tray's counter: nothing closes the panel. */
async function cycleLensFromPalette(page: Page) {
  await counter(page).focus()
  await page.keyboard.press('ControlOrMeta+k')
  await page.getByRole('combobox').fill('cycle lens')
  await page.getByRole('option', { name: /Cycle Lens/ }).click()
  await expect(page.getByRole('combobox')).toHaveCount(0)
}

async function inTray(page: Page, el: Locator): Promise<boolean> {
  const handle = await el.elementHandle()
  return tray(page).evaluate((t, node) => t.contains(node), handle)
}

test.use({ viewport: { width: 1600, height: 900 } })

test('it sits after the layout tabs and before the tray, outside it, as tall as the tray', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
  for (const name of ['No lens', 'Has a person'] as const) {
    if (name !== 'No lens') await pickLens(page, name)
    const g = await settled(page)
    expect(g.lensLeft).toBeGreaterThan(g.layoutRight)
    expect(g.trayLeft).toBeGreaterThan(g.lensRight)
    expect(g.lensHeight).toBe(g.trayHeight)
    expect(g.oneLine).toBe(true)
    expect(await inTray(page, control(page))).toBe(false)
  }
  // The counter stays the tray's.
  await expect(tray(page).getByRole('button', { name: /tasks shown\. Show them$/ })).toBeVisible()
})

for (const mode of ['dark', 'light'] as const) {
  test(`${mode}: lit in the accent while on; neutral when lifted and with no lens`, async ({ page }) => {
    await seedWorkspace(page, SEED)
    await setTheme(page, mode)
    await expectNeutral(page)
    await pickLens(page, 'Has a person')
    await expect(control(page)).toHaveAttribute('data-state', 'on')
    await expectLit(page)
    // A chip on top: the tray red beside it, the control still the accent's.
    await personChip(page, 'Marcus Chen')
    await expect(tray(page)).toHaveAttribute('data-filtered', 'true')
    await expectLit(page)
    await personChip(page, null)

    await header(page).getByRole('button', { name: 'Lens on. Lift it' }).click()
    await expect(control(page)).toHaveAttribute('data-state', 'lifted')
    await expectNeutral(page)
    await header(page).getByRole('button', { name: 'Lens lifted. Put it back' }).click()
    await expectLit(page)

    await pickLens(page, 'No lens')
    await expect(control(page)).toHaveAttribute('data-state', 'none')
    await expectNeutral(page)
  })
}

test('a custom accent: the lit control follows it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await setTheme(page, 'dark')
  await pickLens(page, 'Has a person')
  await page.evaluate(async () => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setColor: (theme: string, key: string, value: string) => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setColor('dark', 'accent', '#c084fc')
  })
  await expect.poll(async () => (await tokens(page)).accent.slice(0, 3).map(Math.round)).toEqual([192, 132, 252])
  await expectLit(page)
})

test('narrowing with a long lens on: it never folds or overflows; the tray folds around it, its name is cut only at the last', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Customer escalations this quarter')
  await personChip(page, 'Aisha Rahman')
  const wide = await settled(page)
  expect(wide.nameCut).toBe(true) // At its 160px cap.
  expect(wide.nameWidth).toBe(160)

  const seen = new Set<string>()
  for (let width = 1600; width >= 760; width -= 40) {
    await page.setViewportSize({ width, height: 900 })
    const g = await settled(page)
    expect(g.oneLine, `at ${width}px`).toBe(true)
    expect(g.lensLeft, `at ${width}px`).toBeGreaterThan(g.layoutRight)
    expect(g.trayLeft, `at ${width}px`).toBeGreaterThan(g.lensRight)
    expect(g.trayRight, `at ${width}px`).toBeLessThanOrEqual(g.springLeft)
    // Cut further than its cap only once the tabs have folded too.
    if (g.nameWidth < 160) expect(g.fold, `at ${width}px`).toBe('both')
    seen.add(g.nameWidth < 160 ? 'name cut' : g.fold!)
  }
  expect([...seen]).toEqual(['none', 'filters', 'both', 'name cut'])

  // Cut: the whole name in its tooltip.
  await lensName(page).hover()
  await expect(page.getByRole('tooltip')).toHaveText('Lens: Customer escalations this quarter')
  await page.mouse.move(640, 600)

  await page.setViewportSize({ width: 1600, height: 900 })
  await expect.poll(() => settled(page)).toEqual(wide)
})

test('over folded filters the tray expands without it; a press on it closes the panel, then its picker picks', async ({ page }) => {
  // Room enough for the expanded tray to the right of where it sits (narrower,
  // it slides left over whatever is beside it — the control too, as the tabs).
  await page.setViewportSize({ width: 1300, height: 900 })
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Has a person')
  await personChip(page, 'Aisha Rahman')
  await expect(tray(page).getByRole('button', { name: /^Filters/ })).toBeVisible()
  const closed = await settled(page)

  await tray(page).getByRole('button', { name: /tasks shown\. Show them$/ }).click()
  const panel = page.locator('[data-filter-panel]')
  await expect(panel).toBeVisible()
  await expect(header(page).locator('[data-expanded]')).toHaveCount(1)
  // The control stays where it was in the bar, outside the expanded tray.
  expect(await inTray(page, control(page))).toBe(false)
  const open = await geometry(page)
  expect(open).toMatchObject({ lensLeft: closed.lensLeft, lensRight: closed.lensRight, layoutRight: closed.layoutRight, trayLeft: closed.trayLeft })

  // A press on it is a press on the bar outside the tray: the panel closes, its picker opens.
  await lensName(page).click()
  await expect(panel).toHaveCount(0)
  await page.getByRole('menu', { name: 'Lens' }).getByRole('menuitemradio', { name: /^No lens/ }).click()
  await expect(lensName(page)).toHaveAccessibleName('Lens: none')
  await expect(control(page)).toHaveAttribute('data-state', 'none')
})

test('the panel open: a lens change from the palette moves the tray, and the panel moves with it', async ({ page }) => {
  await seedWorkspace(page, SEED)
  await personChip(page, 'Aisha Rahman')
  await counter(page).click()
  await expect(panel(page)).toBeVisible()
  await expect.poll(() => panelOffset(page)).toBe(0)
  let before = await settled(page)
  // No lens → a lens → a longer name: the control widens, the tray moves; the
  // counter reads `1 of 3` throughout, so the tray itself keeps its size.
  for (const name of ['Has a person', 'Customer escalations this quarter']) {
    await cycleLensFromPalette(page)
    await expect(lensName(page)).toHaveAccessibleName(`Lens: ${name}`)
    await expect(panel(page)).toBeVisible()
    const after = await settled(page)
    expect(after.trayLeft).toBeGreaterThan(before.trayLeft)
    expect(after.trayRight - after.trayLeft).toBe(before.trayRight - before.trayLeft)
    await expect.poll(() => panelOffset(page)).toBe(0)
    before = after
  }
})

test('over folded filters with the panel open: a lens change moves the expanded tray with its place in the bar', async ({ page }) => {
  await page.setViewportSize({ width: 1300, height: 900 })
  await seedWorkspace(page, SEED)
  await pickLens(page, 'Has a person')
  await personChip(page, 'Aisha Rahman')
  await expect(tray(page).getByRole('button', { name: /^Filters/ })).toBeVisible()
  await counter(page).click()
  await expect(panel(page)).toBeVisible()
  await expect(expanded(page)).toHaveCount(1)
  const leftOf = (loc: Locator) => loc.evaluate((el) => Math.round(el.getBoundingClientRect().left))
  const slot = header(page).locator('[data-fold-part="tray-slot"]')
  const first = { slot: await leftOf(slot), tray: await leftOf(expanded(page)) }

  await cycleLensFromPalette(page)
  await expect(lensName(page)).toHaveAccessibleName('Lens: Customer escalations this quarter')
  await expect(panel(page)).toBeVisible()
  await expect(expanded(page)).toHaveCount(1)
  await expect.poll(() => leftOf(slot)).toBeGreaterThan(first.slot)
  // It follows its slot (as far as the window's right gutter lets it), the panel under it…
  await expect.poll(() => leftOf(expanded(page))).toBeGreaterThan(first.tray)
  await expect.poll(() => panelOffset(page)).toBe(0)
  await settled(page)
  const live = await leftOf(expanded(page))
  // …to where a fresh open places it.
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await counter(page).click()
  await expect(expanded(page)).toHaveCount(1)
  await expect.poll(() => leftOf(expanded(page))).toBe(live)
  await expect.poll(() => panelOffset(page)).toBe(0)
})
