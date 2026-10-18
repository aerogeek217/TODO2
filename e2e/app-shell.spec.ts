import { expect, test, type Page } from '@playwright/test'
import { openSettings, seedWorkspace, wsListWidget, type WorkspaceSeed } from './fixtures/workspace'

/**
 * The app shell in a real browser: one top bar (New task, layout picker,
 * the screen-filter tray, the storage pill, the Settings gear), the Settings
 * modal, and the narrow-window Filters menu. The unsaved-layout case (Settings
 * never prompts) lives in `workspace-layout.spec.ts`; the storage pill's
 * warning states in `storage-pill.spec.ts`.
 */

const team: WorkspaceSeed = {
  people: ['Alice', 'Bob'],
  tags: ['q4'],
  listDefinitions: [{ name: 'Team' }],
  tasks: [
    { title: 'Alice task', people: ['Alice'] },
    { title: 'Bob task', people: ['Bob'], tags: ['q4'] },
  ],
  layouts: [
    { name: 'Main', columns: [{ id: 'c1', cells: [{ id: 'k1', tabs: [{ id: 't1', kind: 'lens', listDefIdx: 0 }] }] }] },
  ],
}

const tray = (page: Page) => page.getByRole('group', { name: 'Screen filters — apply to every widget' })
const rows = (page: Page) => wsListWidget(page, 't1').locator('[data-todo-id]')

test('the gear opens Settings over the workspace; Esc closes it', async ({ page }) => {
  await seedWorkspace(page, team)
  await expect(page.getByRole('button', { name: /theme/i })).toHaveCount(0)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings).toBeVisible()
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Appearance')
  await expect(settings.getByRole('radiogroup', { name: 'Theme' })).toBeVisible()
  await expect(page).toHaveURL(/#\/$/)

  await settings.getByRole('button', { name: 'Database', exact: true }).click()
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.locator('[data-ws-area]')).toBeVisible()

  // Reopens on the last section viewed; G then S opens it too.
  await page.keyboard.press('g')
  await page.keyboard.press('s')
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  await settings.getByRole('button', { name: 'Close settings' }).click()
  await expect(settings).toBeHidden()
})

test('an editor opened from Settings stacks over it and owns Esc', async ({ page }) => {
  await seedWorkspace(page, team)
  const settings = await openSettings(page, 'People, statuses & tags')
  await settings.getByRole('button', { name: 'Manage people…' }).click()
  await expect(page.getByText('Alice', { exact: true }).first()).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeVisible()
})

test('the filter tray turns red while a screen filter is on', async ({ page }) => {
  await seedWorkspace(page, team)
  const funnel = tray(page).getByRole('button', { name: 'Clear all filters' })
  const funnelColor = () => funnel.evaluate((el) => getComputedStyle(el).color)
  const danger = await page.evaluate(() => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--color-danger)'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    probe.remove()
    return c
  })
  const restShadow = await tray(page).evaluate((el) => getComputedStyle(el).boxShadow)
  expect(await funnelColor()).not.toBe(danger)

  await page.getByRole('button', { name: 'People filter' }).click()
  await page.locator('label', { hasText: '@Alice' }).click()
  await page.keyboard.press('Escape')
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')
  await expect(page.getByRole('button', { name: 'People filter: Alice' })).toBeVisible()
  await expect(rows(page)).toHaveCount(1)
  expect(await tray(page).evaluate((el) => getComputedStyle(el).boxShadow)).not.toBe(restShadow)
  expect(await funnelColor()).toBe(danger)

  // The × clears just that filter.
  await page.getByRole('button', { name: 'Clear people filter' }).click()
  await expect(tray(page)).not.toHaveAttribute('data-filtered')
  await expect(rows(page)).toHaveCount(2)
})

