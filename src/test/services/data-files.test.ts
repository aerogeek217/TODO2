import { describe, it, expect } from 'vitest'
import { buildJsonExport, exportFileTimestamp, exportImportProblem, readImportFile } from '../../services/data-files'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION, db } from '../../data/database'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'
import { MAX_IMPORT_SIZE_BYTES } from '../../data/import-validation'
import { usePersonStore } from '../../stores/person-store'

const now = new Date('2026-10-16T12:30:00.000Z')

function fileText(version: number): string {
  return JSON.stringify({
    [SCHEMA_VERSION_KEY]: version,
    exportedAt: now.toISOString(),
    settings: [],
    todos: [{ id: 1, uid: 'u1', title: 'Task', isCompleted: false, createdAt: now.toISOString(), modifiedAt: now.toISOString(), sortOrder: 0 }],
  })
}

describe('data files', () => {
  it('a full export reads back as an import', async () => {
    await db.todos.add({ uid: 'u1', title: 'Task', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 1 })
    const json = await buildJsonExport(now)
    const parsed = JSON.parse(json) as Record<string, unknown>
    expect(parsed.exportedAt).toBe(now.toISOString())
    expect(parsed[SCHEMA_VERSION_KEY]).toBe(CURRENT_DB_VERSION)
    expect(exportImportProblem(json)).toBeNull()
    expect(exportImportProblem('{')).toMatch(/invalid JSON/)
    expect(exportFileTimestamp(now)).toBe('2026-10-16_12-30-00-000')
  })

  it('reads an import file, refusing one over the cap before reading it', async () => {
    const ok = await readImportFile(new File([fileText(CURRENT_DB_VERSION)], 'a.json'))
    expect(ok.ok).toBe(true)
    const big = new File(['{}'], 'big.json')
    Object.defineProperty(big, 'size', { value: MAX_IMPORT_SIZE_BYTES + 1 })
    let read = false
    big.text = async () => { read = true; return '{}' }
    expect(await readImportFile(big)).toEqual({ ok: false, reason: 'file-too-large' })
    expect(read).toBe(false)
  })

  it('refuses an import file below the floor (Import JSON and Import tasks alike)', async () => {
    const old = new File([fileText(OLDEST_SUPPORTED_DB_VERSION - 1)], 'old.json')
    expect(await readImportFile(old)).toMatchObject({ ok: false, reason: 'too-old' })
    expect(await readImportFile(old, { purpose: 'append' })).toMatchObject({ ok: false, reason: 'too-old' })
  })
})

describe('person-store.countTasks', () => {
  it('counts every task the person is on, from the database', async () => {
    const personId = await db.people.add({ name: 'Ada', initials: 'AD' })
    await db.todoPeople.bulkAdd([{ todoId: 1, personId }, { todoId: 2, personId }, { todoId: 3, personId: personId + 1 }])
    expect(await usePersonStore.getState().countTasks(personId)).toBe(2)
  })
})
