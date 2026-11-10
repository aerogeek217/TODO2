import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'
import RECORDED from './fixtures/ambience-colours.json' with { type: 'json' }

/**
 * The ambience draws the same colours in both themes at a fixed clock and
 * place: the computed colours of every layer (the sky, sun, moon, clouds,
 * stars, the planet, aurora, mist, hairline, sunbeam, lamp and each season's weather),
 * pinned to `fixtures/ambience-colours.json` — recorded before the colours
 * moved from the components into `tokens.css` (cr33 A1). Each colour may
 * differ by under one step of 255 (the old `rgba()` rounded to whole
 * channels; `color-mix()` doesn't); a fully transparent stop is any colour.
 *
 * Re-record (only when a colour is meant to change):
 * `AMBIENCE_RECORD=1 npx playwright test e2e/ambience-colours.spec.ts`.
 */

test.use({ timezoneId: 'America/Chicago' })

const SEED: WorkspaceSeed = {
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'n1', kind: 'notes' as const }] })] }] }],
}

const CHICAGO = { lat: 41.88, lon: -87.63 }

/** The moments sampled: every layer shows in at least one. */
const SCENES: ReadonlyArray<readonly [string, string]> = [
  ['autumn noon', '2026-11-07T12:00:00'],
  ['autumn golden hour', '2026-11-07T15:55:00'],
  ['autumn sunset', '2026-11-07T16:35:00'],
  ['autumn dawn', '2026-11-07T06:50:00'],
  ['autumn night', '2026-11-07T23:00:00'],
  ['winter night', '2026-01-18T23:00:00'],
  ['spring noon', '2026-04-12T12:00:00'],
  ['summer noon', '2026-07-12T12:00:00'],
  ['summer night', '2026-07-12T23:00:00'],
]

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** Every ambience layer's colour-bearing computed properties, by a readable key. */
async function sample(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {}
    // A CSS module class (`_name_hash` in dev) or the plain name.
    const hasClass = (el: Element, name: string) => [...el.classList].some((c) => c === name || c.startsWith(`_${name}_`))
    const all = [...document.querySelectorAll('[data-ambience] *, [data-ambience]')]
    const first = (name: string) => all.find((el) => hasClass(el, name))
    const put = (key: string, el: Element | undefined, prop: string) => {
      if (el) out[key] = getComputedStyle(el).getPropertyValue(prop)
    }
    const sky = document.querySelector('[data-ambience="sky"]')
    put('sky', sky?.firstElementChild ?? undefined, 'background-image')
    put('sunGlow', first('sunGlow'), 'background-image')
    put('sunDisc', first('sunDisc'), 'background-image')
    put('cloud', first('cloud'), 'background-image')
    put('aurora', first('aurora'), 'background-image')
    put('mist', first('mist'), 'background-image')
    put('star', first('star'), 'background-color')
    put('starBright glow', first('starBright'), 'box-shadow')
    put('planet', first('planet'), 'background-color')
    put('planet glow', first('planet'), 'box-shadow')
    const moon = first('moon')
    put('moonDisc', moon?.querySelector('circle') ?? undefined, 'fill')
    put('moonLit', moon?.querySelector('path') ?? undefined, 'fill')
    put('hairlineLine', first('hairlineLine'), 'background-image')
    put('hairlineGlow', first('hairlineGlow'), 'background-image')
    put('sunbeam', first('sunbeam'), 'background-image')
    put('lamp', document.querySelector('[data-ambience="lamp"]') ?? undefined, 'background-image')
    document.querySelectorAll('[data-ambience-weather]').forEach((field, f) => {
      const where = field.closest('[data-ambience="sky"]') ? 'bar' : 'behind'
      ;[...field.children].slice(0, 6).forEach((p, i) => {
        put(`weather ${where} ${f} ${i} ${(p.className.match(/_(flake|leaf|petal|seed|firefly)_/) ?? [])[1] ?? ''}`, p, 'background-color')
      })
      const fly = [...field.children].find((p) => /_firefly_/.test(p.className))
      put(`weather ${where} firefly glow`, fly, 'box-shadow')
    })
    return out
  })
}

type Rgba = [number, number, number, number]

/** A computed colour (`rgb()`, `rgba()` or `color(srgb …)`) as 0–255 channels and an alpha. */
function parseColour(text: string): Rgba {
  const srgb = /^color\(srgb\s+([\d.e-]+)\s+([\d.e-]+)\s+([\d.e-]+)(?:\s*\/\s*([\d.e-]+))?\)$/.exec(text)
  if (srgb) return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, srgb[4] == null ? 1 : Number(srgb[4])]
  const rgb = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(text)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), rgb[4] == null ? 1 : Number(rgb[4])]
  throw new Error(`not a computed colour: ${text}`)
}

const COLOUR = /color\(srgb[^)]*\)|rgba?\([^)]*\)/g

/** A value's colours, and the value with each colour replaced by `C` (its gradient's shape). */
function split(value: string): { shape: string; colours: Rgba[] } {
  return { shape: value.replace(COLOUR, 'C'), colours: (value.match(COLOUR) ?? []).map(parseColour) }
}

function sameColour(a: Rgba, b: Rgba): boolean {
  if (Math.abs(a[3] - b[3]) > 0.004) return false
  if (a[3] === 0 && b[3] === 0) return true
  return [0, 1, 2].every((i) => Math.abs(a[i]! - b[i]!) <= 1)
}

test('the ambience’s colours in both themes at a fixed clock', async ({ page }) => {
  test.setTimeout(120_000)
  const record = process.env.AMBIENCE_RECORD === '1'
  const recorded = RECORDED as Record<string, Record<string, string>>
  const got: Record<string, Record<string, string>> = {}

  await page.clock.setFixedTime(new Date(SCENES[0]![1]))
  await seedWorkspace(page, SEED)
  await page.evaluate(async (place) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setAmbience: (changes: Record<string, unknown>) => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setAmbience({ enabled: true, place, sky: 'vivid', motion: 100, seasons: true })
  }, CHICAGO)

  for (const theme of ['dark', 'light'] as const) {
    await setTheme(page, theme)
    for (const [name, at] of SCENES) {
      await page.clock.setFixedTime(new Date(at))
      await page.reload()
      await expect(page.locator('[data-ambience="sky"]')).toBeAttached()
      await expect(page.locator('[data-ambience="backdrop"]')).toBeAttached()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      got[`${theme} ${name}`] = await sample(page)
    }
  }

  if (record) {
    writeFileSync(new URL('./fixtures/ambience-colours.json', import.meta.url), `${JSON.stringify(got, null, 2)}\n`)
    return
  }

  const problems: string[] = []
  expect(Object.keys(got).sort()).toEqual(Object.keys(recorded).sort())
  for (const [scene, values] of Object.entries(recorded)) {
    const now = got[scene] ?? {}
    expect(Object.keys(now).sort(), scene).toEqual(Object.keys(values).sort())
    for (const [key, was] of Object.entries(values)) {
      const is = now[key] ?? ''
      const a = split(was)
      const b = split(is)
      const same = a.shape === b.shape
        && a.colours.length === b.colours.length
        && a.colours.every((c, i) => sameColour(c, b.colours[i]!))
      if (!same) problems.push(`${scene} · ${key}\n  was ${was}\n  is  ${is}`)
    }
  }
  expect(problems).toEqual([])
})
