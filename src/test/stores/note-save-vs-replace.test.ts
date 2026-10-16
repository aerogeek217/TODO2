// A note save that started before a data replace (backup restore, import,
// sync file load) must not land after it: the replace waits for the save,
// and the imported note is what stays. Each test holds the save's database
// write, starts the replace, then lets the save finish.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { db } from '../../data/database'
import { noteRepository } from '../../data'
import { backupRepository } from '../../data/backup-repository'
import { buildExportData } from '../../data/export-data'
import { FILE_SYNC_STATE_KEY } from '../../services/file-sync-state'
import { fileStorageService as svc } from '../../services/file-storage'
// Wires the service's before / after import hooks, as the app does.
import '../../services/file-storage-store'
import { useNoteStore } from '../../stores/note-store'
import { useFileOpsStore } from '../../services/file-ops-store'
import { useUIStore } from '../../stores/ui-store'
import { useTodoStore } from '../../stores/todo-store'
import { resetDb } from '../helpers'

const mockLoadFileHandle = vi.fn()
vi.mock('../../services/file-handle-idb', () => ({
  saveFileHandle: vi.fn().mockResolvedValue(undefined),
  loadFileHandle: (...args: unknown[]) => mockLoadFileHandle(...args) as unknown,
  clearFileHandle: vi.fn().mockResolvedValue(undefined),
}))

let unsubscribe: (() => void) | null = null

beforeEach(async () => {
  await resetDb()
  localStorage.clear()
  for (const store of [useNoteStore, useFileOpsStore, useUIStore, useTodoStore]) {
    store.setState(store.getInitialState(), true)
  }
})

