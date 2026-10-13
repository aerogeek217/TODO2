import type { Page } from '@playwright/test'

/**
 * The text of the sync file `name` (an OPFS file the specs attach as the
 * app's sync file), read once the app has no write to it running or
 * scheduled (`fileStorageService.whenIdle`).
 *
 * The app saves by swapping in a new file (`createWritable` → `close`). A
 * `File` from `getFile()` is a snapshot, and reading it after the swap fails
 * with `NotFoundError` — so a read racing a save must not happen. Waiting
 * for the app to be idle makes the read see one complete save.
 */
export async function readSyncFile(page: Page, name: string, { create = false } = {}): Promise<string> {
  return page.evaluate(async ({ name, create, serviceUrl }) => {
    const { fileStorageService } = (await import(/* @vite-ignore */ serviceUrl)) as {
      fileStorageService: { whenIdle: () => Promise<void> }
    }
    await fileStorageService.whenIdle()
    const dir = await navigator.storage.getDirectory()
    return (await (await dir.getFileHandle(name, { create })).getFile()).text()
  }, { name, create, serviceUrl: '/src/services/file-storage.ts' })
}