test('the red funnel, left of search, clears every screen filter at once; there is no Clear all text', async ({ page }) => {
  await seedWorkspace(page, team)
  const funnel = tray(page).getByRole('button', { name: 'Clear all filters' })
  const search = tray(page).getByRole('textbox', { name: 'Search tasks' })
  await expect(funnel).toBeDisabled()
  const funnelBox = await funnel.boundingBox()
  const searchBox = await search.boundingBox()
  expect(funnelBox && searchBox && funnelBox.x + funnelBox.width <= searchBox.x).toBe(true)

  await page.getByRole('button', { name: 'People filter' }).click()
  await page.locator('label', { hasText: '@Alice' }).click()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Show completed' }).click()
  await search.fill('a')
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')
  await expect(tray(page).getByText('Clear all', { exact: true })).toHaveCount(0)

  await funnel.hover()
  await expect(page.getByRole('tooltip')).toHaveText(/Clear all filters/)
  await funnel.click()
  await expect(tray(page)).not.toHaveAttribute('data-filtered')
  await expect(search).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Show completed' })).toHaveAttribute('aria-pressed', 'false')
  await expect(rows(page)).toHaveCount(2)
  await expect(funnel).toBeDisabled()
})

test('at 1180px the filters fold into a Filters menu that sets and clears a filter', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 800 })
  await seedWorkspace(page, team)
  await expect(page.getByRole('button', { name: 'People filter' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Show completed' })).toHaveText('Completed')
  const box = await page.locator('header').boundingBox()
  expect(box?.height).toBe(40)

  const filters = page.getByRole('button', { name: 'Filters', exact: true })
  await filters.click()
  const menu = page.getByRole('group', { name: 'Screen filters', exact: true })
  await expect(menu).toContainText('Screen filters · apply to every widget')
  await menu.getByRole('button', { name: 'Tags filter' }).click()
  await page.locator('label', { hasText: '#q4' }).click()
  await expect(rows(page)).toHaveCount(1)
  await expect(menu.getByRole('button', { name: 'Tags filter: q4' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Filters, 1 active' })).toBeVisible()
  await expect(tray(page)).toHaveAttribute('data-filtered', 'true')

  await menu.getByRole('button', { name: 'Clear tags filter' }).click()
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Filters', exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
})

test('the storage pill’s popover opens Settings on Database, at File storage', async ({ page }) => {
  await seedWorkspace(page, team)
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'local')
  await expect(pill).toHaveText('Local only')
  await pill.click()
  const popover = page.getByRole('dialog', { name: 'Stored in this browser only' })
  await expect(popover).toBeVisible()
  await popover.getByRole('button', { name: 'Set up file storage…' }).click()
  await expect(popover).toBeHidden()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  await expect(settings.getByRole('heading', { level: 3 })).toHaveText(['Import / Export', 'Data integrity', 'File storage', 'Backups'])
  await expect(settings.getByRole('heading', { level: 3, name: 'File storage' })).toBeInViewport()
  await expect(settings.getByRole('button', { name: 'Attach to File' })).toBeInViewport()
  // The old "stored locally" strip is gone.
  await expect(page.getByText('Your data is stored locally')).toHaveCount(0)
})

test('without file sync, the pill’s Import / Export… opens Database scrolled to that part', async ({ page }) => {
  await page.addInitScript(() => {
    delete (Window.prototype as unknown as Record<string, unknown>).showOpenFilePicker
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker
  })
  await seedWorkspace(page, team)
  await page.getByTestId('storage-pill').click()
  await page.getByRole('button', { name: 'Import / Export…' }).click()
  const settings = page.getByRole('dialog', { name: 'Settings' })
  await expect(settings.getByRole('heading', { level: 2 })).toHaveText('Database')
  const part = settings.getByRole('heading', { level: 3, name: 'Import / Export' })
  await expect(part).toBeInViewport()
  // The content scrolled to it: as far as it goes, or until the part is at the top.
  const scroll = await part.evaluate((h) => {
    const content = h.closest('section[aria-labelledby]')?.parentElement?.closest('section') as HTMLElement
    return {
      top: content.scrollTop,
      max: content.scrollHeight - content.clientHeight,
      offset: h.getBoundingClientRect().top - content.getBoundingClientRect().top,
    }
  })
  expect(scroll.top).toBeGreaterThan(0)
  expect(scroll.top >= scroll.max - 1 || scroll.offset < 40).toBe(true)
})

test('New task opens quick add', async ({ page }) => {
  await seedWorkspace(page, team)
  await page.getByRole('button', { name: 'New task' }).click()
  await expect(page.getByRole('dialog', { name: 'Quick add task' })).toBeVisible()
})
