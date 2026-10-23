/**
 * File System Access API wrappers. The standard DOM lib does not declare
 * `showSaveFilePicker` / `showOpenFilePicker`, so we declare the shapes here
 * and expose typed accessors that return the picker function (when supported
 * by the running browser) or `undefined`.
 *
 * The one place that casts `window` for the File System Access pickers, so
 * callers (Settings sections) stay cast-free.
 */

export interface FilePickerAcceptType {
  description?: string
  accept: Record<string, string[]>
}

export interface ShowSaveFilePickerOptions {
  suggestedName?: string
  types?: FilePickerAcceptType[]
  startIn?: FileSystemHandle | string
  excludeAcceptAllOption?: boolean
}

export interface ShowOpenFilePickerOptions {
  multiple?: boolean
  types?: FilePickerAcceptType[]
  startIn?: FileSystemHandle | string
  excludeAcceptAllOption?: boolean
}

export type ShowSaveFilePicker = (opts: ShowSaveFilePickerOptions) => Promise<FileSystemFileHandle>
export type ShowOpenFilePicker = (opts: ShowOpenFilePickerOptions) => Promise<FileSystemFileHandle[]>

interface FSAWindow {
  showSaveFilePicker?: ShowSaveFilePicker
  showOpenFilePicker?: ShowOpenFilePicker
}

export function getSaveFilePicker(): ShowSaveFilePicker | undefined {
  return (window as unknown as FSAWindow).showSaveFilePicker
}

export function getOpenFilePicker(): ShowOpenFilePicker | undefined {
  return (window as unknown as FSAWindow).showOpenFilePicker
}
