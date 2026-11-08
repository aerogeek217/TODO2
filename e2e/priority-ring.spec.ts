import { expect, test, type Locator, type Page } from '@playwright/test'
import { seedTaskList } from './fixtures/workspace'

/**
 * D25 B · the row spine: a task's priority is a ring on its checkbox (the
 * marker dots are gone), the priority menu opens from a slim gutter before
 * the checkbox that shows a flag on row hover, and the row's type reads in
 * two weights — the title at 500, the meta at 11.5px tabular in the muted
 * grey — on 30px rows with a faint hairline from the title's start in a flat
 * list. Read from the rendered page: the ring's dashes, the stroke colours'
 * contrast and the hairline's place are layout and paint, not JSDOM.
 */

const TASKS = [
  { title: 'Plain' },
  { title: 'Urgent', urgent: true },
  { title: 'Due soon', dueInDays: 1 },
  { title: 'Important', important: true },
  { title: 'Urgent and important', urgent: true, important: true },
  { title: 'Focus', focus: true },
  { title: 'Focus and urgent', focus: true, urgent: true },
]

const row = (widget: Locator, title: string) => widget.locator('[data-todo-id]', { has: widget.page().locator(`span[data-task-title="${title}"]`) })
const ringOf = (widget: Locator, title: string) => row(widget, title).locator('[data-priority-ring]')

async function setTheme(page: Page, mode: 'dark' | 'light') {
  await page.evaluate(async (m) => {
    const mod = (await import(/* @vite-ignore */ '/src/stores/settings-store.ts' as string)) as {
      useSettingsStore: { getState: () => { setThemeMode: (mode: 'dark' | 'light') => Promise<void> } }
    }
    await mod.useSettingsStore.getState().setThemeMode(m)
  }, mode)
  await expect(page.locator('html')).toHaveAttribute('data-theme', mode)
}

/** Each ring part's stroke against the row list's surface: the WCAG contrast ratio (non-text graphics need 3:1). */
async function ringContrasts(widget: Locator): Promise<Record<string, number>> {
  return widget.evaluate((root) => {
    const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const ch = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
    }
    const ratio = (a: number[], b: number[]) => { const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x); return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05) }
    const surface = (el: Element) => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const bg = getComputedStyle(p).backgroundColor
        if (bg && !bg.startsWith('rgba(0, 0, 0, 0)') && !/rgba\(.*, 0\)$/.test(bg)) return rgb(bg)
      }
      return rgb(getComputedStyle(document.body).backgroundColor)
    }
    const out: Record<string, number> = {}
    for (const part of Array.from(root.querySelectorAll('[data-ring-part]'))) {
      const key = part.getAttribute('data-ring-part') ?? ''
      // The row list's surface: the first painted box above the row (the row itself is clear at rest).
      const listRow = part.closest('[data-todo-id]')?.parentElement ?? part
      out[key] = Math.min(out[key] ?? Infinity, ratio(rgb(getComputedStyle(part).stroke), surface(listRow)))
    }
    return out
  })
}

