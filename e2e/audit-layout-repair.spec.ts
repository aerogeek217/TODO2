import { test, expect, type Page } from '@playwright/test'
import { openSettings, seedWorkspace } from './fixtures/workspace'
import { readStore, readStores, writeStores } from './fixtures/db'

/**
 * A corrupt stored layout: the workspace opens it repaired in memory (bad
 * parts dropped, unsaved, a notice) instead of crashing; Settings › Data
 * integrity reports it and cleanup repairs the stored row in place — it never
 * deletes a layout, so the active one survives with its good tabs.
 */

interface StoredLayout { id: number; columns: Array<{ cells: Array<{ weight: unknown; tabs: unknown[] }> }> }

/** Rewrites the stored active layout's columns straight in IndexedDB. */
async function corruptActiveLayout(page: Page): Promise<number> {
  const { layouts, settings } = await readStores(page, ['layouts', 'settings'])
  const active = Number(settings?.find((s) => s.key === 'activeLayoutId')?.value)
  const layout = (layouts as unknown as StoredLayout[] | undefined)?.find((l) => l.id === active)
  const cell = layout?.columns[0]?.cells[0]
  if (!layout || !cell) throw new Error('no active layout')
  cell.weight = -1
  cell.tabs.push({ id: 'retired', kind: 'status', config: {} })
  await writeStores(page, { put: { layouts: [layout] } })
  return active
}

test('the audit repairs a corrupt active layout instead of deleting it', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(e.message))
  await seedWorkspace(page, {
    layouts: [{ name: 'Daily', columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [{ id: 'n1', kind: 'notes' }] }] }] }],
  })
  const active = await corruptActiveLayout(page)
  await page.reload()

  // Opened repaired in memory: the notes tab renders (no error boundary), the
  // retired tab is gone, the layout is unsaved and the snackbar says why.
  await expect(page.getByRole('region', { name: 'Notes cell' })).toBeVisible()
  await expect(page.locator('[data-ws-tab]')).toHaveCount(1)
  await expect(page.getByText('Repaired layout "Daily" — size reset, tab dropped. Save it to keep the repair.')).toBeVisible()
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Save layout (unsaved changes)')
  expect(errors.filter((e) => e.includes('ErrorBoundary') || e.includes("reading 'label'"))).toEqual([])

  const settings = await openSettings(page, 'Data integrity')
  await settings.getByRole('button', { name: 'Run Audit' }).click()
  const issue = settings.getByRole('button', { name: /offending records: Rows in "layouts" that the current schema cannot read/ })
  await expect(issue).toContainText('1')
  await issue.click()
  await expect(page.getByText('Cleanup: size reset, tab dropped')).toBeVisible()
  await page.keyboard.press('Escape')

  await settings.getByRole('button', { name: 'Clean Up 1 Issue' }).click()
  await expect(settings.getByText('Cleaned up 1 orphaned record.')).toBeVisible()

  expect(await readStore(page, 'layouts')).toEqual([expect.objectContaining({
    id: active,
    name: 'Daily',
    // The size reset to 1, the retired tab gone, the notes tab kept.
    columns: [{ id: 'c1', weight: 1, cells: [expect.objectContaining({ id: 'k1', weight: 1, tabs: [{ id: 'n1', kind: 'notes', config: {} }] })] }],
  })])

  // The workspace reloaded the repaired row: nothing left unsaved.
  await expect(page.getByTestId('layout-save')).toHaveAccessibleName('Layout saved')

  await settings.getByRole('button', { name: 'Run Audit' }).click()
  await expect(settings.getByText('No issues found.')).toBeVisible()
})
