import { test, expect, type Page } from '@playwright/test'
import { openSettings, seedWorkspace } from './fixtures/workspace'
import { readStore, readStores, writeStores } from './fixtures/db'

/**
 * Settings › Data integrity on a corrupt layout: the audit reports it and
 * cleanup repairs it in place (bad parts dropped) — it never deletes a
 * layout, so the active one survives with its good tabs.
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
  await seedWorkspace(page, {
    layouts: [{ name: 'Daily', columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [{ id: 'n1', kind: 'notes' }] }] }] }],
  })
  const active = await corruptActiveLayout(page)
  await page.reload()

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

  await settings.getByRole('button', { name: 'Run Audit' }).click()
  await expect(settings.getByText('No issues found.')).toBeVisible()
})
