import { loadLastPickerHandle, saveLastPickerHandle } from './file-handle-idb'
import { getSaveFilePicker } from '../utils/file-picker'
import { OBJECT_URL_REVOKE_MS } from '../constants'

/** Picker `startIn`: the last folder the user picked, else Documents. */
export async function getPickerStartIn(): Promise<FileSystemHandle | 'documents'> {
  try {
    const saved = await loadLastPickerHandle()
    if (saved) return saved
  } catch { /* ignore */ }
  return 'documents'
}

export interface SaveTextFileOptions {
  text: string
  suggestedName: string
  /** Picker file-type label, e.g. "JSON". */
  description: string
  mimeType: string
  extension: string
}

/**
 * `saved` — written through the save-file picker; `downloaded` — handed to
 * the browser as a download (no File System Access API, or the picker
 * failed); `cancelled` — the user dismissed the picker, nothing was written.
 */
export type SaveTextFileResult = 'saved' | 'downloaded' | 'cancelled'

/**
 * Saves text to a user-chosen file: the File System Access save picker
 * (remembering the folder), falling back to an `<a download>` when the API is
 * missing or the picker fails for any reason other than the user cancelling.
 * Shared by Settings → Export and the task-archive "Export & delete" flows.
 */
export async function saveTextFile(opts: SaveTextFileOptions): Promise<SaveTextFileResult> {
  const showSaveFilePicker = getSaveFilePicker()
  if (showSaveFilePicker) {
    try {
      const startIn = await getPickerStartIn()
      const handle = await showSaveFilePicker({
        suggestedName: opts.suggestedName,
        types: [{ description: opts.description, accept: { [opts.mimeType]: [opts.extension] } }],
        startIn,
      })
      const writable = await handle.createWritable()
      await writable.write(opts.text)
      await writable.close()
      saveLastPickerHandle(handle).catch(() => {})
      return 'saved'
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
      // Any other failure: fall through to the download fallback.
    }
  }

  downloadTextFile(opts.text, opts.suggestedName, opts.mimeType)
  return 'downloaded'
}

/**
 * Hands `text` to the browser as a download named `fileName` (a temporary
 * `<a download>`): no picker, so it works once per click for several files.
 */
export function downloadTextFile(text: string, fileName: string, mimeType: string): void {
  const blob = new Blob([text], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_REVOKE_MS)
}
