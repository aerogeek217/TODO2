import { expect, test, type Locator, type Page } from '@playwright/test'
import { readStore } from './fixtures/db'
import { taskRowByTitle } from './fixtures/seed'
import { openSettings, seedWorkspace, wsRow, type WorkspaceSeed } from './fixtures/workspace'

/**
 * A priority's own color (Settings › Appearance › Theme colors: Focus /
 * Urgent / Important priority), in a real browser and in both themes (cr34):
 * - U5 · the task editor's pressed priority toggle is the priority's color on
 *   the priority's own tint — with no color of its own, the tint it always had;
 * - U6 · a typed `/focus` token's text is Focus's color as the theme draws a
 *   color as text: darkened in the light theme, as an accent override is;
 * - answer 18 · a row's Reset removes that one override: the priority follows
 *   Danger / Follow up / the accent again, the other overrides stay.
 */

const BLUE = '#3b82f6'
const VIOLET = '#9b5de5'
const GREEN = '#2e9e5b'
const THEMES = ['dark', 'light'] as const
type Theme = typeof THEMES[number]

const seed = (theme: Theme, colors: Record<string, string> = {}): WorkspaceSeed => ({
  settings: { themeMode: theme, ...Object.fromEntries(Object.entries(colors).map(([name, value]) => [`color.${theme}.${name}`, value])) },
  tasks: [{ title: 'Flagged task', urgent: true, important: true, focus: true }],
  listDefinitions: [{ name: 'All', grouping: 'none', sort: 'manual' }],
  layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'l1', kind: 'lens', listDefIdx: 0 }] })] }] }],
})

/** The computed `property` an element with `value` for it gets in the page (a probe in the theme root). */
async function computedOf(page: Page, property: 'color' | 'background-color', value: string): Promise<string> {
  return page.evaluate(([prop, v]) => {
    const probe = document.createElement('span')
    probe.style.setProperty(prop!, v!)
    document.body.appendChild(probe)
    const out = getComputedStyle(probe).getPropertyValue(prop!)
    probe.remove()
    return out
  }, [property, value])
}

const css = (el: Locator, property: string) => el.evaluate((node, prop) => getComputedStyle(node).getPropertyValue(prop), property)
const rootVar = (page: Page, name: string) => page.evaluate((n) => document.documentElement.style.getPropertyValue(n), name)

async function openEditor(page: Page): Promise<Locator> {
  await taskRowByTitle(page, 'Flagged task').locator('span[data-task-title="Flagged task"]').dblclick()
  const dialog = page.getByRole('dialog', { name: 'Edit task' })
  await expect(dialog).toBeVisible()
  await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)))
  return dialog
}

