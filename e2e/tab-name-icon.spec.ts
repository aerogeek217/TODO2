import { expect, test, type Page } from '@playwright/test'
import { WIDGET_KINDS } from '../src/models/workspace-layout'
import { readStore } from './fixtures/db'
import { expectLayoutStep, expectLayoutStored, openCellMenu, seedWorkspace, wsCell, wsRow, wsTab } from './fixtures/workspace'

/**
 * Widget feedback items 11 and 14: every widget tab has Name and icon… in its
 * menu — a name (a list's is its list's) and an icon, a built-in line icon,
 * an emoji (muted by default, or in color) or none —, each change one undo
 * step. The OS emoji panel is simulated by inserting text into the field.
 */

interface StoredTab { id: string; kind: string; name?: string; icon?: unknown }

async function storedTab(page: Page, tabId: string): Promise<StoredTab | undefined> {
  const layouts = await readStore<{ cells: Array<{ tabs: StoredTab[] }> }>(page, 'layouts')
  return layouts.flatMap((l) => l.cells.flatMap((c) => c.tabs)).find((t) => t.id === tabId)
}

/** Opens Name and icon… from cell `cellId`'s ⋯ (for its active tab). */
async function openNameAndIcon(page: Page, cellId: string) {
  await openCellMenu(page, cellId)
  await page.getByRole('menu', { name: 'Cell options' }).getByRole('menuitem', { name: 'Name and icon…' }).click()
  const popover = page.getByRole('dialog', { name: 'Name and icon' })
  await expect(popover).toBeVisible()
  return popover
}