test.describe('the priority ring and the row spine (D25 B)', () => {
  test.use({ viewport: { width: 1100, height: 800 } })

  test('Urgent and Important are rings on the checkbox — solid, dashed for urgent by date, split for both —, Focus a tight glow, never a ring', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: TASKS })
    await expect(row(widget, 'Plain')).toBeVisible()
    await expect(ringOf(widget, 'Plain')).toHaveCount(0)
    await expect(ringOf(widget, 'Urgent')).toHaveAttribute('data-priority-ring', 'urgent')
    await expect(ringOf(widget, 'Important')).toHaveAttribute('data-priority-ring', 'important')
    await expect(ringOf(widget, 'Focus')).toHaveCount(0)
    await expect(ringOf(widget, 'Urgent and important')).toHaveAttribute('data-priority-ring', 'split')
    await expect(row(widget, 'Urgent and important').locator('[data-ring-part]')).toHaveCount(2)

    // Urgent by its due date: the fine dash (2 / 1.5 px), not a CSS dashed border.
    const dashed = await ringOf(widget, 'Due soon').locator('[data-ring-part="urgent"]').evaluate((el) => {
      const cs = getComputedStyle(el)
      return { dash: cs.strokeDasharray, width: cs.strokeWidth }
    })
    expect(dashed).toEqual({ dash: '2px, 1.5px', width: '2px' })
    const solid = await ringOf(widget, 'Urgent').locator('rect').evaluate((el) => getComputedStyle(el).strokeDasharray)
    expect(solid).toBe('none')

    // The ring sits on the checkbox's box, and the box's own border gives way to it.
    const fit = await row(widget, 'Urgent').locator('[data-row-cell="checkbox"]').evaluate((box) => {
      const ring = box.parentElement?.querySelector('[data-priority-ring]')?.getBoundingClientRect()
      const b = box.getBoundingClientRect()
      return { dx: Math.abs((ring?.x ?? 0) - b.x), dw: Math.abs((ring?.width ?? 0) - b.width), border: getComputedStyle(box).borderTopColor }
    })
    expect(fit.dx).toBeLessThan(0.5)
    expect(fit.dw).toBeLessThan(0.5)
    expect(fit.border).toBe('rgba(0, 0, 0, 0)')

    // Focus: a glow the box's shape around it, with a ring or alone (the box keeping its own border), tight: 4px blur.
    for (const title of ['Focus', 'Focus and urgent']) {
      const glow = await row(widget, title).locator('[data-row-cell="checkbox"]').evaluate((box) => {
        const g = box.parentElement!.querySelector<HTMLElement>('[data-focus-glow]')!
        const gb = g.getBoundingClientRect()
        const b = box.getBoundingClientRect()
        return { dx: Math.abs(gb.x - b.x), dw: Math.abs(gb.width - b.width), shadow: getComputedStyle(g).boxShadow, border: getComputedStyle(box).borderTopColor }
      })
      expect(glow.dx).toBeLessThan(0.5)
      expect(glow.dw).toBeLessThan(0.5)
      expect(glow.shadow).toMatch(/ 0px 0px 4px 1px$/)
      if (title === 'Focus') expect(glow.border).not.toBe('rgba(0, 0, 0, 0)')
    }
    await expect(row(widget, 'Urgent').locator('[data-focus-glow]')).toHaveCount(0)
  })

  test('the gutter: empty at rest, a flag on row hover, and a click opens the priority menu', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: TASKS })
    const r = row(widget, 'Urgent')
    const gutter = r.locator('[data-row-cell="markers"]')
    const flagOpacity = () => gutter.locator('[data-gutter-flag]').evaluate((el) => getComputedStyle(el).opacity)
    await page.mouse.move(1000, 790)
    await expect.poll(flagOpacity).toBe('0')
    await r.locator('span[data-task-title="Urgent"]').hover()
    await expect.poll(flagOpacity).toBe('1')
    await expect(gutter).toHaveAccessibleName('Priority: Urgent')
    // The gutter's hit area reaches the row's edge: 10px wide before the checkbox.
    const hit = await gutter.evaluate((el) => {
      const rowBox = el.closest('[data-todo-id]')!.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const before = getComputedStyle(el, '::before')
      return { left: box.left - rowBox.left + parseFloat(before.left), width: box.width - parseFloat(before.left) - parseFloat(before.right) }
    })
    expect(hit).toEqual({ left: 0, width: 10 })
    await gutter.click()
    const menu = page.getByRole('menu', { name: 'Priority' })
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Urgent' })).toHaveAttribute('aria-checked', 'true')
    // Open, the flag stays while the pointer is away.
    await page.mouse.move(1000, 790)
    await expect.poll(flagOpacity).toBe('1')
    await menu.getByRole('menuitemcheckbox', { name: 'Important' }).click()
    await expect(ringOf(widget, 'Urgent')).toHaveAttribute('data-priority-ring', 'split')
  })

  test('the row’s type: title 500 (Important’s semibold 600), meta 11.5px tabular in the muted grey; 30px rows', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: [{ title: 'Plain', dueInDays: 9, tags: ['home'] }, { title: 'Important', important: true }], tags: ['home'] })
    const title = (t: string) => widget.locator(`span[data-task-title="${t}"]`)
    await expect(title('Plain')).toBeVisible()
    expect(await title('Plain').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500')
    expect(await title('Important').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600')
    const meta = await row(widget, 'Plain').locator('[data-row-cell="due"]').evaluate((el) => {
      const cs = getComputedStyle(el)
      const muted = getComputedStyle(document.documentElement).getPropertyValue('--color-text-muted').trim()
      return { size: cs.fontSize, numeric: cs.fontVariantNumeric, color: cs.color, muted }
    })
    expect(meta).toMatchObject({ size: '11.5px', numeric: 'tabular-nums' })
    // #8f8a83, the muted grey (rgb(143, 138, 131)).
    expect(meta.muted).toBe('#8f8a83')
    expect(meta.color).toBe('rgb(143, 138, 131)')
    const tagSize = await row(widget, 'Plain').locator('[data-row-cell="tags"]').evaluate((el) => getComputedStyle(el).fontSize)
    expect(tagSize).toBe('11.5px')
    const height = await row(widget, 'Plain').evaluate((el) => el.getBoundingClientRect().height)
    expect(height).toBe(30)
  })

  test('a flat list’s hairline: 1px in the muted border, starting at the title', async ({ page }) => {
    const widget = await seedTaskList(page, { tasks: TASKS })
    const line = await row(widget, 'Plain').evaluate((el) => {
      const after = getComputedStyle(el, '::after')
      const title = el.querySelector('[data-task-title]')!.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      const probe = document.createElement('span')
      probe.style.color = 'var(--color-border-muted)'
      document.body.append(probe)
      const muted = getComputedStyle(probe).color
      probe.remove()
      return { height: after.height, bg: after.backgroundColor, muted, start: box.left + parseFloat(after.left), titleLeft: title.left }
    })
    expect(line.height).toBe('1px')
    expect(line.bg).toBe(line.muted)
    expect(Math.abs(line.start - line.titleLeft)).toBeLessThan(0.5)
  })

  for (const mode of ['dark', 'light'] as const) {
    test(`the ring colours stand out from the surface in the ${mode} theme (≥ 3:1)`, async ({ page }) => {
      const widget = await seedTaskList(page, { tasks: TASKS })
      await expect(ringOf(widget, 'Urgent')).toBeVisible()
      await setTheme(page, mode)
      const contrasts = await ringContrasts(widget)
      expect(Object.keys(contrasts).sort()).toEqual(['important', 'urgent'])
      for (const [part, ratio] of Object.entries(contrasts)) {
        expect(ratio, `${part} ring in ${mode}`).toBeGreaterThanOrEqual(3)
      }
    })
  }
})