const toggle = (dialog: Locator, name: string) => dialog.locator('[data-fact="priority"]').getByRole('button', { name, exact: true })

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.use({ viewport: { width: 1280, height: 860 } })

    test('U5 · a pressed priority toggle with its own color: that color on its own tint', async ({ page }) => {
      await seedWorkspace(page, seed(theme, { focus: VIOLET, urgent: BLUE, important: GREEN }))
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const dialog = await openEditor(page)
      for (const [name, color] of [['Focus', VIOLET], ['Urgent', BLUE], ['Important', GREEN]] as const) {
        const button = toggle(dialog, name)
        await expect(button).toHaveAttribute('aria-pressed', 'true')
        expect(await css(button, 'color'), `${name} text`).toBe(await computedOf(page, 'color', color))
        expect(await css(button, 'background-color'), `${name} fill`).toBe(await computedOf(page, 'background-color', `color-mix(in srgb, ${color} 12%, transparent)`))
      }
      // Not the tints of the colors they follow by default (blue text on a red tint, the finding).
      expect(await css(toggle(dialog, 'Urgent'), 'background-color')).not.toBe(await computedOf(page, 'background-color', 'var(--color-danger-bg)'))
      expect(await css(toggle(dialog, 'Important'), 'background-color')).not.toBe(await computedOf(page, 'background-color', 'var(--color-followup-bg)'))
      expect(await css(toggle(dialog, 'Focus'), 'background-color')).not.toBe(await computedOf(page, 'background-color', 'var(--color-accent-bg-medium)'))
      await dialog.locator('[data-fact="priority"]').screenshot({ path: test.info().outputPath(`toggles-own-${theme}.png`) })
    })

    test('U5 · with no color of its own, each pressed toggle keeps the tint it had', async ({ page }) => {
      await seedWorkspace(page, seed(theme))
      const dialog = await openEditor(page)
      for (const [name, text, fill] of [
        ['Focus', 'var(--color-accent)', 'var(--color-accent-bg-medium)'],
        ['Urgent', 'var(--color-danger)', 'var(--color-danger-bg)'],
        ['Important', 'var(--color-followup)', 'var(--color-followup-bg)'],
      ] as const) {
        expect(await css(toggle(dialog, name), 'color'), `${name} text`).toBe(await computedOf(page, 'color', text))
        expect(await css(toggle(dialog, name), 'background-color'), `${name} fill`).toBe(await computedOf(page, 'background-color', fill))
      }
      await dialog.locator('[data-fact="priority"]').screenshot({ path: test.info().outputPath(`toggles-default-${theme}.png`) })
    })

    test('U6 · the typed /focus token’s text: Focus’s own color as the theme draws a color as text', async ({ page }) => {
      await seedWorkspace(page, seed(theme, { focus: BLUE }))
      await page.keyboard.press('Control+Space')
      const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
      await quickAdd.getByPlaceholder('New task…').fill('Plan /focus')
      const token = quickAdd.locator('span[data-tint="focus"]').filter({ hasText: '/focus' }).first()
      await expect(token).toBeVisible()
      // Dark: the color as picked. Light: darkened, as the default accent text is (76% of it over black).
      const expected = theme === 'light' ? `color-mix(in srgb, ${BLUE} 76%, black)` : BLUE
      expect(await css(token, 'color')).toBe(await computedOf(page, 'color', expected))
      if (theme === 'light') expect(await css(token, 'color')).not.toBe(await computedOf(page, 'color', BLUE))
      expect(await css(token, 'background-color')).toBe(await computedOf(page, 'background-color', `color-mix(in srgb, ${BLUE} 12%, transparent)`))
      await quickAdd.screenshot({ path: test.info().outputPath(`focus-token-own-${theme}.png`) })
    })

    test('U6 · with no color of its own the token’s text is the accent’s text color, as before', async ({ page }) => {
      await seedWorkspace(page, seed(theme))
      await page.keyboard.press('Control+Space')
      const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
      await quickAdd.getByPlaceholder('New task…').fill('Plan /focus')
      const token = quickAdd.locator('span[data-tint="focus"]').filter({ hasText: '/focus' }).first()
      await expect(token).toBeVisible()
      expect(await css(token, 'color')).toBe(await computedOf(page, 'color', 'var(--color-accent-text)'))
      // Light: the theme's own accent text teal; dark: the accent itself.
      const shown = theme === 'light' ? '#24756d' : 'var(--color-accent)'
      expect(await css(token, 'color')).toBe(await computedOf(page, 'color', shown))
    })

    test('answer 18 · a row’s Reset removes that one override; the priority follows its color again', async ({ page }) => {
      await seedWorkspace(page, seed(theme, { danger: VIOLET, urgent: BLUE, focus: GREEN }))
      const settings = await openSettings(page, 'Appearance')
      await settings.getByRole('button', { name: 'Customize colors…' }).click()
      const editor = page.getByRole('dialog').filter({ hasText: `Theme Colors — ${theme === 'dark' ? 'Dark' : 'Light'}` })
      await expect(editor).toBeVisible()
      const swatch = (label: string) => editor.locator(`input[type="color"][aria-label="${label}"]`)
      const reset = (label: string) => editor.getByRole('button', { name: `Reset ${label}`, exact: true })

      // Only the rows with a color of their own have a Reset.
      await expect(editor.getByRole('button', { name: /^Reset .+ priority$|^Reset (Accent|Danger accent|Surface|Border|Header|App background|Warning accent|Follow up|Due date)$/ })).toHaveCount(3)
      await expect(reset('Urgent priority')).toBeVisible()
      await expect(reset('Danger accent')).toBeVisible()
      await expect(reset('Focus priority')).toBeVisible()
      await expect(reset('Important priority')).toHaveCount(0)
      await expect(swatch('Urgent priority')).toHaveValue(BLUE)
      // The Reset sits in its row, between the label and the swatch, and doesn't move the swatch column.
      const [withReset, without] = [await swatch('Urgent priority').boundingBox(), await swatch('Important priority').boundingBox()]
      expect(Math.abs(withReset!.x - without!.x)).toBeLessThan(1)
      const resetBox = await reset('Urgent priority').boundingBox()
      expect(resetBox!.x + resetBox!.width).toBeLessThanOrEqual(withReset!.x)
      await editor.screenshot({ path: test.info().outputPath(`theme-colors-reset-${theme}.png`) })

      await reset('Urgent priority').click()
      await expect(reset('Urgent priority')).toHaveCount(0)
      // Urgent follows Danger again — Danger's own override included.
      await expect(swatch('Urgent priority')).toHaveValue(VIOLET)
      await expect(swatch('Urgent priority')).toBeFocused()
      expect(await rootVar(page, '--color-marker-urgent')).toBe('')
      expect(await rootVar(page, '--color-marker-urgent-bg')).toBe('')
      expect(await computedOf(page, 'color', 'var(--color-marker-urgent)')).toBe(await computedOf(page, 'color', VIOLET))
      // The other overrides stay, on the page and in storage.
      await expect(swatch('Danger accent')).toHaveValue(VIOLET)
      await expect(swatch('Focus priority')).toHaveValue(GREEN)
      expect(await rootVar(page, '--color-marker-focus')).toBe(GREEN)
      await expect.poll(async () => (await readStore<{ key: string; value: string }>(page, 'settings'))
        .filter((r) => r.key.startsWith('color.')).map((r) => `${r.key}=${r.value}`).sort())
        .toEqual([`color.${theme}.danger=${VIOLET}`, `color.${theme}.focus=${GREEN}`])
      await editor.screenshot({ path: test.info().outputPath(`theme-colors-after-reset-${theme}.png`) })

      // And after a reload.
      await page.reload()
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await expect.poll(() => rootVar(page, '--color-marker-focus')).toBe(GREEN)
      expect(await rootVar(page, '--color-marker-urgent')).toBe('')
    })
  })
}
