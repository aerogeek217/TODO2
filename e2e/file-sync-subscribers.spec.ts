import { expect, test, type Page } from '@playwright/test'
import { gotoSettingsDeepLink, openSettings } from './fixtures/workspace'
import { readSyncFile } from './fixtures/sync-file'

/**
 * The sync service's events in a real browser: another subscriber to the
 * status and import events doesn't take them from the app — the storage
 * pill and the stores keep following the sync while the extra subscriber
 * hears every event too, and stops hearing once it unsubscribes. The file
 * is a real OPFS handle behind a stubbed picker (as in
 * `file-sync-conflict.spec.ts`), so everything after the picker is the
 * production path.
 */

const SYNC_FILE = 'e2e-subscribers.json'
const SERVICE_URL = '/src/services/file-storage.ts'

type Recorder = Window & {
  __syncEvents?: string[]
  __unsubscribeSync?: () => void
}

async function stubPicker(page: Page) {
  await page.addInitScript((name) => {
    const pick = async () => {
      const dir = await navigator.storage.getDirectory()
      return [await dir.getFileHandle(name, { create: true })]
    }
    Object.defineProperty(window, 'showOpenFilePicker', { value: pick, configurable: true })
  }, SYNC_FILE)
}

/** Subscribes a second listener to the status and import events (the app's module instance). */
async function subscribeRecorder(page: Page) {
  await page.evaluate(async (url) => {
    type Svc = {
      onStatusChange: (l: (s: { fileName: string | null; isConnected: boolean }) => void) => () => void
      onBeforeImport: (l: () => Promise<() => void>) => () => void
      onAfterImport: (l: () => Promise<void>) => () => void
    }
    const { fileStorageService } = (await import(/* @vite-ignore */ url)) as { fileStorageService: Svc }
    const w = window as Recorder
    w.__syncEvents = []
    const offs = [
      fileStorageService.onStatusChange((s) => { w.__syncEvents!.push(`status ${s.fileName ?? '-'} ${s.isConnected}`) }),
      fileStorageService.onBeforeImport(async () => {
        w.__syncEvents!.push('before import')
        return () => { w.__syncEvents!.push('released') }
      }),
      fileStorageService.onAfterImport(async () => { w.__syncEvents!.push('after import') }),
    ]
    w.__unsubscribeSync = () => { for (const off of offs) off() }
  }, SERVICE_URL)
}

const recorded = (page: Page) => page.evaluate(() => (window as Recorder).__syncEvents ?? [])

test('another subscriber hears the sync events without taking them from the app', async ({ page }) => {
  await stubPicker(page)
  await page.goto('/')
  await page.locator('[data-ws-area]').waitFor({ state: 'visible' })
  // An empty file: attaching it writes this browser's data into it.
  await page.evaluate(async (name) => {
    const dir = await navigator.storage.getDirectory()
    const fh = await dir.getFileHandle(name, { create: true })
    const w = await fh.createWritable()
    await w.write('')
    await w.close()
  }, SYNC_FILE)
  await subscribeRecorder(page)

  // Attach the (empty) file: the browser data is written into it and sync starts.
  await gotoSettingsDeepLink(page)
  await (await openSettings(page, 'File storage')).getByRole('button', { name: 'Attach to File' }).click()
  const pill = page.getByTestId('storage-pill')
  await expect(pill).toHaveAttribute('data-state', 'syncing')
  await expect(pill).toHaveText(SYNC_FILE)
  await expect.poll(() => recorded(page)).toContain(`status ${SYNC_FILE} true`)

  // Retry re-runs the load: the file now matches this browser, so it is
  // loaded back — both import events reach the extra subscriber, in order,
  // and the app's own reload still runs (the pill stays on the file).
  const before = (await recorded(page)).length
  await page.evaluate(async (url) => {
    const { fileStorageService } = (await import(/* @vite-ignore */ url)) as { fileStorageService: { retry: () => Promise<void> } }
    await fileStorageService.retry()
  }, SERVICE_URL)
  await expect.poll(async () => (await recorded(page)).slice(before).filter((e) => !e.startsWith('status')))
    .toEqual(['before import', 'after import', 'released'])
  await expect(pill).toHaveText(SYNC_FILE)
  expect(JSON.parse(await readSyncFile(page, SYNC_FILE)).todos).toEqual([])

  // Unsubscribed: it hears nothing more, while an edit still reaches the file.
  await page.evaluate(() => (window as Recorder).__unsubscribeSync?.())
  const after = (await recorded(page)).length
  await page.keyboard.press('Escape') // close Settings
  await page.keyboard.press('Control+Space')
  const quickAdd = page.getByRole('dialog', { name: 'Quick add task' })
  await quickAdd.getByPlaceholder('New task…').fill('Saved after unsubscribing')
  await page.keyboard.press('Enter')
  await expect.poll(async () => (JSON.parse(await readSyncFile(page, SYNC_FILE)).todos as Array<{ title: string }>).map((t) => t.title))
    .toEqual(['Saved after unsubscribing'])
  await expect(pill).toHaveText(SYNC_FILE)
  expect(await recorded(page)).toHaveLength(after)
})
