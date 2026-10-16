import { test, expect, type Page } from '@playwright/test'
import { openSettings, seedWorkspace } from './fixtures/workspace'

/**
 * Settings › Data integrity on a corrupt layout: the audit reports it and
 * cleanup repairs it in place (bad parts dropped) — it never deletes a
 * layout, so the active one survives with its good tabs.
 */

/** Rewrites the stored active layout's columns straight in IndexedDB. */
async function corruptActiveLayout(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('todo2')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const tx = idb.transaction(['layouts', 'settings'], 'readwrite')
    const get = <T,>(store: string, key: IDBValidKey) => new Promise<T>((resolve, reject) => {
      const r = tx.objectStore(store).get(key)
      r.onsuccess = () => resolve(r.result as T)
      r.onerror = () => reject(r.error)
    })
    const active = Number((await get<{ value: string }>('settings', 'activeLayoutId')).value)
    const layout = await get<{ columns: Array<{ cells: Array<{ weight: unknown; tabs: unknown[] }> }> }>('layouts', active)
    const cell = layout.columns[0]!.cells[0]!
    cell.weight = -1
    cell.tabs.push({ id: 'retired', kind: 'status', config: {} })
    tx.objectStore('layouts').put(layout)
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    idb.close()
    return active
  })
}

test('the audit repairs a corrupt active layout instead of deleting it', async ({ page }) => {
  await seedWorkspace(page, {
    layouts: [{ name: 'Daily', columns: [{ id: 'c1', weight: 1, cells: [{ id: 'k1', weight: 1, tabs: [{ id: 'n1', kind: 'notes', config: {} }] }] }] }],
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

  const stored = await page.evaluate(async () => {
    const idb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open('todo2')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const rows = await new Promise<unknown[]>((resolve, reject) => {
      const r = idb.transaction('layouts').objectStore('layouts').getAll()
      r.onsuccess = () => resolve(r.result as unknown[])
      r.onerror = () => reject(r.error)
    })
    idb.close()
    return rows
  })
  expect(stored).toEqual([expect.objectContaining({
    id: active,
    name: 'Daily',
    // The size reset to 1, the retired tab gone, the notes tab kept.
    columns: [{ id: 'c1', weight: 1, cells: [expect.objectContaining({ id: 'k1', weight: 1, tabs: [{ id: 'n1', kind: 'notes', config: {} }] })] }],
  })])

  await settings.getByRole('button', { name: 'Run Audit' }).click()
  await expect(settings.getByText('No issues found.')).toBeVisible()
})
