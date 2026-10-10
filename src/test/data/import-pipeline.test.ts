import { describe, it, expect, vi, afterEach } from 'vitest'
import { prepareImport, prepareImportText, TASK_ARCHIVE_KIND } from '../../data/import-pipeline'
import { CURRENT_DB_VERSION, OLDEST_SUPPORTED_DB_VERSION } from '../../data/database'
import { SCHEMA_VERSION_KEY } from '../../services/migration-check'

const now = new Date().toISOString()

function file(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [SCHEMA_VERSION_KEY]: CURRENT_DB_VERSION,
    exportedAt: now,
    canvases: [{ id: 1, name: 'Main', sortOrder: 0, createdAt: now }],
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
    expect(result.legacy).toBeNull()
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

  it('flags a below-floor file as legacy but still prepares its data', () => {
    const result = prepareImport(file({ [SCHEMA_VERSION_KEY]: OLDEST_SUPPORTED_DB_VERSION - 1 }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.legacy).toEqual({
      sourceVersion: OLDEST_SUPPORTED_DB_VERSION - 1,
      targetVersion: CURRENT_DB_VERSION,
      descriptions: [],
    })
    expect(result.data.todos).toHaveLength(1)
  })

  it('flags a marker-less file as legacy with sourceVersion null', () => {
    const raw = file()
    delete raw[SCHEMA_VERSION_KEY]
    const result = prepareImport(raw)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.sourceVersion).toBeNull()
    expect(result.legacy?.sourceVersion).toBeNull()
  })

  it('does not prompt for a below-floor file that would fail validation anyway', () => {
    const result = prepareImport(file({ [SCHEMA_VERSION_KEY]: 10, todos: [{ title: '' }] }))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('invalid')
  })
})

describe('prepareImport — validation', () => {
  it('reports invalid rows with reason "invalid"', () => {
    const result = prepareImport(file({ todos: [{ title: '' }] }))
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('still rejects a known table that is not an array (metadata split keeps it visible)', () => {
    const result = prepareImport(file({ todos: 'nope' }))
    expect(result).toEqual({ ok: false, reason: 'invalid', error: '"todos" is not an array' })
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

describe('prepareImport — task archives and the append purpose (cr1 P5)', () => {
  function archive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    const raw = file({ kind: TASK_ARCHIVE_KIND, ...overrides })
    delete raw.canvases
    return raw
  }

  it('rejects a task archive for a full restore with a pointer to the append import', () => {
    const result = prepareImport(archive())
    expect(result).toMatchObject({ ok: false, reason: 'task-archive' })
    if (result.ok) return
    expect(result.error).toContain('Import tasks (append)')
  })

  it('accepts a task archive (no canvases) for append and reports its kind', () => {
    const result = prepareImport(archive(), { purpose: 'append' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.kind).toBe('task-archive')
    expect(result.data.todos).toHaveLength(1)
    expect(result.data.canvases).toEqual([])
  })

  it('accepts a full export for append (kind "full")', () => {
    const result = prepareImport(file(), { purpose: 'append' })
    expect(result).toMatchObject({ ok: true, kind: 'full' })
  })

  it('still validates rows strictly for append', () => {
    const result = prepareImport(archive({ todos: [{ uid: 'u1', title: '', isCompleted: false }] }), { purpose: 'append' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('still requires canvases for a full restore', () => {
    const raw = file()
    delete raw.canvases
    expect(prepareImport(raw)).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('prepareImportText passes the purpose through', () => {
    expect(prepareImportText(JSON.stringify(archive()), { purpose: 'append' }).ok).toBe(true)
    expect(prepareImportText(JSON.stringify(archive())).ok).toBe(false)
  })
})
