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

/** What the stubbed browser answers when the app asks for access to the file. */
export type PermissionAnswer = 'granted' | 'denied' | 'hold'

type PermissionWindow = Window & {
  __e2ePermissionAnswer?: PermissionAnswer
  __e2ePermissionRequests?: number
  __e2eAnswerPermission?: (answer: 'granted' | 'denied') => void
}

/**
 * Makes file handles behave as after a browser restart: `queryPermission`
 * reports `prompt` until the app's `requestPermission` is granted (then
 * `granted` for the rest of this tab's session — a reload keeps it, a new
 * context starts over). `requestPermission` answers `granted` unless
 * `setPermissionAnswer` said otherwise (`hold`: until `answerPermission`).
 * OPFS handles otherwise always report `granted`.
 */
export async function stubFilePermission(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const KEY = 'e2e-file-permission'
    const w = window as PermissionWindow
    const settle = (answer: 'granted' | 'denied') => {
      if (answer === 'granted') sessionStorage.setItem(KEY, 'granted')
      return answer
    }
    const proto = FileSystemFileHandle.prototype as unknown as {
      queryPermission: () => Promise<PermissionState>
      requestPermission: () => Promise<PermissionState>
    }
    proto.queryPermission = async () => (sessionStorage.getItem(KEY) === 'granted' ? 'granted' : 'prompt')
    proto.requestPermission = () => {
      w.__e2ePermissionRequests = (w.__e2ePermissionRequests ?? 0) + 1
      const mode = w.__e2ePermissionAnswer ?? 'granted'
      if (mode === 'hold') return new Promise((resolve) => { w.__e2eAnswerPermission = (a) => resolve(settle(a)) })
      return Promise.resolve(settle(mode))
    }
  })
}

/** The stubbed browser's next answer(s) to a permission request. */
export async function setPermissionAnswer(page: Page, answer: PermissionAnswer): Promise<void> {
  await page.evaluate((a) => { (window as PermissionWindow).__e2ePermissionAnswer = a }, answer)
}

/** Answers a request held by `setPermissionAnswer(page, 'hold')`. */
export async function answerPermission(page: Page, answer: 'granted' | 'denied'): Promise<void> {
  await page.waitForFunction(() => (window as PermissionWindow).__e2eAnswerPermission != null)
  await page.evaluate((a) => { (window as PermissionWindow).__e2eAnswerPermission?.(a) }, answer)
}

/**
 * Writes `text` to the OPFS file `name` and stores its handle where the app
 * keeps its sync file's handle — attached, as after an earlier session.
 */
export async function attachSyncHandle(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(async ({ name, text }) => {
    const done = (req: IDBRequest | IDBTransaction) => new Promise<void>((resolve, reject) => {
      if (req instanceof IDBTransaction) { req.oncomplete = () => resolve(); req.onerror = () => reject(req.error) } else { req.onsuccess = () => resolve(); req.onerror = () => reject(req.error) }
    })
    const dir = await navigator.storage.getDirectory()
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(text)
    await writable.close()
    const meta = indexedDB.open('todo2-meta', 1)
    meta.onupgradeneeded = () => { meta.result.createObjectStore('handles') }
    await done(meta)
    const tx = meta.result.transaction('handles', 'readwrite')
    tx.objectStore('handles').put(handle, 'todo2-primary')
    await done(tx)
    meta.result.close()
  }, { name, text })
}