afterEach(async () => {
  unsubscribe?.()
  unsubscribe = null
  await svc.disconnect()
  svc.onConflict(async () => 'cancel')
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Sets the global note's text in the database (the store doesn't see it). */
async function setNoteText(content: string): Promise<number> {
  const [note] = await noteRepository.getOrSeedGlobal()
  await db.notes.update(note!.id, { content })
  return note!.id
}

async function noteText(id: number): Promise<string | undefined> {
  return (await db.notes.get(id))?.content
}

/**
 * Types `text` into the loaded note and starts its save, holding the
 * save's database write until `release()`.
 */
async function typedSaveInFlight(text: string) {
  await useNoteStore.getState().load()
  const id = useNoteStore.getState().activeId!
  useNoteStore.getState().setContent(id, text)
  const write = noteRepository.saveContent.bind(noteRepository)
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  let markStarted!: () => void
  const started = new Promise<void>((r) => { markStarted = r })
  vi.spyOn(noteRepository, 'saveContent').mockImplementationOnce(async (...args) => {
    markStarted()
    await gate
    return write(...args)
  })
  const saving = useNoteStore.getState().flush()
  await started
  return { release, saving }
}

/**
 * Lets the held save finish once the replace is under way: it has written
 * the notes table, or it has asked the note store to hold its saves (and
 * is waiting for this one). Call before starting the replace.
 */
function releaseWhenReplaceStarts(release: () => void): () => Promise<void> {
  let notesRewritten = false
  const onCreating = () => { notesRewritten = true }
  db.notes.hook('creating').subscribe(onCreating)
  unsubscribe = () => db.notes.hook('creating').unsubscribe(onCreating)
  let holdAsked = false
  const hold = useNoteStore.getState().holdForDataReplace as (() => Promise<() => void>) | undefined
  if (hold) useNoteStore.setState({ holdForDataReplace: () => { holdAsked = true; return hold() } })
  return async () => {
    await vi.waitFor(() => expect(notesRewritten || holdAsked).toBe(true))
    release()
  }
}

/** The notes the newest pre-op backup holds. */
async function preOpBackupNotes(): Promise<string[]> {
  const preOp = (await db.backups.toArray()).filter((b) => b.trigger === 'pre-destructive')
  const newest = preOp.at(-1)
  if (!newest) return []
  return (JSON.parse(newest.data) as { notes: Array<{ content: string }> }).notes.map((n) => n.content)
}

/** Types `text` into the loaded note; its debounced save hasn't run yet. */
async function typedJustBefore(text: string) {
  await useNoteStore.getState().load()
  useNoteStore.getState().setContent(useNoteStore.getState().activeId!, text)
}

/**
 * Attaches a sync file holding `fileText` while the browser has changes the
 * file doesn't: loading asks first, and the answer is "Use file".
 */
function attachSyncFileOverBrowserChanges(fileText: string, savedAt: string) {
  localStorage.setItem(FILE_SYNC_STATE_KEY, JSON.stringify({ fileSavedAt: savedAt, dirtySince: '2026-10-02T10:00:00.000Z' }))
  mockLoadFileHandle.mockResolvedValue({
    kind: 'file',
    name: 'todo2-data.json',
    getFile: vi.fn().mockImplementation(async () => new File([fileText], 'todo2-data.json', { type: 'application/json', lastModified: 1_000 })),
    queryPermission: vi.fn().mockResolvedValue('granted'),
    requestPermission: vi.fn().mockResolvedValue('granted'),
    createWritable: vi.fn().mockResolvedValue({ write: vi.fn(), close: vi.fn(), abort: vi.fn() }),
    isSameEntry: vi.fn(),
  })
  vi.stubGlobal('showOpenFilePicker', vi.fn())
  svc.onConflict(async () => 'file')
}

const SAVED_AT = '2026-10-01T10:00:00.000Z'

describe('a note save started before a data replace', () => {
  it('backup restore: the restored note stays', async () => {
    const id = await setNoteText('from the backup')
    const backupId = await backupRepository.createSnapshot('manual')
    await setNoteText('before')
    const { release, saving } = await typedSaveInFlight('typed before the restore')

    const releaseLater = releaseWhenReplaceStarts(release)
    const restoring = useFileOpsStore.getState().restoreBackup(backupId)
    await releaseLater()
    expect(await restoring).toEqual({ status: 'done', noBackup: false })
    await saving

    expect(await noteText(id)).toBe('from the backup')
    expect(useNoteStore.getState().notes.get(id)?.content).toBe('from the backup')
  })

  it('import: the imported note stays', async () => {
    const id = await setNoteText('from the file')
    const data = await buildExportData()
    await setNoteText('before')
    const { release, saving } = await typedSaveInFlight('typed before the import')

    const releaseLater = releaseWhenReplaceStarts(release)
    const importing = useFileOpsStore.getState().restoreFromImport(data as never)
    await releaseLater()
    expect(await importing).toEqual({ status: 'done', noBackup: false })
    await saving

    expect(await noteText(id)).toBe('from the file')
  })

  it('sync file loaded over browser changes ("Use file"): the file\'s note stays', async () => {
    const id = await setNoteText('from the sync file')
    const fileText = JSON.stringify({ ...(await buildExportData()), savedAt: SAVED_AT })
    await setNoteText('before')
    attachSyncFileOverBrowserChanges(fileText, SAVED_AT)
    const { release, saving } = await typedSaveInFlight('typed before the load')

    const releaseLater = releaseWhenReplaceStarts(release)
    const loading = svc.initialize()
    await releaseLater()
    await loading
    await saving

    expect(await noteText(id)).toBe('from the sync file')
  })
})

describe('note text typed just before a data replace (its save not run yet)', () => {
  it('backup restore: the text is in the pre-op backup; the restored note shows the backup', async () => {
    const id = await setNoteText('from the backup')
    const backupId = await backupRepository.createSnapshot('manual')
    await setNoteText('before')
    await typedJustBefore('typed just before the restore')

    expect(await useFileOpsStore.getState().restoreBackup(backupId)).toEqual({ status: 'done', noBackup: false })

    expect(await preOpBackupNotes()).toEqual(['typed just before the restore'])
    expect(await noteText(id)).toBe('from the backup')
    expect(useNoteStore.getState().notes.get(id)?.content).toBe('from the backup')
    expect(useNoteStore.getState().pending).toBeNull()
  })

  it('import: the text is in the pre-op backup; the note shows the file', async () => {
    const id = await setNoteText('from the file')
    const data = await buildExportData()
    await setNoteText('before')
    await typedJustBefore('typed just before the import')

    expect(await useFileOpsStore.getState().restoreFromImport(data as never)).toEqual({ status: 'done', noBackup: false })

    expect(await preOpBackupNotes()).toEqual(['typed just before the import'])
    expect(await noteText(id)).toBe('from the file')
  })

  it('sync file "Use file": the text is in the pre-op backup; the note shows the file', async () => {
    const id = await setNoteText('from the sync file')
    const fileText = JSON.stringify({ ...(await buildExportData()), savedAt: SAVED_AT })
    await setNoteText('before')
    attachSyncFileOverBrowserChanges(fileText, SAVED_AT)
    await typedJustBefore('typed just before the load')

    await svc.initialize()

    expect(await preOpBackupNotes()).toEqual(['typed just before the load'])
    expect(await noteText(id)).toBe('from the sync file')
  })

  it('audit cleanup (notes untouched): the text is saved, not dropped', async () => {
    const id = await setNoteText('before')
    await typedJustBefore('typed just before the cleanup')
    useFileOpsStore.setState({ auditReport: { issues: [] } as never })

    await useFileOpsStore.getState().cleanupCurrentAudit()

    expect(await noteText(id)).toBe('typed just before the cleanup')
    expect(useNoteStore.getState().notes.get(id)?.content).toBe('typed just before the cleanup')
  })
})
