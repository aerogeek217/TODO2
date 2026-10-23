import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareImport, prepareImportText, TASK_ARCHIVE_KIND } from '../../data/import-pipeline'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { SCHEMA_VERSION_KEY } from '../../data/file-version'

const now = new Date().toISOString()

function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
    exportedAt: now,
    settings: [],
    todos: [{ id: 1, uid: 'u1', title: 'Task', isCompleted: false, createdAt: now, modifiedAt: now, sortOrder: 0 }],
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('prepareImport — version routing', () => {
  it('accepts a current-version file as-is', () => {
    const result = prepareImport(file())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourceVersion).toBe(CURRENT_DB_VERSION)
    expect(result.upgraded).toBe(false)
    expect(result.data.todos).toHaveLength(1)
  })

  it('rejects a file from a newer schema with a clear message', () => {
    const result = prepareImport(file({ [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION + 1 }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('too-new')
    expect(result.error).toContain('newer version of TODO2')
    expect(result.error).toContain(`v${CURRENT_DB_VERSION + 1}`)
  })

  it.each([
    ['one version below the floor', OLDEST_SUPPORTED_DB_VERSION - 1],
    ['far below the floor', 10],
  ])('refuses a file %s, naming its version and the build that still reads it', (_, version) => {
    const result = prepareImport(file({ [SCHEMA_VERSION_KEY]: version }))
    expect(result).toEqual({
      ok: false,
      reason: 'too-old',
      error: `This file was saved by an older version of TODO2 (schema v${version}); this version reads v${OLDEST_SUPPORTED_DB_VERSION} and newer, so nothing in it was loaded. To use it, open it in the last TODO2 build from before 2026-10-23, export it again there, and load that file.`,
    })
  })

  it.each([
    ['no marker', undefined],
    ['a marker that is no whole number', '68'],
    ['a fractional marker', 68.5],
  ])('refuses a file with %s as having no valid schema version', (_, marker) => {
    const raw = file()
    if (marker === undefined) delete raw[SCHEMA_VERSION_KEY]
    else raw[SCHEMA_VERSION_KEY] = marker
    const result = prepareImport(raw)
    expect(result).toMatchObject({ ok: false, reason: 'too-old' })
    if (result.ok) return
    expect(result.error).toMatch(/^This file has no valid schema version: it was saved by an older version of TODO2, or is not a TODO2 file; /)
    expect(result.error).toContain('If it is a TODO2 file, open it in the last TODO2 build from before 2026-10-23')
  })

  it('refuses a below-floor file before reading its tables (no validation, no record cap)', () => {
    const result = prepareImport(file({ [SCHEMA_VERSION_KEY]: 10, todos: [{ title: '' }], people: 'nope' }))
    expect(result).toMatchObject({ ok: false, reason: 'too-old' })
  })

  it('refuses a below-floor task archive for append too', () => {
    const raw = file({ [SCHEMA_VERSION_KEY]: OLDEST_SUPPORTED_DB_VERSION - 1, kind: TASK_ARCHIVE_KIND })
    expect(prepareImport(raw, { purpose: 'append' })).toMatchObject({ ok: false, reason: 'too-old' })
  })
})

describe('prepareImport — validation', () => {
  it('reports invalid rows with reason "invalid"', () => {
    const result = prepareImport(file({ todos: [{ title: '' }] }))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('still rejects a known table that is not an array (metadata split keeps it visible)', () => {
    const result = prepareImport(file({ people: 'nope' }))
    expect(result).toEqual({ ok: false, reason: 'invalid', error: '"people" is not an array' })
  })

  it('ignores envelope metadata (exportedAt, savedAt)', () => {
    const result = prepareImport(file({ savedAt: now }))
    expect(result.ok).toBe(true)
  })

  it('drops unrecognized setting keys with a warning instead of failing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = prepareImport(file({
      settings: [{ key: 'themeMode', value: 'light' }, { key: 'retiredKey', value: '1' }],
    }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.settings).toEqual([{ key: 'themeMode', value: 'light' }])
    expect(result.warnings).toEqual(['Ignored 1 unrecognized setting: retiredKey'])
    expect(warn).toHaveBeenCalledWith('[import] Ignored 1 unrecognized setting: retiredKey')
  })

  it('rejects non-objects', () => {
    expect(prepareImport([])).toMatchObject({ ok: false, reason: 'not-object' })
    expect(prepareImport(null)).toMatchObject({ ok: false, reason: 'not-object' })
  })
})

describe('prepareImportText', () => {
  it('reports invalid JSON', () => {
    const result = prepareImportText('{not json')
    expect(result).toMatchObject({ ok: false, reason: 'invalid-json' })
    if (result.ok) return
    expect(result.error).toMatch(/^File contains invalid JSON/)
  })

  it('parses and prepares valid JSON', () => {
    expect(prepareImportText(JSON.stringify(file())).ok).toBe(true)
  })
})

describe('prepareImport — task archives and the append purpose', () => {
  function archive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const raw = file({ kind: TASK_ARCHIVE_KIND, ...overrides })
    delete raw.settings
    return raw
  }

  it('rejects a task archive for a full restore with a pointer to the append import', () => {
    const result = prepareImport(archive())
    expect(result).toMatchObject({ ok: false, reason: 'task-archive' })
    if (result.ok) return
    expect(result.error).toContain('Import tasks (append)')
  })

  it('accepts a task archive (no settings) for append and reports its kind', () => {
    const result = prepareImport(archive(), { purpose: 'append' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('task-archive')
    expect(result.data.todos).toHaveLength(1)
    expect(result.data.settings).toEqual([])
  })

  it('accepts a full export for append (kind "full")', () => {
    const result = prepareImport(file(), { purpose: 'append' })
    expect(result).toMatchObject({ ok: true, kind: 'full' })
  })

  it('a task archive with a long name and an invalid email: name kept whole, email dropped with a warning', () => {
    const name = 'n'.repeat(1000)
    const result = prepareImport(archive({
      people: [{ id: 1, name, initials: 'NN', email: 'a@b.com,evil@x.com' }],
      todoPeople: [{ id: 1, todoId: 1, personId: 1 }],
    }), { purpose: 'append' })
    if (!result.ok) throw new Error(result.error)
    expect(result.data.people).toEqual([{ id: 1, name, initials: 'NN' }])
    // The warning quotes the name shortened.
    expect(result.warnings).toEqual([`Fixed 1 person: "${'n'.repeat(60)}…" (invalid email dropped)`])
  })

  it('still validates rows strictly for append', () => {
    const result = prepareImport(archive({ todos: [{ uid: 'u1', title: '', isCompleted: false }] }), { purpose: 'append' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('still requires tasks and settings for a full restore', () => {
    const error = 'File is not a valid TODO2 database (missing tasks or settings)'
    for (const table of ['todos', 'settings']) {
      const raw = file()
      delete raw[table]
      expect(prepareImport(raw), table).toEqual({ ok: false, reason: 'invalid', error })
      expect(prepareImport(raw, { purpose: 'append' }).ok, `${table} (append)`).toBe(true)
    }
  })

  it('prepareImportText passes the purpose through', () => {
    expect(prepareImportText(JSON.stringify(archive()), { purpose: 'append' }).ok).toBe(true)
    expect(prepareImportText(JSON.stringify(archive())).ok).toBe(false)
  })
})