const undo = (page: Page) => page.locator('[data-snackbar-live]').getByRole('button', { name: 'Undo', exact: true }).click()

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('rename a tab, pick a line icon, an emoji, Muted / Color, No icon, Recent, undo', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Inbox' }],
      layouts: [{
        name: 'Main',
        columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }, { id: 'cal', kind: 'calendar' }], activeTabId: 'cal' })] }],
      }],
    })
    const calTab = wsTab(page, 'cal')
    // J1: never given an icon, the tab shows its kind's.
    await expect(calTab.locator('[data-app-icon="line"]')).toBeVisible()

    // The name: written when the popover closes, one undo step.
    let popover = await openNameAndIcon(page, 'k1')
    const name = popover.getByRole('textbox', { name: 'Name' })
    await expect(name).toBeFocused()
    await expect(name).toHaveAttribute('placeholder', 'Calendar')
    await name.fill('Deadlines')
    await name.press('Enter')
    await expect(popover).toHaveCount(0)
    await expect(calTab).toContainText('Deadlines')
    await expectLayoutStep(page, 'Renamed tab to “Deadlines”')
    expect((await storedTab(page, 'cal'))?.name).toBe('Deadlines')

    // A line icon: picked and closed, the focus back on the Icon button.
    popover = await openNameAndIcon(page, 'k1')
    const iconButton = popover.getByRole('button', { name: /^Icon:/ })
    await iconButton.click()
    let picker = page.getByRole('dialog', { name: /^Icon of/ })
    await picker.getByRole('button', { name: 'Flag', exact: true }).click()
    await expect(picker).toHaveCount(0)
    await expect(iconButton).toBeFocused()
    await expectLayoutStep(page, 'Changed icon of “Deadlines”')
    expect((await storedTab(page, 'cal'))?.icon).toEqual({ kind: 'line', key: 'flag' })

    // An emoji from the OS panel (the panel types into the focused field), with its search letters left behind.
    await iconButton.click()
    picker = page.getByRole('dialog', { name: /^Icon of/ })
    await picker.getByRole('tab', { name: 'Emoji' }).click()
    const field = picker.getByRole('textbox', { name: 'Emoji' })
    await expect(field).toBeFocused()
    await expect(field).toHaveAttribute('placeholder', /pick an emoji, or paste one|Paste an emoji/)
    await page.keyboard.insertText('fire🔥')
    await expect(field).toHaveValue('')
    await expect.poll(async () => (await storedTab(page, 'cal'))?.icon).toEqual({ kind: 'emoji', emoji: '🔥' })
    // Muted by default: one color, tinted (the active tab's accent) through its SVG filter.
    await expect(calTab.locator('[data-app-icon="emoji-muted"] filter')).toHaveCount(1)
    await expect(calTab.locator('[data-app-icon="emoji-muted"]')).toContainText('🔥')
    // Color: its own colors, no filter.
    await picker.getByRole('radio', { name: 'Color' }).click()
    await expect(calTab.locator('[data-app-icon="emoji-color"]')).toBeVisible()
    await expect(calTab.locator('[data-app-icon="emoji-color"] filter')).toHaveCount(0)
    await expect.poll(async () => (await storedTab(page, 'cal'))?.icon).toEqual({ kind: 'emoji', emoji: '🔥', show: 'color' })
    // Not an emoji: refused, nothing written.
    await page.keyboard.insertText('hello')
    await field.press('Enter')
    await expect(picker.getByRole('alert')).toContainText('That isn’t an emoji')
    // Recent: the emoji used in the app.
    await expect(picker.getByRole('button', { name: 'Emoji 🔥' })).toBeVisible()
    // Esc closes the picker only; the next Esc the popover.
    await page.keyboard.press('Escape')
    await expect(picker).toHaveCount(0)
    await expect(popover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    // No icon: stored explicitly; the strip shows none.
    popover = await openNameAndIcon(page, 'k1')
    await popover.getByRole('button', { name: /^Icon:/ }).click()
    await page.getByRole('dialog', { name: /^Icon of/ }).getByRole('button', { name: 'No icon' }).click()
    await expect.poll(async () => (await storedTab(page, 'cal'))?.icon).toEqual({ kind: 'none' })
    await expect(calTab.locator('[data-tab-icon]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)

    // Undo puts back the color emoji.
    await undo(page)
    await expect(calTab.locator('[data-app-icon="emoji-color"]')).toBeVisible()
    await expectLayoutStored(page)
    expect((await storedTab(page, 'cal'))?.icon).toEqual({ kind: 'emoji', emoji: '🔥', show: 'color' })
  })

  test('a list tab’s name is its list’s', async ({ page }) => {
    await seedWorkspace(page, {
      listDefinitions: [{ name: 'Inbox' }],
      layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'list', kind: 'lens', listDefIdx: 0 }, { id: 'n', kind: 'notes' }], activeTabId: 'list' })] }] }],
    })
    const popover = await openNameAndIcon(page, 'k1')
    await expect(popover).toContainText('This tab shows a list, so the name is the list’s name.')
    await popover.getByRole('textbox', { name: 'Name' }).fill('This week')
    await page.mouse.click(1000, 600)
    await expect(popover).toHaveCount(0)
    await expect(wsTab(page, 'list')).toContainText('This week')
    await expect.poll(async () => (await readStore<{ name: string }>(page, 'listDefinitions')).map((d) => d.name)).toContain('This week')
    expect((await storedTab(page, 'list'))?.name).toBeUndefined()
  })

  test('alone in its cell, a picked icon leads the top line (J2); one never picked shows none', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{ name: 'Main', columns: [
        { id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'n', kind: 'notes' }] })] },
        { id: 'c2', rows: [wsRow({ id: 'k2', tabs: [{ id: 'n2', kind: 'notes' }] })] },
      ] }],
    })
    const line = wsTab(page, 'n')
    await expect(line).toContainText('Notes')
    await expect(line.locator('[data-app-icon]')).toHaveCount(0)
    const popover = await openNameAndIcon(page, 'k1')
    await popover.getByRole('textbox', { name: 'Name' }).fill('Scratch')
    await popover.getByRole('button', { name: /^Icon:/ }).click()
    const picker = page.getByRole('dialog', { name: /^Icon of/ })
    await picker.getByRole('tab', { name: 'Emoji' }).click()
    await page.keyboard.insertText('📝')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(popover).toHaveCount(0)
    await expect(line).toContainText('Scratch')
    await expect(line.locator('[data-app-icon="emoji-muted"]')).toContainText('📝')
    // The other Notes cell is untouched.
    await expect(wsTab(page, 'n2').locator('[data-app-icon]')).toHaveCount(0)
  })

  test('the “More tabs” overflow menu shows the tab’s name and icon', async ({ page }) => {
    const tabs = [
      ...WIDGET_KINDS.filter((k) => k !== 'lens').map((kind, i) => ({ id: `t${i}`, kind })),
    ]
    await seedWorkspace(page, {
      layouts: [{ name: 'Main', columns: [
        { id: 'c1', weight: 1, rows: [wsRow({ id: 'k1', tabs, activeTabId: 't0' })] },
        { id: 'c2', weight: 4, rows: [wsRow({ id: 'k2', tabs: [{ id: 'n', kind: 'notes' }] })] },
      ] }],
    })
    // Name and icon the last tab (folded into +N) through the store, as the popover does.
    const last = tabs.at(-1)!.id
    await page.evaluate(async (id) => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/workspace-store.ts' as string)) as {
        useWorkspaceStore: { getState: () => { renameTab: (id: string, n: string) => Promise<boolean>; setTabIcon: (id: string, icon: unknown) => boolean } }
      }
      await mod.useWorkspaceStore.getState().renameTab(id, 'Slipping tasks')
      mod.useWorkspaceStore.getState().setTabIcon(id, { kind: 'emoji', emoji: '🧭' })
    }, last)
    await wsCell(page, 'k1').getByRole('button', { name: /more tabs$/ }).click()
    const item = page.getByRole('menu', { name: 'More tabs' }).getByRole('menuitem', { name: 'Slipping tasks' })
    await expect(item).toBeVisible()
    await expect(item.locator('[data-app-icon="emoji-muted"]')).toContainText('🧭')
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })

  test('shows a tab’s name and icon', async ({ page }) => {
    await seedWorkspace(page, {
      layouts: [{ name: 'Main', columns: [{ id: 'c1', rows: [wsRow({ id: 'k1', tabs: [{ id: 'cal', kind: 'calendar' }, { id: 'n', kind: 'notes' }], activeTabId: 'n' })] }] }],
    })
    await page.evaluate(async () => {
      const mod = (await import(/* @vite-ignore */ '/src/stores/workspace-store.ts' as string)) as {
        useWorkspaceStore: { getState: () => { renameTab: (id: string, n: string) => Promise<boolean>; setTabIcon: (id: string, icon: unknown) => boolean } }
      }
      await mod.useWorkspaceStore.getState().renameTab('cal', 'Deadlines')
      mod.useWorkspaceStore.getState().setTabIcon('cal', { kind: 'emoji', emoji: '📅', show: 'color' })
    })
    const tab = page.getByRole('tab', { name: /Deadlines/ })
    await expect(tab).toBeVisible()
    await expect(tab.locator('[data-app-icon="emoji-color"]')).toContainText('📅')
  })
})
